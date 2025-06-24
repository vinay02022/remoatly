const Player = require('../models/Player');
const GameSession = require('../models/GameSession');
const { validateSocketData, socketSchemas, validateScoreUpdateRate } = require('../middleware/validation');
const _ = require('lodash');

class SocketService {
    constructor(io) {
        this.io = io;
        this.connectedPlayers = new Map(); // playerId -> { socketId, lastActivity, region, gameMode }
        this.socketToPlayer = new Map(); // socketId -> playerId
        this.roomSubscriptions = new Map(); // playerId -> Set of room names
        
        this.setupSocketHandlers();
        this.setupCleanupInterval();
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`🔌 New socket connection: ${socket.id}`);
            
            // Handle player joining the leaderboard system
            socket.on('player:join', async (data) => {
                await this.handlePlayerJoin(socket, data);
            });
            
            // Handle score updates
            socket.on('score:update', async (data) => {
                await this.handleScoreUpdate(socket, data);
            });
            
            // Handle player status updates
            socket.on('player:status', async (data) => {
                await this.handlePlayerStatus(socket, data);
            });
            
            // Handle leaderboard subscription
            socket.on('leaderboard:subscribe', async (data) => {
                await this.handleLeaderboardSubscription(socket, data);
            });
            
            // Handle leaderboard unsubscription
            socket.on('leaderboard:unsubscribe', async (data) => {
                await this.handleLeaderboardUnsubscription(socket, data);
            });
            
            // Handle game session events
            socket.on('session:join', async (data) => {
                await this.handleSessionJoin(socket, data);
            });
            
            socket.on('session:leave', async (data) => {
                await this.handleSessionLeave(socket, data);
            });
            
            // Handle heartbeat/ping
            socket.on('ping', () => {
                socket.emit('pong', { timestamp: Date.now() });
            });
            
            // Handle disconnection
            socket.on('disconnect', async (reason) => {
                await this.handleDisconnection(socket, reason);
            });
            
