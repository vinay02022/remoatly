const express = require('express');
const Player = require('../models/Player');
const {
    validateCreatePlayer,
    validateUpdatePlayer,
    validatePlayerScoreUpdate,
    validatePlayerId,
    validateLeaderboardQuery
} = require('../middleware/validation');

const router = express.Router();

/**
 * @route   POST /api/players
 * @desc    Create a new player
 * @access  Public
 */
router.post('/', validateCreatePlayer, async (req, res) => {
    try {
        const { username, email, region, currentGameMode } = req.body;
        
        // Check if username already exists
        const existingPlayer = await Player.findOne({ username });
        if (existingPlayer) {
            return res.status(409).json({
                success: false,
                message: 'Username already exists',
                error: 'DUPLICATE_USERNAME'
            });
        }
        
        // Check if email already exists (if provided)
        if (email) {
            const existingEmail = await Player.findOne({ email });
            if (existingEmail) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already registered',
                    error: 'DUPLICATE_EMAIL'
                });
            }
        }
        
        const newPlayer = new Player({
            username,
            email: email || null,
            region,
            currentGameMode
        });
        
        const savedPlayer = await newPlayer.save();
        
        // Return player data without sensitive information
        const playerResponse = {
            playerId: savedPlayer.playerId,
            username: savedPlayer.username,
            region: savedPlayer.region,
            currentScore: savedPlayer.currentScore,
            currentGameMode: savedPlayer.currentGameMode,
            totalGamesPlayed: savedPlayer.totalGamesPlayed,
            averageScore: savedPlayer.averageScore,
            bestScore: savedPlayer.bestScore,
            gameStats: savedPlayer.gameStats,
            isOnline: savedPlayer.isOnline,
            createdAt: savedPlayer.createdAt
        };
        
        res.status(201).json({
            success: true,
            message: 'Player created successfully',
            data: playerResponse
        });
        
    } catch (error) {
        console.error('Error creating player:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create player',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/players/:playerId
 * @desc    Get player by ID
 * @access  Public
 */
router.get('/:playerId', validatePlayerId, async (req, res) => {
    try {
        const { playerId } = req.params;
        
        const player = await Player.findOne({ playerId })
            .select('-email -__v'); // Exclude sensitive fields
        
        if (!player) {
            return res.status(404).json({
                success: false,
                message: 'Player not found',
                error: 'PLAYER_NOT_FOUND'
            });
        }
        
        // Get player's rank
        const rank = await Player.getPlayerRank(playerId, {
            region: player.region,
            gameMode: player.currentGameMode
        });
        
        const playerResponse = {
            ...player.toObject(),
            winRate: player.winRate,
            currentRank: rank
        };
        
        res.status(200).json({
            success: true,
            data: playerResponse
        });
        
    } catch (error) {
        console.error('Error fetching player:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch player',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   PUT /api/players/:playerId
 * @desc    Update player information
 * @access  Public (in production, this should require authentication)
 */
router.put('/:playerId', validatePlayerId, validateUpdatePlayer, async (req, res) => {
    try {
        const { playerId } = req.params;
        const updateData = req.body;
        
        // Check if new username already exists (if updating username)
        if (updateData.username) {
            const existingPlayer = await Player.findOne({
                username: updateData.username,
                playerId: { $ne: playerId }
            });
            
            if (existingPlayer) {
                return res.status(409).json({
                    success: false,
                    message: 'Username already exists',
                    error: 'DUPLICATE_USERNAME'
                });
            }
        }
        
        // Check if new email already exists (if updating email)
        if (updateData.email) {
            const existingEmail = await Player.findOne({
                email: updateData.email,
                playerId: { $ne: playerId }
            });
            
            if (existingEmail) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already registered',
                    error: 'DUPLICATE_EMAIL'
                });
            }
        }
        
        const updatedPlayer = await Player.findOneAndUpdate(
            { playerId },
            { ...updateData, lastActiveAt: new Date() },
            { new: true, runValidators: true }
        ).select('-email -__v');
        
        if (!updatedPlayer) {
            return res.status(404).json({
                success: false,
                message: 'Player not found',
                error: 'PLAYER_NOT_FOUND'
            });
        }
        
        res.status(200).json({
            success: true,
            message: 'Player updated successfully',
            data: updatedPlayer
        });
        
    } catch (error) {
        console.error('Error updating player:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update player',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   POST /api/players/:playerId/score
 * @desc    Update player score
 * @access  Public (in production, this should require authentication)
 */
router.post('/:playerId/score', validatePlayerId, validatePlayerScoreUpdate, async (req, res) => {
    try {
        const { playerId } = req.params;
        const { score, gameMode, delta, reason } = req.body;
        
        const updatedPlayer = await Player.updatePlayerScore(playerId, score, gameMode);
        
        if (!updatedPlayer) {
            return res.status(404).json({
                success: false,
                message: 'Player not found',
                error: 'PLAYER_NOT_FOUND'
            });
        }
        
        // Get updated rank
        const newRank = await Player.getPlayerRank(playerId, {
            region: updatedPlayer.region,
            gameMode: updatedPlayer.currentGameMode
        });
        
        const responseData = {
            playerId: updatedPlayer.playerId,
            username: updatedPlayer.username,
            previousScore: score - (delta || 0),
            currentScore: updatedPlayer.currentScore,
            delta: delta || 0,
            gameMode: updatedPlayer.currentGameMode,
            region: updatedPlayer.region,
            newRank,
            totalGamesPlayed: updatedPlayer.totalGamesPlayed,
            averageScore: updatedPlayer.averageScore,
            bestScore: updatedPlayer.bestScore,
            gameStats: updatedPlayer.gameStats,
            updatedAt: updatedPlayer.updatedAt
        };
        
        // If socket service is available, broadcast the update
        if (req.app.locals.socketService) {
            req.app.locals.socketService.broadcastToRegion(
                updatedPlayer.region,
                'leaderboard:score_updated',
                responseData
            );
        }
        
        res.status(200).json({
            success: true,
            message: 'Score updated successfully',
            data: responseData
        });
        
    } catch (error) {
        console.error('Error updating score:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update score',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/players/:playerId/rank
 * @desc    Get player's current rank
 * @access  Public
 */
router.get('/:playerId/rank', validatePlayerId, async (req, res) => {
    try {
        const { playerId } = req.params;
        const { region, gameMode } = req.query;
        
        const player = await Player.findOne({ playerId });
        if (!player) {
            return res.status(404).json({
                success: false,
                message: 'Player not found',
                error: 'PLAYER_NOT_FOUND'
            });
        }
        
        const rank = await Player.getPlayerRank(playerId, {
            region: region || player.region,
            gameMode: gameMode || player.currentGameMode
        });
        
        res.status(200).json({
            success: true,
            data: {
                playerId,
                username: player.username,
                currentScore: player.currentScore,
                rank,
                region: region || player.region,
                gameMode: gameMode || player.currentGameMode
            }
        });
        
    } catch (error) {
        console.error('Error fetching rank:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch rank',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   POST /api/players/:playerId/game-result
 * @desc    Add game result for player
 * @access  Public
 */
router.post('/:playerId/game-result', validatePlayerId, async (req, res) => {
    try {
        const { playerId } = req.params;
        const { result, scoreChange = 0 } = req.body;
        
        if (!['win', 'loss', 'draw'].includes(result)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid game result. Must be win, loss, or draw',
                error: 'INVALID_RESULT'
            });
        }
        
        const player = await Player.findOne({ playerId });
        if (!player) {
            return res.status(404).json({
                success: false,
                message: 'Player not found',
                error: 'PLAYER_NOT_FOUND'
            });
        }
        
        const updatedPlayer = await player.addGameResult(result, scoreChange);
        
        res.status(200).json({
            success: true,
            message: 'Game result added successfully',
            data: {
                playerId: updatedPlayer.playerId,
                username: updatedPlayer.username,
                currentScore: updatedPlayer.currentScore,
                totalGamesPlayed: updatedPlayer.totalGamesPlayed,
                gameStats: updatedPlayer.gameStats,
                winRate: updatedPlayer.winRate
            }
        });
        
    } catch (error) {
        console.error('Error adding game result:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add game result',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/players/:playerId/stats
 * @desc    Get detailed player statistics
 * @access  Public
 */
router.get('/:playerId/stats', validatePlayerId, async (req, res) => {
    try {
        const { playerId } = req.params;
        
        const player = await Player.findOne({ playerId }).select('-email -__v');
        if (!player) {
            return res.status(404).json({
                success: false,
                message: 'Player not found',
                error: 'PLAYER_NOT_FOUND'
            });
        }
        
        // Get rank in different contexts
        const globalRank = await Player.getPlayerRank(playerId, { region: 'GLOBAL' });
        const regionalRank = await Player.getPlayerRank(playerId, { region: player.region });
        const gameModeRank = await Player.getPlayerRank(playerId, { gameMode: player.currentGameMode });
        
        const stats = {
            player: {
                playerId: player.playerId,
                username: player.username,
                region: player.region,
                currentGameMode: player.currentGameMode,
                isOnline: player.isOnline,
                lastActiveAt: player.lastActiveAt,
                profilePicture: player.profilePicture
            },
            scores: {
                current: player.currentScore,
                average: player.averageScore,
                best: player.bestScore
            },
            games: {
                total: player.totalGamesPlayed,
                wins: player.gameStats.wins,
                losses: player.gameStats.losses,
                draws: player.gameStats.draws,
                winRate: player.winRate
            },
            rankings: {
                global: globalRank,
                regional: regionalRank,
                gameMode: gameModeRank
            },
            achievements: player.achievements.map(achievement => ({
                name: achievement.name,
                unlockedAt: achievement.unlockedAt
            }))
        };
        
        res.status(200).json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        console.error('Error fetching player stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch player stats',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

module.exports = router; 