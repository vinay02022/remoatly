const express = require('express');
const Player = require('../models/Player');
const { validateLeaderboardQuery } = require('../middleware/validation');
const _ = require('lodash');

const router = express.Router();

/**
 * @route   GET /api/leaderboard
 * @desc    Get leaderboard with filtering options
 * @access  Public
 */
router.get('/', validateLeaderboardQuery, async (req, res) => {
    try {
        const { limit, page, region, gameMode, onlineOnly } = req.query;
        const skip = (page - 1) * limit;
        
        const leaderboardOptions = {
            limit,
            skip,
            region,
            gameMode,
            onlineOnly
        };
        
        // Get leaderboard data
        const players = await Player.getLeaderboard(leaderboardOptions);
        
        // Get total count for pagination
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
        
        const totalPlayers = await Player.countDocuments(matchConditions);
        const totalPages = Math.ceil(totalPlayers / limit);
        
        // Add rank to each player
        const leaderboardWithRanks = players.map((player, index) => ({
            rank: skip + index + 1,
            playerId: player.playerId,
            username: player.username,
            currentScore: player.currentScore,
            region: player.region,
            gameMode: player.currentGameMode,
            isOnline: player.isOnline,
            lastActiveAt: player.lastActiveAt,
            profilePicture: player.profilePicture,
            gameStats: player.gameStats,
            winRate: ((player.gameStats.wins / Math.max(
                player.gameStats.wins + player.gameStats.losses + player.gameStats.draws, 1
            )) * 100).toFixed(2)
        }));
        
        const response = {
            success: true,
            data: {
                leaderboard: leaderboardWithRanks,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalPlayers,
                    hasNextPage: page < totalPages,
                    hasPreviousPage: page > 1,
                    playersPerPage: limit
                },
                filters: {
                    region: region || 'ALL',
                    gameMode: gameMode || 'ALL',
                    onlineOnly
                },
                meta: {
                    generatedAt: new Date(),
                    cacheRecommendation: '60 seconds'
                }
            }
        };
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch leaderboard',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/leaderboard/top/:count
 * @desc    Get top N players
 * @access  Public
 */
router.get('/top/:count', async (req, res) => {
    try {
        const count = parseInt(req.params.count);
        
        if (isNaN(count) || count < 1 || count > 100) {
            return res.status(400).json({
                success: false,
                message: 'Invalid count. Must be between 1 and 100',
                error: 'INVALID_COUNT'
            });
        }
        
        const { region, gameMode, onlineOnly } = req.query;
        
        const topPlayers = await Player.getLeaderboard({
            limit: count,
            skip: 0,
            region,
            gameMode,
            onlineOnly: onlineOnly === 'true'
        });
        
        const topPlayersWithRanks = topPlayers.map((player, index) => ({
            rank: index + 1,
            playerId: player.playerId,
            username: player.username,
            currentScore: player.currentScore,
            region: player.region,
            gameMode: player.currentGameMode,
            isOnline: player.isOnline,
            profilePicture: player.profilePicture,
            gameStats: player.gameStats
        }));
        
        res.status(200).json({
            success: true,
            data: {
                topPlayers: topPlayersWithRanks,
                count: topPlayersWithRanks.length,
                filters: {
                    region: region || 'ALL',
                    gameMode: gameMode || 'ALL',
                    onlineOnly: onlineOnly === 'true'
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching top players:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch top players',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/leaderboard/regions
 * @desc    Get leaderboards for all regions
 * @access  Public
 */
router.get('/regions', async (req, res) => {
    try {
        const { limit = 10, gameMode } = req.query;
        const regions = ['NA', 'EU', 'ASIA', 'SA', 'OCE', 'GLOBAL'];
        
        const regionLeaderboards = await Promise.all(
            regions.map(async (region) => {
                const players = await Player.getLeaderboard({
                    limit: parseInt(limit),
                    skip: 0,
                    region: region === 'GLOBAL' ? null : region,
                    gameMode
                });
                
                return {
                    region,
                    players: players.map((player, index) => ({
                        rank: index + 1,
                        playerId: player.playerId,
                        username: player.username,
                        currentScore: player.currentScore,
                        isOnline: player.isOnline,
                        gameMode: player.currentGameMode
                    }))
                };
            })
        );
        
        res.status(200).json({
            success: true,
            data: {
                regionLeaderboards,
                filters: {
                    gameMode: gameMode || 'ALL',
                    topPlayersPerRegion: parseInt(limit)
                },
                generatedAt: new Date()
            }
        });
        
    } catch (error) {
        console.error('Error fetching regional leaderboards:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch regional leaderboards',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/leaderboard/game-modes
 * @desc    Get leaderboards for all game modes
 * @access  Public
 */
router.get('/game-modes', async (req, res) => {
    try {
        const { limit = 10, region } = req.query;
        const gameModes = ['classic', 'blitz', 'survival', 'team', 'ranked'];
        
        const gameModeLeaderboards = await Promise.all(
            gameModes.map(async (gameMode) => {
                const players = await Player.getLeaderboard({
                    limit: parseInt(limit),
                    skip: 0,
                    region,
                    gameMode
                });
                
                return {
                    gameMode,
                    players: players.map((player, index) => ({
                        rank: index + 1,
                        playerId: player.playerId,
                        username: player.username,
                        currentScore: player.currentScore,
                        region: player.region,
                        isOnline: player.isOnline
                    }))
                };
            })
        );
        
        res.status(200).json({
            success: true,
            data: {
                gameModeLeaderboards,
                filters: {
                    region: region || 'ALL',
                    topPlayersPerMode: parseInt(limit)
                },
                generatedAt: new Date()
            }
        });
        
    } catch (error) {
        console.error('Error fetching game mode leaderboards:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch game mode leaderboards',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/leaderboard/around/:playerId
 * @desc    Get leaderboard around a specific player
 * @access  Public
 */
router.get('/around/:playerId', async (req, res) => {
    try {
        const { playerId } = req.params;
        const { range = 5, region, gameMode } = req.query;
        
        if (!playerId || typeof playerId !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Invalid player ID',
                error: 'INVALID_PLAYER_ID'
            });
        }
        
        const rangeValue = parseInt(range);
        if (isNaN(rangeValue) || rangeValue < 1 || rangeValue > 50) {
            return res.status(400).json({
                success: false,
                message: 'Invalid range. Must be between 1 and 50',
                error: 'INVALID_RANGE'
            });
        }
        
        // Get the player to check if they exist
        const player = await Player.findOne({ playerId });
        if (!player) {
            return res.status(404).json({
                success: false,
                message: 'Player not found',
                error: 'PLAYER_NOT_FOUND'
            });
        }
        
        // Get player's rank
        const playerRank = await Player.getPlayerRank(playerId, {
            region: region || player.region,
            gameMode: gameMode || player.currentGameMode
        });
        
        // Calculate the range to fetch
        const startRank = Math.max(1, playerRank - rangeValue);
        const endRank = playerRank + rangeValue;
        const skip = startRank - 1;
        const limit = endRank - startRank + 1;
        
        // Get players around the target player
        const playersAround = await Player.getLeaderboard({
            limit,
            skip,
            region: region || player.region,
            gameMode: gameMode || player.currentGameMode
        });
        
        const playersWithRanks = playersAround.map((p, index) => ({
            rank: startRank + index,
            playerId: p.playerId,
            username: p.username,
            currentScore: p.currentScore,
            region: p.region,
            gameMode: p.currentGameMode,
            isOnline: p.isOnline,
            isTargetPlayer: p.playerId === playerId,
            profilePicture: p.profilePicture,
            gameStats: p.gameStats
        }));
        
        res.status(200).json({
            success: true,
            data: {
                targetPlayer: {
                    playerId: player.playerId,
                    username: player.username,
                    currentRank: playerRank,
                    currentScore: player.currentScore
                },
                playersAround: playersWithRanks,
                range: {
                    startRank,
                    endRank,
                    rangeRequested: rangeValue
                },
                filters: {
                    region: region || player.region,
                    gameMode: gameMode || player.currentGameMode
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching leaderboard around player:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch leaderboard around player',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/leaderboard/stats
 * @desc    Get leaderboard statistics and insights
 * @access  Public
 */
router.get('/stats', async (req, res) => {
    try {
        const { region, gameMode } = req.query;
        
        // Build match conditions
        const matchConditions = {};
        if (region && region !== 'GLOBAL') {
            matchConditions.region = region;
        }
        if (gameMode) {
            matchConditions.currentGameMode = gameMode;
        }
        
        // Get aggregated statistics
        const [
            totalPlayers,
            onlinePlayers,
            scoreStats,
            regionDistribution,
            gameModeDistribution
        ] = await Promise.all([
            Player.countDocuments(matchConditions),
            Player.countDocuments({ ...matchConditions, isOnline: true }),
            Player.aggregate([
                { $match: matchConditions },
                {
                    $group: {
                        _id: null,
                        averageScore: { $avg: '$currentScore' },
                        maxScore: { $max: '$currentScore' },
                        minScore: { $min: '$currentScore' },
                        totalGamesPlayed: { $sum: '$totalGamesPlayed' }
                    }
                }
            ]),
            Player.aggregate([
                { $match: matchConditions },
                {
                    $group: {
                        _id: '$region',
                        count: { $sum: 1 },
                        averageScore: { $avg: '$currentScore' }
                    }
                },
                { $sort: { count: -1 } }
            ]),
            Player.aggregate([
                { $match: matchConditions },
                {
                    $group: {
                        _id: '$currentGameMode',
                        count: { $sum: 1 },
                        averageScore: { $avg: '$currentScore' }
                    }
                },
                { $sort: { count: -1 } }
            ])
        ]);
        
        const stats = {
            players: {
                total: totalPlayers,
                online: onlinePlayers,
                onlinePercentage: totalPlayers > 0 ? ((onlinePlayers / totalPlayers) * 100).toFixed(2) : 0
            },
            scores: scoreStats[0] ? {
                average: Math.round(scoreStats[0].averageScore || 0),
                highest: scoreStats[0].maxScore || 0,
                lowest: scoreStats[0].minScore || 0,
                totalGamesPlayed: scoreStats[0].totalGamesPlayed || 0
            } : {
                average: 0,
                highest: 0,
                lowest: 0,
                totalGamesPlayed: 0
            },
            distribution: {
                byRegion: regionDistribution.map(item => ({
                    region: item._id,
                    playerCount: item.count,
                    averageScore: Math.round(item.averageScore || 0),
                    percentage: ((item.count / totalPlayers) * 100).toFixed(2)
                })),
                byGameMode: gameModeDistribution.map(item => ({
                    gameMode: item._id,
                    playerCount: item.count,
                    averageScore: Math.round(item.averageScore || 0),
                    percentage: ((item.count / totalPlayers) * 100).toFixed(2)
                }))
            },
            filters: {
                region: region || 'ALL',
                gameMode: gameMode || 'ALL'
            },
            generatedAt: new Date()
        };
        
        res.status(200).json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        console.error('Error fetching leaderboard stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch leaderboard statistics',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * @route   GET /api/leaderboard/live
 * @desc    Get real-time leaderboard updates
 * @access  Public
 */
router.get('/live', async (req, res) => {
    try {
        const { limit = 20, region, gameMode } = req.query;
        
        // Get recent score updates (players who updated in last 5 minutes)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        const matchConditions = {
            lastActiveAt: { $gte: fiveMinutesAgo }
        };
        
        if (region && region !== 'GLOBAL') {
            matchConditions.region = region;
        }
        if (gameMode) {
            matchConditions.currentGameMode = gameMode;
        }
        
        const recentlyActivePlayers = await Player.find(matchConditions)
            .sort({ lastActiveAt: -1, currentScore: -1 })
            .limit(parseInt(limit))
            .select('playerId username currentScore region currentGameMode isOnline lastActiveAt')
            .lean();
        
        const liveData = recentlyActivePlayers.map((player, index) => ({
            rank: index + 1,
            playerId: player.playerId,
            username: player.username,
            currentScore: player.currentScore,
            region: player.region,
            gameMode: player.currentGameMode,
            isOnline: player.isOnline,
            lastActiveAt: player.lastActiveAt,
            timeSinceActive: Math.round((Date.now() - new Date(player.lastActiveAt).getTime()) / 1000)
        }));
        
        res.status(200).json({
            success: true,
            data: {
                recentlyActive: liveData,
                count: liveData.length,
                timeWindow: '5 minutes',
                filters: {
                    region: region || 'ALL',
                    gameMode: gameMode || 'ALL'
                },
                generatedAt: new Date(),
                nextUpdateRecommended: new Date(Date.now() + 30 * 1000) // 30 seconds
            }
        });
        
    } catch (error) {
        console.error('Error fetching live leaderboard:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch live leaderboard',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
});

module.exports = router;