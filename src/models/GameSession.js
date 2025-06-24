const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const gameSessionSchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true,
        unique: true,
        default: () => `game_${uuidv4()}`,
        index: true
    },
    players: [{
        playerId: {
            type: String,
            required: true,
            ref: 'Player'
        },
        username: String,
        initialScore: {
            type: Number,
            default: 0
        },
        currentSessionScore: {
            type: Number,
            default: 0
        },
        position: Number, // Final position in the game
        isActive: {
            type: Boolean,
            default: true
        }
    }],
    gameMode: {
        type: String,
        enum: ['classic', 'blitz', 'survival', 'team', 'ranked'],
        required: true,
        index: true
    },
    region: {
        type: String,
        enum: ['NA', 'EU', 'ASIA', 'SA', 'OCE', 'GLOBAL'],
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['waiting', 'active', 'completed', 'abandoned'],
        default: 'waiting',
        index: true
    },
    maxPlayers: {
        type: Number,
        default: 4,
        min: 1,
        max: 100
    },
    startedAt: {
        type: Date,
        default: null
    },
    endedAt: {
        type: Date,
        default: null
    },
    duration: {
        type: Number, // in seconds
        default: null
    },
    gameSettings: {
        timeLimit: Number, // in seconds
        scoreLimit: Number,
        difficulty: {
            type: String,
            enum: ['easy', 'medium', 'hard'],
            default: 'medium'
        }
    },
    realTimeEvents: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        playerId: String,
        eventType: {
            type: String,
            enum: ['score_update', 'player_joined', 'player_left', 'game_start', 'game_end', 'achievement']
        },
        data: mongoose.Schema.Types.Mixed
    }],
    metadata: {
        serverRegion: String,
        version: String,
        platform: String
    }
}, {
    timestamps: true,
    collection: 'game_sessions'
});

// Compound indexes for efficient queries
gameSessionSchema.index({ status: 1, createdAt: -1 });
gameSessionSchema.index({ gameMode: 1, region: 1, status: 1 });
gameSessionSchema.index({ 'players.playerId': 1, status: 1 });
gameSessionSchema.index({ startedAt: -1 });
gameSessionSchema.index({ endedAt: -1 });

// TTL index to automatically clean up old completed sessions (30 days)
gameSessionSchema.index({ 
    endedAt: 1 
}, { 
    expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days
    partialFilterExpression: { status: 'completed' }
});

// Virtual for game duration calculation
gameSessionSchema.virtual('gameDuration').get(function() {
    if (this.startedAt && this.endedAt) {
        return Math.round((this.endedAt - this.startedAt) / 1000); // in seconds
    }
    return null;
});

// Pre-save middleware
gameSessionSchema.pre('save', function(next) {
    // Calculate duration if game is ending
    if (this.status === 'completed' && this.startedAt && !this.duration) {
        this.duration = Math.round((Date.now() - this.startedAt.getTime()) / 1000);
        this.endedAt = new Date();
    }
    
    next();
});

// Static methods for game session management
gameSessionSchema.statics.createSession = async function(gameData) {
    const session = new this({
        gameMode: gameData.gameMode,
        region: gameData.region,
        maxPlayers: gameData.maxPlayers || 4,
        gameSettings: gameData.gameSettings || {},
        metadata: gameData.metadata || {}
    });
    
    return await session.save();
};

gameSessionSchema.statics.joinSession = async function(sessionId, playerData) {
    const session = await this.findOne({ 
        sessionId,
        status: { $in: ['waiting', 'active'] }
    });
    
    if (!session) {
        throw new Error('Session not found or not joinable');
    }
    
    if (session.players.length >= session.maxPlayers) {
        throw new Error('Session is full');
    }
    
    // Check if player is already in session
    const existingPlayer = session.players.find(p => p.playerId === playerData.playerId);
    if (existingPlayer) {
        return session;
    }
    
    session.players.push({
        playerId: playerData.playerId,
        username: playerData.username,
        initialScore: playerData.currentScore || 0,
        currentSessionScore: 0
    });
    
    // Add join event
    session.realTimeEvents.push({
        playerId: playerData.playerId,
        eventType: 'player_joined',
        data: { username: playerData.username }
    });
    
    // Start game if we have enough players and it's not started yet
    if (session.players.length >= 2 && session.status === 'waiting') {
        session.status = 'active';
        session.startedAt = new Date();
        
        session.realTimeEvents.push({
            eventType: 'game_start',
            data: { playerCount: session.players.length }
        });
    }
    
    return await session.save();
};

gameSessionSchema.statics.updatePlayerScore = async function(sessionId, playerId, scoreData) {
    const session = await this.findOne({
        sessionId,
        status: 'active',
        'players.playerId': playerId
    });
    
    if (!session) {
        throw new Error('Active session not found for player');
    }
    
    const playerIndex = session.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
        throw new Error('Player not found in session');
    }
    
    // Update player's session score
    session.players[playerIndex].currentSessionScore = scoreData.score;
    
    // Add score update event
    session.realTimeEvents.push({
        playerId: playerId,
        eventType: 'score_update',
        data: {
            newScore: scoreData.score,
            delta: scoreData.delta || 0,
            reason: scoreData.reason || 'score_update'
        }
    });
    
    return await session.save();
};

gameSessionSchema.statics.endSession = async function(sessionId) {
    const session = await this.findOne({
        sessionId,
        status: 'active'
    });
    
    if (!session) {
        throw new Error('Active session not found');
    }
    
    session.status = 'completed';
    session.endedAt = new Date();
    
    // Calculate final positions based on scores
    const sortedPlayers = [...session.players].sort((a, b) => 
        b.currentSessionScore - a.currentSessionScore
    );
    
    sortedPlayers.forEach((player, index) => {
        const playerIndex = session.players.findIndex(p => p.playerId === player.playerId);
        session.players[playerIndex].position = index + 1;
    });
    
    session.realTimeEvents.push({
        eventType: 'game_end',
        data: {
            finalScores: session.players.map(p => ({
                playerId: p.playerId,
                username: p.username,
                score: p.currentSessionScore,
                position: p.position
            }))
        }
    });
    
    return await session.save();
};

gameSessionSchema.statics.getActiveSessions = async function(filters = {}) {
    const matchConditions = { status: 'active' };
    
    if (filters.gameMode) {
        matchConditions.gameMode = filters.gameMode;
    }
    
    if (filters.region) {
        matchConditions.region = filters.region;
    }
    
    return this.find(matchConditions)
        .sort({ startedAt: -1 })
        .limit(filters.limit || 50)
        .lean();
};

// Instance methods
gameSessionSchema.methods.addEvent = function(eventData) {
    this.realTimeEvents.push({
        playerId: eventData.playerId,
        eventType: eventData.eventType,
        data: eventData.data || {}
    });
    
    return this.save();
};

gameSessionSchema.methods.removePlayer = function(playerId) {
    const playerIndex = this.players.findIndex(p => p.playerId === playerId);
    
    if (playerIndex !== -1) {
        this.players[playerIndex].isActive = false;
        
        this.realTimeEvents.push({
            playerId: playerId,
            eventType: 'player_left',
            data: { reason: 'disconnected' }
        });
        
        // If no active players left, mark as abandoned
        const activePlayers = this.players.filter(p => p.isActive);
        if (activePlayers.length === 0) {
            this.status = 'abandoned';
            this.endedAt = new Date();
        }
    }
    
    return this.save();
};

module.exports = mongoose.model('GameSession', gameSessionSchema); 