            // Error handling
            socket.on('error', (error) => {
                console.error(`❌ Socket error for ${socket.id}:`, error);
            });
        });
    }

    async handlePlayerJoin(socket, data) {
        try {
            const validation = validateSocketData(socketSchemas.joinRoom, data);
            if (!validation.isValid) {
                socket.emit('error', {
                    type: 'validation_error',
                    message: 'Invalid join data',
                    errors: validation.errors
                });
                return;
            }

            const { playerId, region, gameMode } = validation.data;
            
            // Verify player exists
            const player = await Player.findOne({ playerId });
            if (!player) {
                socket.emit('error', {
                    type: 'player_not_found',
                    message: 'Player not found'
                });
                return;
            }

            // Update player online status
            await player.updateOnlineStatus(true);
            
            // Store connection info
            this.connectedPlayers.set(playerId, {
                socketId: socket.id,
                lastActivity: Date.now(),
                region: region || player.region,
                gameMode: gameMode || player.currentGameMode,
                username: player.username
            });
            
            this.socketToPlayer.set(socket.id, playerId);
            
            // Join appropriate rooms
            const rooms = this.generateRoomNames(region || player.region, gameMode || player.currentGameMode);
            rooms.forEach(room => {
                socket.join(room);
            });
            
            // Store room subscriptions
            this.roomSubscriptions.set(playerId, new Set(rooms));
            
            // Emit successful join
            socket.emit('player:joined', {
                playerId,
                username: player.username,
                currentScore: player.currentScore,
                region: player.region,
                gameMode: player.currentGameMode,
                rooms: rooms
            });
            
            // Broadcast to others in the same rooms
            rooms.forEach(room => {
                socket.to(room).emit('player:online', {
                    playerId,
                    username: player.username,
                    currentScore: player.currentScore,
                    timestamp: Date.now()
                });
            });
            
            console.log(`✅ Player ${player.username} (${playerId}) joined from ${socket.id}`);
            
        } catch (error) {
            console.error('Error in handlePlayerJoin:', error);
            socket.emit('error', {
                type: 'internal_error',
                message: 'Failed to join'
            });
        }
    }

    async handleScoreUpdate(socket, data) {
        try {
            const validation = validateSocketData(socketSchemas.scoreUpdate, data);
            if (!validation.isValid) {
                socket.emit('error', {
                    type: 'validation_error',
                    message: 'Invalid score update data',
                    errors: validation.errors
                });
                return;
            }

            const { playerId, sessionId, score, gameMode, delta, reason } = validation.data;
            
            // Rate limiting check
            const rateCheck = validateScoreUpdateRate(playerId, 60);
            if (!rateCheck.allowed) {
                socket.emit('error', {
                    type: 'rate_limit_exceeded',
                    message: 'Too many score updates',
                    resetTime: rateCheck.resetTime
                });
                return;
            }
            
            // Verify player ownership
            const socketPlayerId = this.socketToPlayer.get(socket.id);
            if (socketPlayerId !== playerId) {
                socket.emit('error', {
                    type: 'unauthorized',
                    message: 'Cannot update score for different player'
                });
                return;
            }
            
            let updatedPlayer;
            let sessionUpdate = null;
            
            // Handle session-based vs global score update
            if (sessionId) {
                // Update session score
                sessionUpdate = await GameSession.updatePlayerScore(sessionId, playerId, {
                    score,
                    delta,
                    reason
                });
                
                // Also update global player score
                updatedPlayer = await Player.updatePlayerScore(playerId, score, gameMode);
            } else {
                // Direct global score update
                updatedPlayer = await Player.updatePlayerScore(playerId, score, gameMode);
            }
            
            if (!updatedPlayer) {
                socket.emit('error', {
                    type: 'update_failed',
                    message: 'Failed to update score'
                });
                return;
            }
            
            // Update connection info
            const connectionInfo = this.connectedPlayers.get(playerId);
            if (connectionInfo) {
                connectionInfo.lastActivity = Date.now();
                if (gameMode) {
                    connectionInfo.gameMode = gameMode;
                }
            }
            
            // Prepare broadcast data
            const broadcastData = {
                playerId,
                username: updatedPlayer.username,
                oldScore: score - (delta || 0),
                newScore: updatedPlayer.currentScore,
                delta: delta || 0,
                gameMode: updatedPlayer.currentGameMode,
                region: updatedPlayer.region,
                timestamp: Date.now(),
                reason: reason || 'score_update'
            };
            
            // Emit to the player first
            socket.emit('score:updated', {
                ...broadcastData,
                sessionId: sessionId || null,
                playerStats: {
                    totalGamesPlayed: updatedPlayer.totalGamesPlayed,
                    averageScore: updatedPlayer.averageScore,
                    bestScore: updatedPlayer.bestScore
                }
            });
            
            // Broadcast to relevant rooms
            const rooms = this.roomSubscriptions.get(playerId) || new Set();
            rooms.forEach(room => {
                socket.to(room).emit('leaderboard:score_updated', broadcastData);
            });
            
            // If it's a session update, broadcast to session room
            if (sessionId && sessionUpdate) {
                this.io.to(`session:${sessionId}`).emit('session:score_updated', {
                    sessionId,
                    playerId,
                    username: updatedPlayer.username,
                    sessionScore: sessionUpdate.players.find(p => p.playerId === playerId)?.currentSessionScore,
                    globalScore: updatedPlayer.currentScore,
                    timestamp: Date.now()
                });
            }
            
            console.log(`📊 Score updated for ${updatedPlayer.username}: ${broadcastData.oldScore} → ${broadcastData.newScore}`);
            
        } catch (error) {
            console.error('Error in handleScoreUpdate:', error);
            socket.emit('error', {
                type: 'internal_error',
                message: 'Failed to update score'
            });
        }
    }

    async handlePlayerStatus(socket, data) {
        try {
            const validation = validateSocketData(socketSchemas.playerStatus, data);
            if (!validation.isValid) {
                socket.emit('error', {
                    type: 'validation_error',
                    message: 'Invalid status data',
                    errors: validation.errors
                });
                return;
            }

            const { playerId, isOnline } = validation.data;
            
            // Verify player ownership
            const socketPlayerId = this.socketToPlayer.get(socket.id);
            if (socketPlayerId !== playerId) {
                socket.emit('error', {
                    type: 'unauthorized',
                    message: 'Cannot update status for different player'
                });
                return;
            }
            
            const player = await Player.findOne({ playerId });
            if (!player) {
                socket.emit('error', {
                    type: 'player_not_found',
                    message: 'Player not found'
                });
                return;
            }
            
            await player.updateOnlineStatus(isOnline);
            
            // Update connection info
            const connectionInfo = this.connectedPlayers.get(playerId);
            if (connectionInfo) {
                connectionInfo.lastActivity = Date.now();
            }
            
            // Broadcast status change
            const rooms = this.roomSubscriptions.get(playerId) || new Set();
            const statusData = {
                playerId,
                username: player.username,
                isOnline,
                timestamp: Date.now()
            };
            
            rooms.forEach(room => {
                socket.to(room).emit('player:status_changed', statusData);
            });
            
            socket.emit('player:status_updated', statusData);
            
        } catch (error) {
            console.error('Error in handlePlayerStatus:', error);
            socket.emit('error', {
                type: 'internal_error',
                message: 'Failed to update status'
            });
        }
    }

    async handleLeaderboardSubscription(socket, data) {
        try {
            const playerId = this.socketToPlayer.get(socket.id);
            if (!playerId) {
                socket.emit('error', {
                    type: 'not_authenticated',
                    message: 'Player not connected'
                });
                return;
            }
            
            const { region, gameMode } = data || {};
            const rooms = this.generateRoomNames(region, gameMode);
            
            // Join new rooms
            rooms.forEach(room => {
                socket.join(room);
            });
            
            // Update subscriptions
            const currentRooms = this.roomSubscriptions.get(playerId) || new Set();
            rooms.forEach(room => currentRooms.add(room));
            this.roomSubscriptions.set(playerId, currentRooms);
            
            socket.emit('leaderboard:subscribed', { rooms });
            
        } catch (error) {
            console.error('Error in handleLeaderboardSubscription:', error);
            socket.emit('error', {
                type: 'internal_error',
                message: 'Failed to subscribe to leaderboard'
            });
        }
    }

    async handleLeaderboardUnsubscription(socket, data) {
        try {
            const playerId = this.socketToPlayer.get(socket.id);
            if (!playerId) return;
            
            const { region, gameMode } = data || {};
            const roomsToLeave = this.generateRoomNames(region, gameMode);
            
            // Leave rooms
            roomsToLeave.forEach(room => {
                socket.leave(room);
            });
            
            // Update subscriptions
            const currentRooms = this.roomSubscriptions.get(playerId) || new Set();
            roomsToLeave.forEach(room => currentRooms.delete(room));
            this.roomSubscriptions.set(playerId, currentRooms);
            
            socket.emit('leaderboard:unsubscribed', { rooms: roomsToLeave });
            
        } catch (error) {
            console.error('Error in handleLeaderboardUnsubscription:', error);
        }
    }

    async handleSessionJoin(socket, data) {
        try {
            const { sessionId } = data;
            const playerId = this.socketToPlayer.get(socket.id);
            
            if (!playerId || !sessionId) {
                socket.emit('error', {
                    type: 'invalid_data',
                    message: 'Player ID and session ID required'
                });
                return;
            }
            
            socket.join(`session:${sessionId}`);
            socket.emit('session:joined', { sessionId });
            
            // Broadcast to other session members
            socket.to(`session:${sessionId}`).emit('session:player_joined', {
                playerId,
                username: this.connectedPlayers.get(playerId)?.username,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('Error in handleSessionJoin:', error);
            socket.emit('error', {
                type: 'internal_error',
                message: 'Failed to join session'
            });
        }
    }

    async handleSessionLeave(socket, data) {
        try {
            const { sessionId } = data;
            const playerId = this.socketToPlayer.get(socket.id);
            
            if (!sessionId) return;
            
            socket.leave(`session:${sessionId}`);
            socket.emit('session:left', { sessionId });
            
            if (playerId) {
                socket.to(`session:${sessionId}`).emit('session:player_left', {
                    playerId,
                    username: this.connectedPlayers.get(playerId)?.username,
                    timestamp: Date.now()
                });
            }
            
        } catch (error) {
            console.error('Error in handleSessionLeave:', error);
        }
    }

    async handleDisconnection(socket, reason) {
        try {
            const playerId = this.socketToPlayer.get(socket.id);
            
            if (playerId) {
                console.log(`🔌 Player ${playerId} disconnected: ${reason}`);
                
                // Update player offline status
                const player = await Player.findOne({ playerId });
                if (player) {
                    await player.updateOnlineStatus(false);
                    
                    // Broadcast offline status
                    const rooms = this.roomSubscriptions.get(playerId) || new Set();
                    const offlineData = {
                        playerId,
                        username: player.username,
                        isOnline: false,
                        timestamp: Date.now(),
                        reason
                    };
                    
                    rooms.forEach(room => {
                        socket.to(room).emit('player:offline', offlineData);
                    });
                }
                
                // Clean up connection data
                this.connectedPlayers.delete(playerId);
                this.roomSubscriptions.delete(playerId);
            }
            
            this.socketToPlayer.delete(socket.id);
            
        } catch (error) {
            console.error('Error in handleDisconnection:', error);
        }
    }

    // Utility methods
    generateRoomNames(region, gameMode) {
        const rooms = ['global']; // Everyone joins global room
        
        if (region && region !== 'GLOBAL') {
            rooms.push(`region:${region}`);
        }
        
        if (gameMode) {
            rooms.push(`gamemode:${gameMode}`);
            
            if (region && region !== 'GLOBAL') {
                rooms.push(`region:${region}:gamemode:${gameMode}`);
            }
        }
        
        return rooms;
    }

    setupCleanupInterval() {
        // Clean up inactive connections every 5 minutes
        setInterval(() => {
            const now = Date.now();
            const inactiveThreshold = 10 * 60 * 1000; // 10 minutes
            
            for (const [playerId, connectionInfo] of this.connectedPlayers.entries()) {
                if (now - connectionInfo.lastActivity > inactiveThreshold) {
                    console.log(`🧹 Cleaning up inactive connection for player ${playerId}`);
                    this.connectedPlayers.delete(playerId);
                    this.roomSubscriptions.delete(playerId);
                    
                    // Try to find and disconnect the socket
                    const socket = this.io.sockets.sockets.get(connectionInfo.socketId);
                    if (socket) {
                        socket.disconnect(true);
                    }
                }
            }
        }, 5 * 60 * 1000); // Run every 5 minutes
    }

    // Public methods for external use
    broadcastLeaderboardUpdate(data) {
        this.io.emit('leaderboard:updated', data);
    }

    broadcastToRegion(region, event, data) {
        if (region === 'GLOBAL') {
            this.io.emit(event, data);
        } else {
            this.io.to(`region:${region}`).emit(event, data);
        }
    }

    broadcastToGameMode(gameMode, event, data) {
        this.io.to(`gamemode:${gameMode}`).emit(event, data);
    }

    getConnectedPlayersCount() {
        return this.connectedPlayers.size;
    }

    getPlayerConnection(playerId) {
        return this.connectedPlayers.get(playerId);
    }

    isPlayerOnline(playerId) {
        return this.connectedPlayers.has(playerId);
    }
}

module.exports = SocketService;