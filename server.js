require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

// Import services and configurations
const DatabaseManager = require('./src/config/database');
const SocketService = require('./src/services/socketService');

// Import routes
const playersRouter = require('./src/routes/players');
const leaderboardRouter = require('./src/routes/leaderboard');
const sessionsRouter = require('./src/routes/sessions');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Environment configuration
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

// CORS configuration
const corsOptions = {
    origin: NODE_ENV === 'production' ? CORS_ORIGIN : true,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Initialize Socket.IO with CORS
const io = socketIo(server, {
    cors: corsOptions,
    pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT) || 5000,
    pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL) || 25000,
    transports: ['websocket', 'polling']
});

// Middleware setup
app.use(helmet({
    contentSecurityPolicy: NODE_ENV === 'production',
    crossOriginEmbedderPolicy: NODE_ENV === 'production'
}));

app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`📝 ${timestamp} - ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    const healthInfo = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: NODE_ENV,
        database: DatabaseManager.getConnectionState(),
        socketConnections: socketService ? socketService.getConnectedPlayersCount() : 0,
        memoryUsage: process.memoryUsage(),
        version: require('./package.json').version
    };
    
    res.status(200).json(healthInfo);
});

// API documentation endpoint
app.get('/api', (req, res) => {
    const apiDocs = {
        title: 'Real-Time Leaderboard System API',
        version: '1.0.0',
        description: 'High-performance real-time leaderboard system for gaming applications',
        endpoints: {
            players: {
                'POST /api/players': 'Create a new player',
                'GET /api/players/:playerId': 'Get player by ID',
                'PUT /api/players/:playerId': 'Update player information',
                'POST /api/players/:playerId/score': 'Update player score',
                'GET /api/players/:playerId/rank': 'Get player rank',
                'POST /api/players/:playerId/game-result': 'Add game result',
                'GET /api/players/:playerId/stats': 'Get detailed player statistics'
            },
            leaderboard: {
                'GET /api/leaderboard': 'Get leaderboard with filtering and pagination',
                'GET /api/leaderboard/top/:count': 'Get top N players',
                'GET /api/leaderboard/regions': 'Get leaderboards for all regions',
                'GET /api/leaderboard/game-modes': 'Get leaderboards for all game modes',
                'GET /api/leaderboard/around/:playerId': 'Get leaderboard around a player',
                'GET /api/leaderboard/stats': 'Get leaderboard statistics',
                'GET /api/leaderboard/live': 'Get real-time leaderboard updates'
            },
            sessions: {
                'POST /api/sessions': 'Create a new game session',
                'GET /api/sessions/:sessionId': 'Get session details',
                'POST /api/sessions/:sessionId/join': 'Join a game session',
                'POST /api/sessions/:sessionId/leave': 'Leave a game session',
                'POST /api/sessions/:sessionId/score': 'Update score in session',
                'POST /api/sessions/:sessionId/end': 'End a game session',
                'GET /api/sessions': 'Get active sessions',
                'GET /api/sessions/:sessionId/events': 'Get session events',
                'GET /api/sessions/stats': 'Get session statistics'
            }
        },
        socketEvents: {
            client: {
                'player:join': 'Join the leaderboard system',
                'score:update': 'Update player score',
                'player:status': 'Update player online status',
                'leaderboard:subscribe': 'Subscribe to leaderboard updates',
                'leaderboard:unsubscribe': 'Unsubscribe from leaderboard',
                'session:join': 'Join a game session room',
                'session:leave': 'Leave a game session room',
                'ping': 'Heartbeat ping'
            },
            server: {
                'player:joined': 'Player successfully joined',
                'score:updated': 'Score update confirmation',
                'leaderboard:score_updated': 'Real-time score update broadcast',
                'player:online': 'Player came online',
                'player:offline': 'Player went offline',
                'session:score_updated': 'Session score update',
                'session:ended': 'Session ended with results',
                'error': 'Error occurred',
                'pong': 'Heartbeat response'
            }
        },
        regions: ['NA', 'EU', 'ASIA', 'SA', 'OCE', 'GLOBAL'],
        gameModes: ['classic', 'blitz', 'survival', 'team', 'ranked'],
        generatedAt: new Date().toISOString()
    };
    
    res.status(200).json(apiDocs);
});

// Initialize Socket Service
let socketService;

// API Routes
app.use('/api/players', playersRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/sessions', sessionsRouter);

// Make socket service available to routes
app.locals.socketService = null;

// Global error handling middleware
app.use((error, req, res, next) => {
    console.error('🚨 Global error handler:', error);
    
    res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: NODE_ENV === 'production' ? 'INTERNAL_SERVER_ERROR' : error.stack
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.path} not found`,
        error: 'NOT_FOUND',
        availableRoutes: {
            api: '/api',
            health: '/health',
            players: '/api/players',
            leaderboard: '/api/leaderboard',
            sessions: '/api/sessions'
        }
    });
});

// Server startup function
async function startServer() {
    try {
        console.log('🚀 Starting Real-Time Leaderboard System...');
        
        // Connect to MongoDB
        await DatabaseManager.connect();
        console.log('✅ Database connection established');
        
        // Initialize Socket Service
        socketService = new SocketService(io);
        app.locals.socketService = socketService;
        console.log('✅ Socket.IO service initialized');
        
        // Start the server
        server.listen(PORT, () => {
            console.log('\n🎯 Real-Time Leaderboard System is running!');
            console.log(`📡 Server: http://localhost:${PORT}`);
            console.log(`🔗 API Documentation: http://localhost:${PORT}/api`);
            console.log(`💓 Health Check: http://localhost:${PORT}/health`);
            console.log(`🌍 Environment: ${NODE_ENV}`);
            console.log(`🔌 WebSocket ready for real-time connections`);
            
            if (NODE_ENV === 'development') {
                console.log('\n📊 Development Features:');
                console.log('  • Auto-restart with nodemon');
                console.log('  • Detailed error messages');
                console.log('  • CORS enabled for all origins');
                console.log('  • Socket.IO transport polling + websocket');
                
                console.log('\n🔧 Quick Test Commands:');
                console.log(`  curl http://localhost:${PORT}/health`);
                console.log(`  curl http://localhost:${PORT}/api`);
                console.log(`  curl -X POST http://localhost:${PORT}/api/players -H "Content-Type: application/json" -d '{"username":"testuser","region":"NA"}'`);
            }
            
            console.log('\n' + '='.repeat(60));
        });
        
        // Performance monitoring
        if (NODE_ENV === 'development') {
            setInterval(() => {
                const memUsage = process.memoryUsage();
                const connections = socketService ? socketService.getConnectedPlayersCount() : 0;
                
                console.log(`\n📈 Performance Monitor:`);
                console.log(`  Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
                console.log(`  Active Connections: ${connections}`);
                console.log(`  Uptime: ${Math.round(process.uptime())}s`);
            }, 60000); // Every minute
        }
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('\n🔄 SIGTERM received, shutting down gracefully...');
    
    server.close(async () => {
        console.log('🔌 HTTP server closed');
        
        try {
            await DatabaseManager.disconnect();
            console.log('💾 Database connection closed');
        } catch (error) {
            console.error('❌ Error closing database:', error);
        }
        
        console.log('✅ Graceful shutdown completed');
        process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
        console.error('⚠️ Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 SIGINT received, shutting down...');
    
    server.close(async () => {
        try {
            await DatabaseManager.disconnect();
            console.log('✅ Shutdown completed');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = { app, server, io }; 