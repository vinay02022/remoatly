const mongoose = require('mongoose');
const dns = require('dns');
require('dotenv').config();

// Set DNS servers to use Cloudflare and Google DNS
dns.setServers(['1.1.1.1', '8.8.8.8']);

class DatabaseManager {
    constructor() {
        this.connectionState = mongoose.connection.readyState;
        this.setupEventListeners();
    }

    async connect() {
        try {
            const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/leaderboard_db';
            
            // Debug: Log what URI we're using (hide password for security)
            const safeUri = mongoUri.replace(/:([^:@]{1,})@/, ':****@');
            console.log('🔄 Connecting to MongoDB...');
            console.log('📍 Using URI:', safeUri);
            console.log('🔧 Environment loaded:', !!process.env.MONGODB_URI);
            
            const options = {
                maxPoolSize: parseInt(process.env.DB_CONNECTION_POOL_SIZE) || 10,
                serverSelectionTimeoutMS: process.env.NODE_ENV === 'production' ? 5000 : 30000,
                socketTimeoutMS: 45000,
                connectTimeoutMS: process.env.NODE_ENV === 'production' ? 10000 : 30000,
                bufferCommands: false,
                ...(process.env.NODE_ENV !== 'production' && { family: 4 }), // Only force IPv4 in dev
            };

            await mongoose.connect(mongoUri, options);
            console.log('✅ MongoDB connected successfully');
            
            // Create indexes for performance optimization
            await this.createIndexes();
            
        } catch (error) {
            console.error('❌ MongoDB connection failed:', error.message);
            process.exit(1);
        }
    }

    async createIndexes() {
        try {
            const collections = await mongoose.connection.db.listCollections().toArray();
            
            // Only create indexes if collections exist or will be created
            if (collections.length > 0 || process.env.NODE_ENV === 'development') {
                // We'll create indexes when models are defined
                console.log('📊 Database indexes will be created with models');
            }
        } catch (error) {
            console.warn('⚠️ Could not create indexes:', error.message);
        }
    }

    setupEventListeners() {
        mongoose.connection.on('connected', () => {
            console.log('🟢 Mongoose connected to MongoDB');
        });

        mongoose.connection.on('error', (err) => {
            console.error('🔴 Mongoose connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('🟡 Mongoose disconnected from MongoDB');
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            try {
                await mongoose.connection.close();
                console.log('🔚 MongoDB connection closed through app termination');
                process.exit(0);
            } catch (error) {
                console.error('Error during database shutdown:', error);
                process.exit(1);
            }
        });
    }

    getConnectionState() {
        const states = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting'
        };
        return states[mongoose.connection.readyState];
    }

    async disconnect() {
        await mongoose.connection.close();
    }
}

module.exports = new DatabaseManager(); 