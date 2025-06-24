#!/usr/bin/env node

/**
 * Real-Time Leaderboard System Test Script
 * 
 * This script tests all major functionality of the leaderboard system:
 * - Player creation and management
 * - Score updates
 * - Leaderboard queries
 * - Game sessions
 * - Socket.IO real-time events
 */

const axios = require('axios');
const io = require('socket.io-client');

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const API_URL = `${BASE_URL}/api`;

// Test data
const testPlayers = [
    { username: 'ProGamer_1', region: 'NA', gameMode: 'ranked' },
    { username: 'ElitePlayer_2', region: 'EU', gameMode: 'blitz' },
    { username: 'AceShooter_3', region: 'ASIA', gameMode: 'classic' },
    { username: 'MasterPlayer_4', region: 'NA', gameMode: 'ranked' },
    { username: 'Champion_5', region: 'EU', gameMode: 'survival' }
];

let createdPlayers = [];
let gameSession = null;
let socket = null;

// Utility functions
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const logSuccess = (message) => console.log(`✅ ${message}`);
const logError = (message) => console.log(`❌ ${message}`);
const logInfo = (message) => console.log(`ℹ️  ${message}`);
const logStep = (message) => console.log(`\n🔄 ${message}`);

async function makeRequest(method, url, data = null) {
    try {
        const config = {
            method,
            url: `${API_URL}${url}`,
            headers: { 'Content-Type': 'application/json' }
        };
        
        if (data) {
            config.data = data;
        }
        
        const response = await axios(config);
        return response.data;
    } catch (error) {
        throw new Error(`${method} ${url}: ${error.response?.data?.message || error.message}`);
    }
}

// Test functions
async function testHealthCheck() {
    logStep('Testing Health Check');
    try {
        const response = await axios.get(`${BASE_URL}/health`);
        const health = response.data;
        
        logSuccess(`Server is healthy (uptime: ${Math.round(health.uptime)}s)`);
        logInfo(`Database: ${health.database}`);
        logInfo(`Environment: ${health.environment}`);
        logInfo(`Memory: ${Math.round(health.memoryUsage.heapUsed / 1024 / 1024)}MB`);
        
        return true;
    } catch (error) {
        logError(`Health check failed: ${error.message}`);
        return false;
    }
}

async function testPlayerCreation() {
    logStep('Testing Player Creation');
    
    for (const playerData of testPlayers) {
        try {
            const result = await makeRequest('POST', '/players', playerData);
            
            if (result.success) {
                createdPlayers.push(result.data);
                logSuccess(`Created player: ${result.data.username} (${result.data.playerId})`);
            } else {
                logError(`Failed to create player: ${playerData.username}`);
            }
        } catch (error) {
            logError(`Player creation error: ${error.message}`);
        }
    }
    
    return createdPlayers.length > 0;
}

async function testScoreUpdates() {
    logStep('Testing Score Updates');
    
    for (let i = 0; i < createdPlayers.length; i++) {
        const player = createdPlayers[i];
        const score = Math.floor(Math.random() * 2000) + 500; // Random score 500-2500
        
        try {
            const result = await makeRequest('POST', `/players/${player.playerId}/score`, {
                score,
                delta: score - player.currentScore,
                gameMode: player.currentGameMode,
                reason: 'test_update'
            });
            
            if (result.success) {
                logSuccess(`Updated ${player.username}'s score to ${score}`);
                // Update local data
                player.currentScore = result.data.currentScore;
            } else {
                logError(`Failed to update score for ${player.username}`);
            }
        } catch (error) {
            logError(`Score update error: ${error.message}`);
        }
        
        await delay(100); // Small delay between updates
    }
    
    return true;
}

async function testLeaderboardQueries() {
    logStep('Testing Leaderboard Queries');
    
    try {
        // Test basic leaderboard
        const leaderboard = await makeRequest('GET', '/leaderboard?limit=10');
        if (leaderboard.success && leaderboard.data.leaderboard.length > 0) {
            logSuccess(`Retrieved leaderboard with ${leaderboard.data.leaderboard.length} players`);
            
            // Display top 3 players
            leaderboard.data.leaderboard.slice(0, 3).forEach((player, index) => {
                logInfo(`  ${index + 1}. ${player.username}: ${player.currentScore} points`);
            });
        }
        
        // Test regional leaderboard
        const regionalBoard = await makeRequest('GET', '/leaderboard?region=NA&limit=5');
        if (regionalBoard.success) {
            logSuccess(`Retrieved NA regional leaderboard (${regionalBoard.data.leaderboard.length} players)`);
        }
        
        // Test top players
        const topPlayers = await makeRequest('GET', '/leaderboard/top/5');
        if (topPlayers.success) {
            logSuccess(`Retrieved top 5 players`);
        }
        
        // Test leaderboard stats
        const stats = await makeRequest('GET', '/leaderboard/stats');
        if (stats.success) {
            logSuccess(`Retrieved leaderboard statistics`);
            logInfo(`  Total players: ${stats.data.players.total}`);
            logInfo(`  Online players: ${stats.data.players.online}`);
            logInfo(`  Average score: ${stats.data.scores.average}`);
        }
        
        return true;
    } catch (error) {
        logError(`Leaderboard query error: ${error.message}`);
        return false;
    }
}

