const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const playerSchema = new mongoose.Schema({
    playerId: {
        type: String,
        required: true,
        unique: true,
        default: () => uuidv4(),
        index: true
    },
    username: {
        type: String,
        required: true,
        trim: true,
        minlength: 2,
        maxlength: 30,
        index: true
    },
    email: {
        type: String,
        required: false,
        trim: true,
        lowercase: true,
        sparse: true, // Allows multiple null values
        index: { unique: true, sparse: true }
    },
    region: {
        type: String,
        required: true,
        enum: ['NA', 'EU', 'ASIA', 'SA', 'OCE', 'GLOBAL'],
        default: 'GLOBAL',
        index: true
    },
    currentScore: {
        type: Number,
        default: 0,
        min: 0,
        index: -1 // Descending order for leaderboard
    },
    totalGamesPlayed: {
        type: Number,
        default: 0,
        min: 0
    },
    averageScore: {
        type: Number,
        default: 0,
        min: 0
    },
    bestScore: {
        type: Number,
        default: 0,
        min: 0
    },
    currentGameMode: {
        type: String,
        enum: ['classic', 'blitz', 'survival', 'team', 'ranked'],
        default: 'classic',
        index: true
    },
    isOnline: {
        type: Boolean,
        default: false,
        index: true
    },
    lastActiveAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    profilePicture: {
        type: String,
        default: null
    },
    achievements: [{
        name: String,
        unlockedAt: {
            type: Date,
            default: Date.now
        }
    }],
    gameStats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        draws: { type: Number, default: 0 }
    }
}, {
    timestamps: true,
    collection: 'players'
});

// Compound indexes for efficient leaderboard queries
playerSchema.index({ region: 1, currentScore: -1 });
playerSchema.index({ currentGameMode: 1, currentScore: -1 });
playerSchema.index({ region: 1, currentGameMode: 1, currentScore: -1 });
playerSchema.index({ isOnline: 1, currentScore: -1 });
playerSchema.index({ lastActiveAt: -1 });

// Virtual for win rate calculation
playerSchema.virtual('winRate').get(function() {
    const totalGames = this.gameStats.wins + this.gameStats.losses + this.gameStats.draws;
    return totalGames > 0 ? (this.gameStats.wins / totalGames * 100).toFixed(2) : 0;
});

// Pre-save middleware to update averageScore
playerSchema.pre('save', function(next) {
    if (this.totalGamesPlayed > 0) {
        // This is a simplified average - in real apps you might want more sophisticated calculation
        this.averageScore = Math.round(this.currentScore / Math.max(this.totalGamesPlayed, 1));
    }
    
    // Update best score
    if (this.currentScore > this.bestScore) {
        this.bestScore = this.currentScore;
    }
    
    next();
});

// Static methods for leaderboard operations
playerSchema.statics.getLeaderboard = async function(options = {}) {
    const {
        limit = 50,
        skip = 0,
        region = null,
        gameMode = null,
        onlineOnly = false
    } = options;

    const matchConditions = {};
    
    if (region && region !== 'GLOBAL') {
        matchConditions.region = region;
    }
    
    if (gameMode) {
        matchConditions.currentGameMode = gameMode;
    }
    
    if (onlineOnly) {
        matchConditions.isOnline = true;
    }

    return this.find(matchConditions)
        .sort({ currentScore: -1, lastActiveAt: -1 })
        .limit(limit)
        .skip(skip)
        .select('playerId username region currentScore currentGameMode isOnline lastActiveAt profilePicture gameStats')
        .lean(); // Use lean() for better performance when we don't need full Mongoose documents
};

playerSchema.statics.getPlayerRank = async function(playerId, options = {}) {
    const { region = null, gameMode = null } = options;
    
    const player = await this.findOne({ playerId });
    if (!player) return null;

    const matchConditions = {
        currentScore: { $gt: player.currentScore }
    };
    
    if (region && region !== 'GLOBAL') {
        matchConditions.region = region;
    }
    
    if (gameMode) {
        matchConditions.currentGameMode = gameMode;
    }

    const playersAhead = await this.countDocuments(matchConditions);
    return playersAhead + 1;
};

playerSchema.statics.updatePlayerScore = async function(playerId, newScore, gameMode = null) {
    const updateData = {
        currentScore: newScore,
        lastActiveAt: new Date(),
        $inc: { totalGamesPlayed: 1 }
    };
    
    if (gameMode) {
        updateData.currentGameMode = gameMode;
    }

    return this.findOneAndUpdate(
        { playerId },
        updateData,
        { new: true, upsert: false }
    );
};

// Instance methods
playerSchema.methods.updateOnlineStatus = function(isOnline) {
    this.isOnline = isOnline;
    this.lastActiveAt = new Date();
    return this.save();
};

playerSchema.methods.addGameResult = function(result, scoreChange = 0) {
    if (result === 'win') {
        this.gameStats.wins += 1;
    } else if (result === 'loss') {
        this.gameStats.losses += 1;
    } else if (result === 'draw') {
        this.gameStats.draws += 1;
    }
    
    this.currentScore = Math.max(0, this.currentScore + scoreChange);
    this.totalGamesPlayed += 1;
    
    return this.save();
};

module.exports = mongoose.model('Player', playerSchema); 