const Joi = require('joi');

// Player validation schemas
const playerSchemas = {
    create: Joi.object({
        username: Joi.string()
            .trim()
            .min(2)
            .max(30)
            .pattern(/^[a-zA-Z0-9_-]+$/)
            .required()
            .messages({
                'string.pattern.base': 'Username can only contain letters, numbers, hyphens, and underscores'
            }),
        email: Joi.string()
            .email()
            .optional()
            .allow(null, ''),
        region: Joi.string()
            .valid('NA', 'EU', 'ASIA', 'SA', 'OCE', 'GLOBAL')
            .default('GLOBAL'),
        currentGameMode: Joi.string()
            .valid('classic', 'blitz', 'survival', 'team', 'ranked')
            .default('classic')
    }),
    
    update: Joi.object({
        username: Joi.string()
            .trim()
            .min(2)
            .max(30)
            .pattern(/^[a-zA-Z0-9_-]+$/)
            .optional(),
        email: Joi.string()
            .email()
            .optional()
            .allow(null, ''),
        region: Joi.string()
            .valid('NA', 'EU', 'ASIA', 'SA', 'OCE', 'GLOBAL')
            .optional(),
        currentGameMode: Joi.string()
            .valid('classic', 'blitz', 'survival', 'team', 'ranked')
            .optional()
    }),
    
    scoreUpdate: Joi.object({
        score: Joi.number()
            .min(0)
            .max(999999999)
            .required(),
        gameMode: Joi.string()
            .valid('classic', 'blitz', 'survival', 'team', 'ranked')
            .optional(),
        delta: Joi.number()
            .optional(),
        reason: Joi.string()
            .max(100)
            .optional()
    })
};

// Leaderboard query validation
const leaderboardSchemas = {
    query: Joi.object({
        limit: Joi.number()
            .min(1)
            .max(100)
            .default(50),
        page: Joi.number()
            .min(1)
            .default(1),
        region: Joi.string()
            .valid('NA', 'EU', 'ASIA', 'SA', 'OCE', 'GLOBAL')
            .optional(),
        gameMode: Joi.string()
            .valid('classic', 'blitz', 'survival', 'team', 'ranked')
            .optional(),
        onlineOnly: Joi.boolean()
            .default(false)
    })
};

// Game session validation
const sessionSchemas = {
    create: Joi.object({
        gameMode: Joi.string()
            .valid('classic', 'blitz', 'survival', 'team', 'ranked')
            .required(),
        region: Joi.string()
            .valid('NA', 'EU', 'ASIA', 'SA', 'OCE', 'GLOBAL')
            .required(),
        maxPlayers: Joi.number()
            .min(1)
            .max(100)
            .default(4),
        gameSettings: Joi.object({
            timeLimit: Joi.number().min(30).max(7200).optional(), // 30 seconds to 2 hours
            scoreLimit: Joi.number().min(100).max(1000000).optional(),
            difficulty: Joi.string().valid('easy', 'medium', 'hard').default('medium')
        }).optional(),
        metadata: Joi.object({
            serverRegion: Joi.string().optional(),
            version: Joi.string().optional(),
            platform: Joi.string().optional()
        }).optional()
    }),
    
    join: Joi.object({
        playerId: Joi.string()
            .required(),
        username: Joi.string()
            .trim()
            .min(2)
            .max(30)
            .required()
    }),
    
    scoreUpdate: Joi.object({
        score: Joi.number()
            .min(0)
            .required(),
        delta: Joi.number()
            .optional(),
        reason: Joi.string()
            .max(100)
            .optional()
    })
};

// Socket event validation
const socketSchemas = {
    joinRoom: Joi.object({
        playerId: Joi.string().required(),
        region: Joi.string().valid('NA', 'EU', 'ASIA', 'SA', 'OCE', 'GLOBAL').optional(),
        gameMode: Joi.string().valid('classic', 'blitz', 'survival', 'team', 'ranked').optional()
    }),
    
    scoreUpdate: Joi.object({
        playerId: Joi.string().required(),
        sessionId: Joi.string().optional(),
        score: Joi.number().min(0).required(),
        gameMode: Joi.string().valid('classic', 'blitz', 'survival', 'team', 'ranked').optional(),
        delta: Joi.number().optional(),
        reason: Joi.string().max(100).optional()
    }),
    
    playerStatus: Joi.object({
        playerId: Joi.string().required(),
        isOnline: Joi.boolean().required()
    })
};