async function testGameSessions() {
    logStep('Testing Game Sessions');
    
    try {
        // Create a game session
        const sessionData = {
            gameMode: 'blitz',
            region: 'NA',
            maxPlayers: 4,
            gameSettings: {
                timeLimit: 300,
                difficulty: 'medium'
            }
        };
        
        const sessionResult = await makeRequest('POST', '/sessions', sessionData);
        if (sessionResult.success) {
            gameSession = sessionResult.data;
            logSuccess(`Created game session: ${gameSession.sessionId}`);
        }
        
        // Join players to the session
        const playersToJoin = createdPlayers.filter(p => p.region === 'NA').slice(0, 2);
        
        for (const player of playersToJoin) {
            try {
                const joinResult = await makeRequest('POST', `/sessions/${gameSession.sessionId}/join`, {
                    playerId: player.playerId,
                    username: player.username
                });
                
                if (joinResult.success) {
                    logSuccess(`${player.username} joined session`);
                }
            } catch (error) {
                logError(`Failed to join session: ${error.message}`);
            }
            
            await delay(100);
        }
        
        // Update scores in session
        for (const player of playersToJoin) {
            try {
                const sessionScore = Math.floor(Math.random() * 1000) + 100;
                const scoreResult = await makeRequest('POST', `/sessions/${gameSession.sessionId}/score`, {
                    playerId: player.playerId,
                    score: sessionScore,
                    delta: sessionScore,
                    reason: 'session_gameplay'
                });
                
                if (scoreResult.success) {
                    logSuccess(`Updated ${player.username}'s session score to ${sessionScore}`);
                }
            } catch (error) {
                logError(`Session score update error: ${error.message}`);
            }
            
            await delay(100);
        }
        
        // Get session details
        const sessionDetails = await makeRequest('GET', `/sessions/${gameSession.sessionId}`);
        if (sessionDetails.success) {
            logSuccess(`Retrieved session details (${sessionDetails.data.playerCount} players)`);
        }
        
        return true;
    } catch (error) {
        logError(`Game session error: ${error.message}`);
        return false;
    }
}

async function testSocketConnection() {
    logStep('Testing Socket.IO Connection');
    
    return new Promise((resolve) => {
        socket = io(BASE_URL, {
            transports: ['websocket', 'polling']
        });
        
        let eventsReceived = 0;
        const expectedEvents = 3; // join, score update, status
        
        const timeout = setTimeout(() => {
            logError('Socket.IO test timeout');
            socket.disconnect();
            resolve(false);
        }, 10000);
        
        socket.on('connect', () => {
            logSuccess('Connected to Socket.IO server');
            
            // Test player join
            const testPlayer = createdPlayers[0];
            socket.emit('player:join', {
                playerId: testPlayer.playerId,
                region: testPlayer.region,
                gameMode: testPlayer.currentGameMode
            });
        });
        
        socket.on('player:joined', (data) => {
            logSuccess(`Socket: Player joined successfully (${data.username})`);
            eventsReceived++;
            
            // Test score update
            socket.emit('score:update', {
                playerId: data.playerId,
                score: data.currentScore + 50,
                delta: 50,
                gameMode: data.gameMode,
                reason: 'socket_test'
            });
        });
        
        socket.on('score:updated', (data) => {
            logSuccess(`Socket: Score updated (${data.newScore})`);
            eventsReceived++;
            
            // Test status update
            socket.emit('player:status', {
                playerId: data.playerId,
                isOnline: true
            });
        });
        
        socket.on('player:status_updated', (data) => {
            logSuccess(`Socket: Status updated (online: ${data.isOnline})`);
            eventsReceived++;
            
            if (eventsReceived >= expectedEvents) {
                clearTimeout(timeout);
                socket.disconnect();
                logSuccess('All Socket.IO events tested successfully');
                resolve(true);
            }
        });
        
        socket.on('leaderboard:score_updated', (data) => {
            logInfo(`Socket: Received real-time leaderboard update for ${data.username}`);
        });
        
        socket.on('error', (error) => {
            logError(`Socket error: ${error.message}`);
            clearTimeout(timeout);
            socket.disconnect();
            resolve(false);
        });
        
        socket.on('connect_error', (error) => {
            logError(`Socket connection error: ${error.message}`);
            clearTimeout(timeout);
            resolve(false);
        });
    });
}

