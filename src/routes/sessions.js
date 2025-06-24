const express = require('express');
const GameSession = require('../models/GameSession');
const Player = require('../models/Player');
const {
    validateCreateSession,
    validateJoinSession,
    validateSessionScoreUpdate,
    validateSessionId
} = require('../middleware/validation');

const router = express.Router();

/**
 * @route   POST /api/sessions
 * @desc    Create a new game session
 * @access  Public
 */
router.post('/', validateCreateSession, async (req, res) => {
    try {
        const sessionData = req.body;
        
        const newSession = await GameSession.createSession(sessionData);
        
        res.status(201).json({
            success: true,
            message: 'Game session created successfully',
            data: {
                sessionId: newSession.sessionId,
                gameMode: newSession.gameMode,
                region: newSession.region,
                maxPlayers: newSession.maxPlayers,
                status: newSession.status,
                gameSettings: newSession.gameSettings,
                createdAt: newSession.createdAt
            }
        });
        
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create session',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/sessions/:sessionId
 * @desc    Get session details
 * @access  Public
 */
router.get('/:sessionId', validateSessionId, async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const session = await GameSession.findOne({ sessionId })
            .select('-__v')
            .lean();
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found',
                error: 'SESSION_NOT_FOUND'
            });
        }
        
        // Calculate additional session info
        const sessionInfo = {
            ...session,
            playerCount: session.players.length,
            activePlayers: session.players.filter(p => p.isActive).length,
            isJoinable: session.status === 'waiting' && session.players.length < session.maxPlayers,
            duration: session.duration || (
                session.startedAt ? Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000) : null
            )
        };
        
        res.status(200).json({
            success: true,
            data: sessionInfo
        });
        
    } catch (error) {
        console.error('Error fetching session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch session',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   POST /api/sessions/:sessionId/join
 * @desc    Join a game session
 * @access  Public
 */
router.post('/:sessionId/join', validateSessionId, validateJoinSession, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { playerId, username } = req.body;
        
        // Verify player exists
        const player = await Player.findOne({ playerId });
        if (!player) {
            return res.status(404).json({
                success: false,
                message: 'Player not found',
                error: 'PLAYER_NOT_FOUND'
            });
        }
        
        const playerData = {
            playerId: player.playerId,
            username: player.username,
            currentScore: player.currentScore
        };
        
        const updatedSession = await GameSession.joinSession(sessionId, playerData);
        
        // Emit to socket service if available
        if (req.app.locals.socketService) {
            req.app.locals.socketService.io.to(`session:${sessionId}`).emit('session:player_joined', {
                sessionId,
                playerId: player.playerId,
                username: player.username,
                playerCount: updatedSession.players.length,
                timestamp: Date.now()
            });
        }
        
        res.status(200).json({
            success: true,
            message: 'Successfully joined session',
            data: {
                sessionId: updatedSession.sessionId,
                status: updatedSession.status,
                playerCount: updatedSession.players.length,
                maxPlayers: updatedSession.maxPlayers,
                gameMode: updatedSession.gameMode,
                region: updatedSession.region,
                player: {
                    playerId: player.playerId,
                    username: player.username,
                    initialScore: player.currentScore
                }
            }
        });
        
    } catch (error) {
        console.error('Error joining session:', error);
        
        if (error.message.includes('Session not found') || error.message.includes('not joinable')) {
            return res.status(404).json({
                success: false,
                message: error.message,
                error: 'SESSION_NOT_JOINABLE'
            });
        }
        
        if (error.message.includes('full')) {
            return res.status(409).json({
                success: false,
                message: error.message,
                error: 'SESSION_FULL'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to join session',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   POST /api/sessions/:sessionId/leave
 * @desc    Leave a game session
 * @access  Public
 */
router.post('/:sessionId/leave', validateSessionId, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { playerId } = req.body;
        
        if (!playerId) {
            return res.status(400).json({
                success: false,
                message: 'Player ID is required',
                error: 'MISSING_PLAYER_ID'
            });
        }
        
        const session = await GameSession.findOne({ sessionId });
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found',
                error: 'SESSION_NOT_FOUND'
            });
        }
        
        const updatedSession = await session.removePlayer(playerId);
        
        // Emit to socket service if available
        if (req.app.locals.socketService) {
            req.app.locals.socketService.io.to(`session:${sessionId}`).emit('session:player_left', {
                sessionId,
                playerId,
                playerCount: updatedSession.players.filter(p => p.isActive).length,
                timestamp: Date.now()
            });
        }
        
        res.status(200).json({
            success: true,
            message: 'Successfully left session',
            data: {
                sessionId: updatedSession.sessionId,
                status: updatedSession.status,
                activePlayers: updatedSession.players.filter(p => p.isActive).length
            }
        });
        
    } catch (error) {
        console.error('Error leaving session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to leave session',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   POST /api/sessions/:sessionId/score
 * @desc    Update player score in session
 * @access  Public
 */
router.post('/:sessionId/score', validateSessionId, validateSessionScoreUpdate, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { playerId, score, delta, reason } = req.body;
        
        if (!playerId) {
            return res.status(400).json({
                success: false,
                message: 'Player ID is required',
                error: 'MISSING_PLAYER_ID'
            });
        }
        
        const scoreData = { score, delta, reason };
        const updatedSession = await GameSession.updatePlayerScore(sessionId, playerId, scoreData);
        
        // Also update global player score
        const updatedPlayer = await Player.updatePlayerScore(playerId, score);
        
        const responseData = {
            sessionId: updatedSession.sessionId,
            playerId,
            sessionScore: updatedSession.players.find(p => p.playerId === playerId)?.currentSessionScore,
            globalScore: updatedPlayer?.currentScore,
            delta: delta || 0,
            reason: reason || 'score_update',
            timestamp: Date.now()
        };
        
        // Emit to socket service if available
        if (req.app.locals.socketService) {
            req.app.locals.socketService.io.to(`session:${sessionId}`).emit('session:score_updated', responseData);
        }
        
        res.status(200).json({
            success: true,
            message: 'Score updated successfully',
            data: responseData
        });
        
    } catch (error) {
        console.error('Error updating session score:', error);
        
        if (error.message.includes('not found')) {
            return res.status(404).json({
                success: false,
                message: error.message,
                error: 'SESSION_OR_PLAYER_NOT_FOUND'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to update score',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   POST /api/sessions/:sessionId/end
 * @desc    End a game session
 * @access  Public
 */
router.post('/:sessionId/end', validateSessionId, async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const endedSession = await GameSession.endSession(sessionId);
        
        // Update global scores for all players based on final positions
        const updatePromises = endedSession.players.map(async (player) => {
            if (player.isActive) {
                const scoreBonus = calculatePositionBonus(player.position, endedSession.players.length);
                const finalScore = player.currentSessionScore + scoreBonus;
                
                return Player.updatePlayerScore(player.playerId, finalScore, endedSession.gameMode);
            }
        });
        
        await Promise.all(updatePromises);
        
        const finalResults = {
            sessionId: endedSession.sessionId,
            status: endedSession.status,
            duration: endedSession.duration,
            finalScores: endedSession.players
                .filter(p => p.isActive)
                .sort((a, b) => a.position - b.position)
                .map(player => ({
                    playerId: player.playerId,
                    username: player.username,
                    position: player.position,
                    sessionScore: player.currentSessionScore,
                    positionBonus: calculatePositionBonus(player.position, endedSession.players.length)
                })),
            endedAt: endedSession.endedAt
        };
        
        // Emit to socket service if available
        if (req.app.locals.socketService) {
            req.app.locals.socketService.io.to(`session:${sessionId}`).emit('session:ended', finalResults);
        }
        
        res.status(200).json({
            success: true,
            message: 'Session ended successfully',
            data: finalResults
        });
        
    } catch (error) {
        console.error('Error ending session:', error);
        
        if (error.message.includes('not found')) {
            return res.status(404).json({
                success: false,
                message: error.message,
                error: 'SESSION_NOT_FOUND'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to end session',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/sessions
 * @desc    Get active sessions with filtering
 * @access  Public
 */
router.get('/', async (req, res) => {
    try {
        const { gameMode, region, status, limit = 20 } = req.query;
        
        const filters = {};
        if (gameMode) filters.gameMode = gameMode;
        if (region) filters.region = region;
        if (status) filters.status = status;
        filters.limit = parseInt(limit);
        
        const sessions = await GameSession.getActiveSessions(filters);
        
        const sessionsWithInfo = sessions.map(session => ({
            sessionId: session.sessionId,
            gameMode: session.gameMode,
            region: session.region,
            status: session.status,
            playerCount: session.players.length,
            maxPlayers: session.maxPlayers,
            isJoinable: session.status === 'waiting' && session.players.length < session.maxPlayers,
            gameSettings: session.gameSettings,
            startedAt: session.startedAt,
            createdAt: session.createdAt
        }));
        
        res.status(200).json({
            success: true,
            data: {
                sessions: sessionsWithInfo,
                count: sessionsWithInfo.length,
                filters: {
                    gameMode: gameMode || 'ALL',
                    region: region || 'ALL',
                    status: status || 'ALL'
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch sessions',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/sessions/:sessionId/events
 * @desc    Get session real-time events
 * @access  Public
 */
router.get('/:sessionId/events', validateSessionId, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { limit = 50, eventType } = req.query;
        
        const session = await GameSession.findOne({ sessionId })
            .select('realTimeEvents sessionId gameMode status')
            .lean();
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found',
                error: 'SESSION_NOT_FOUND'
            });
        }
        
        let events = session.realTimeEvents || [];
        
        // Filter by event type if specified
        if (eventType) {
            events = events.filter(event => event.eventType === eventType);
        }
        
        // Sort by timestamp (most recent first) and limit
        events = events
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, parseInt(limit));
        
        res.status(200).json({
            success: true,
            data: {
                sessionId: session.sessionId,
                status: session.status,
                events: events.map(event => ({
                    timestamp: event.timestamp,
                    playerId: event.playerId,
                    eventType: event.eventType,
                    data: event.data
                })),
                eventCount: events.length,
                filters: {
                    eventType: eventType || 'ALL'
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching session events:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch session events',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/sessions/stats
 * @desc    Get session statistics
 * @access  Public
 */
router.get('/stats', async (req, res) => {
    try {
        const { gameMode, region } = req.query;
        
        const matchConditions = {};
        if (gameMode) matchConditions.gameMode = gameMode;
        if (region) matchConditions.region = region;
        
        const [
            totalSessions,
            activeSessions,
            completedSessions,
            averageSessionDuration,
            sessionsByGameMode,
            sessionsByRegion
        ] = await Promise.all([
            GameSession.countDocuments(matchConditions),
            GameSession.countDocuments({ ...matchConditions, status: 'active' }),
            GameSession.countDocuments({ ...matchConditions, status: 'completed' }),
            GameSession.aggregate([
                { $match: { ...matchConditions, status: 'completed', duration: { $exists: true } } },
                { $group: { _id: null, avgDuration: { $avg: '$duration' } } }
            ]),
            GameSession.aggregate([
                { $match: matchConditions },
                { $group: { _id: '$gameMode', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            GameSession.aggregate([
                { $match: matchConditions },
                { $group: { _id: '$region', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ])
        ]);
        
        const stats = {
            sessions: {
                total: totalSessions,
                active: activeSessions,
                completed: completedSessions,
                waiting: totalSessions - activeSessions - completedSessions
            },
            performance: {
                averageDuration: averageSessionDuration[0]?.avgDuration 
                    ? Math.round(averageSessionDuration[0].avgDuration) 
                    : 0,
                completionRate: totalSessions > 0 
                    ? ((completedSessions / totalSessions) * 100).toFixed(2) 
                    : 0
            },
            distribution: {
                byGameMode: sessionsByGameMode.map(item => ({
                    gameMode: item._id,
                    sessionCount: item.count,
                    percentage: ((item.count / totalSessions) * 100).toFixed(2)
                })),
                byRegion: sessionsByRegion.map(item => ({
                    region: item._id,
                    sessionCount: item.count,
                    percentage: ((item.count / totalSessions) * 100).toFixed(2)
                }))
            },
            filters: {
                gameMode: gameMode || 'ALL',
                region: region || 'ALL'
            },
            generatedAt: new Date()
        };
        
        res.status(200).json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        console.error('Error fetching session stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch session statistics',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

// Utility function to calculate position bonus
function calculatePositionBonus(position, totalPlayers) {
    if (totalPlayers < 2) return 0;
    
    const baseBonus = 100;
    const positionMultiplier = (totalPlayers - position + 1) / totalPlayers;
    return Math.round(baseBonus * positionMultiplier);
}

module.exports = router;