// Validation middleware factory
const createValidationMiddleware = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, { 
            abortEarly: false,
            stripUnknown: true,
            allowUnknown: false 
        });
        
        if (error) {
            const errorDetails = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context?.value
            }));
            
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errorDetails
            });
        }
        
        // Replace request body with validated and sanitized data
        req.body = value;
        next();
    };
};

// Query validation middleware
const createQueryValidationMiddleware = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.query, { 
            abortEarly: false,
            stripUnknown: true,
            allowUnknown: false 
        });
        
        if (error) {
            const errorDetails = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context?.value
            }));
            
            return res.status(400).json({
                success: false,
                message: 'Query validation failed',
                errors: errorDetails
            });
        }
        
        req.query = value;
        next();
    };
};

// Socket validation utility
const validateSocketData = (schema, data) => {
    const { error, value } = schema.validate(data, { 
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: false 
    });
    
    if (error) {
        const errorDetails = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value
        }));
        
        return {
            isValid: false,
            errors: errorDetails,
            data: null
        };
    }
    
    return {
        isValid: true,
        errors: null,
        data: value
    };
};

// Rate limiting validation for score updates
const scoreUpdateRateLimit = new Map();

const validateScoreUpdateRate = (playerId, maxUpdatesPerMinute = 60) => {
    const now = Date.now();
    const minuteAgo = now - 60 * 1000;
    
    if (!scoreUpdateRateLimit.has(playerId)) {
        scoreUpdateRateLimit.set(playerId, []);
    }
    
    const playerUpdates = scoreUpdateRateLimit.get(playerId);
    
    // Remove old updates
    const recentUpdates = playerUpdates.filter(timestamp => timestamp > minuteAgo);
    scoreUpdateRateLimit.set(playerId, recentUpdates);
    
    if (recentUpdates.length >= maxUpdatesPerMinute) {
        return {
            allowed: false,
            remaining: 0,
            resetTime: Math.ceil((recentUpdates[0] + 60 * 1000 - now) / 1000)
        };
    }
    
    // Add current update
    recentUpdates.push(now);
    scoreUpdateRateLimit.set(playerId, recentUpdates);
    
    return {
        allowed: true,
        remaining: maxUpdatesPerMinute - recentUpdates.length,
        resetTime: 60
    };
};

// Export validation middleware
module.exports = {
    // Player validation
    validateCreatePlayer: createValidationMiddleware(playerSchemas.create),
    validateUpdatePlayer: createValidationMiddleware(playerSchemas.update),
    validatePlayerScoreUpdate: createValidationMiddleware(playerSchemas.scoreUpdate),
    
    // Leaderboard validation
    validateLeaderboardQuery: createQueryValidationMiddleware(leaderboardSchemas.query),
    
    // Game session validation
    validateCreateSession: createValidationMiddleware(sessionSchemas.create),
    validateJoinSession: createValidationMiddleware(sessionSchemas.join),
    validateSessionScoreUpdate: createValidationMiddleware(sessionSchemas.scoreUpdate),
    
    // Socket validation utilities
    validateSocketData,
    socketSchemas,
    
    // Rate limiting
    validateScoreUpdateRate,
    
    // Custom validation middleware
    validatePlayerId: (req, res, next) => {
        const { playerId } = req.params;
        
        if (!playerId || typeof playerId !== 'string' || playerId.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid player ID'
            });
        }
        
        req.params.playerId = playerId.trim();
        next();
    },
    
    validateSessionId: (req, res, next) => {
        const { sessionId } = req.params;
        
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid session ID'
            });
        }
        
        req.params.sessionId = sessionId.trim();
        next();
    }
}; 