async function testCleanup() {
    logStep('Cleaning up test data');
    
    // Note: In a real system, you'd want DELETE endpoints
    // For now, just disconnect socket and show completion
    
    if (socket && socket.connected) {
        socket.disconnect();
        logSuccess('Disconnected from Socket.IO');
    }
    
    logInfo('Test players created (cleanup manually if needed):');
    createdPlayers.forEach(player => {
        logInfo(`  - ${player.username} (${player.playerId})`);
    });
    
    if (gameSession) {
        logInfo(`Game session created: ${gameSession.sessionId}`);
    }
}

async function runAllTests() {
    console.log('🚀 Starting Real-Time Leaderboard System Tests\n');
    console.log('='.repeat(60));
    
    const results = {
        health: false,
        players: false,
        scores: false,
        leaderboard: false,
        sessions: false,
        sockets: false
    };
    
    try {
        // Test sequence
        results.health = await testHealthCheck();
        if (!results.health) {
            logError('Health check failed. Ensure server is running.');
            return;
        }
        
        results.players = await testPlayerCreation();
        await delay(500);
        
        results.scores = await testScoreUpdates();
        await delay(500);
        
        results.leaderboard = await testLeaderboardQueries();
        await delay(500);
        
        results.sessions = await testGameSessions();
        await delay(500);
        
        results.sockets = await testSocketConnection();
        await delay(500);
        
        await testCleanup();
        
    } catch (error) {
        logError(`Test suite error: ${error.message}`);
    }
    
    // Results summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Results Summary:');
    console.log('='.repeat(60));
    
    const testResults = [
        ['Health Check', results.health],
        ['Player Creation', results.players],
        ['Score Updates', results.scores],
        ['Leaderboard Queries', results.leaderboard],
        ['Game Sessions', results.sessions],
        ['Socket.IO Events', results.sockets]
    ];
    
    testResults.forEach(([name, passed]) => {
        const icon = passed ? '✅' : '❌';
        const status = passed ? 'PASSED' : 'FAILED';
        console.log(`${icon} ${name.padEnd(20)} ${status}`);
    });
    
    const passedTests = Object.values(results).filter(Boolean).length;
    const totalTests = Object.keys(results).length;
    
    console.log('\n' + '='.repeat(60));
    console.log(`🎯 Overall Result: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
        console.log('🎉 All tests passed! Your leaderboard system is working correctly.');
    } else {
        console.log('⚠️  Some tests failed. Check the error messages above.');
    }
    
    console.log('\n💡 Next steps:');
    console.log('  • Check the API documentation at http://localhost:3000/api');
    console.log('  • Monitor system health at http://localhost:3000/health');
    console.log('  • View leaderboard at http://localhost:3000/api/leaderboard');
    console.log('  • Implement frontend integration using the Socket.IO events');
    
    process.exit(passedTests === totalTests ? 0 : 1);
}

// Handle script execution
if (require.main === module) {
    // Check if server is specified
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log('Usage: node test-system.js [options]');
        console.log('');
        console.log('Options:');
        console.log('  --help, -h     Show this help message');
        console.log('  --url <url>    Specify server URL (default: http://localhost:3000)');
        console.log('');
        console.log('Environment variables:');
        console.log('  BASE_URL       Server base URL (default: http://localhost:3000)');
        console.log('');
        console.log('Examples:');
        console.log('  node test-system.js');
        console.log('  node test-system.js --url http://localhost:3000');
        console.log('  BASE_URL=http://localhost:3000 node test-system.js');
        process.exit(0);
    }
    
    const urlIndex = process.argv.indexOf('--url');
    if (urlIndex !== -1 && process.argv[urlIndex + 1]) {
        process.env.BASE_URL = process.argv[urlIndex + 1];
    }
    
    console.log(`🔧 Testing server at: ${BASE_URL}`);
    runAllTests().catch(console.error);
} 