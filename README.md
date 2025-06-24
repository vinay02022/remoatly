# 🏆 Real-Time Leaderboard System

A high-performance, scalable real-time leaderboard system built with Node.js, Socket.io, and MongoDB. Designed for gaming applications requiring instant score updates, regional filtering, and multi-game mode support.

## 🌟 Features

### Core Functionality
- ✅ **Real-time score updates** via WebSockets
- ✅ **Regional leaderboards** (NA, EU, ASIA, SA, OCE, GLOBAL)
- ✅ **Multi-game mode support** (Classic, Blitz, Survival, Team, Ranked)
- ✅ **Player management** with comprehensive statistics
- ✅ **Game sessions** with live tracking
- ✅ **Optimized MongoDB queries** with proper indexing

### Performance Features
- 🚀 **Database indexing** for sub-second queries
- 🚀 **Connection pooling** for optimal database performance
- 🚀 **Rate limiting** for score updates
- 🚀 **Efficient pagination** for large datasets
- 🚀 **Memory-optimized** data structures

### Real-time Features
- 🔴 **Live score broadcasting** to connected clients
- 🔴 **Player online/offline status** tracking
- 🔴 **Game session events** (join, leave, score updates)
- 🔴 **Regional and game mode filtering** for targeted updates

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │  Load Balancer  │    │   Monitoring    │
│  (Web/Mobile)   │    │    (Optional)   │    │    Dashboard    │
└─────────┬───────┘    └─────────┬───────┘    └─────────────────┘
          │                      │
          │              ┌───────▼───────┐
          │              │  Node.js App  │
          │              │  + Socket.IO  │
          │              └───────┬───────┘
          │                      │
    ┌─────▼──────┐      ┌────────▼────────┐
    │ WebSocket  │      │   REST API      │
    │ Real-time  │      │   HTTP/HTTPS    │
    │ Updates    │      │   Endpoints     │
    └────────────┘      └─────────────────┘
                                │
                        ┌───────▼────────┐
                        │   MongoDB      │
                        │   Database     │
                        │ + Indexes      │
                        └────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js (≥16.0.0)
- MongoDB (≥4.4) or MongoDB Atlas account
- npm or yarn

### Installation

1. **Clone and setup the project**
```bash
git clone <repository-url>
cd realtime-leaderboard-system
npm install
```

2. **Configure environment variables**
```bash
# Copy the example environment file
cp config.env.example .env

# Edit the .env file with your configuration
```

3. **Required Environment Variables**
```env
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/leaderboard_db
# For MongoDB Atlas: mongodb+srv://username:password@cluster.mongodb.net/leaderboard_db

# Server Configuration
PORT=3000
NODE_ENV=development

# Application Settings
MAX_LEADERBOARD_SIZE=1000
CACHE_TTL_SECONDS=60
DEFAULT_REGION=global

# Performance Settings
DB_CONNECTION_POOL_SIZE=10
SOCKET_PING_TIMEOUT=5000
SOCKET_PING_INTERVAL=25000
```

4. **Start the server**
```bash
# Development mode (with auto-restart)
npm run dev

# Production mode
npm start
```

### Verification

Visit these endpoints to verify the installation:
- **Health Check**: `http://localhost:3000/health`
- **API Documentation**: `http://localhost:3000/api`
- **Test Player Creation**: 
```bash
curl -X POST http://localhost:3000/api/players \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","region":"NA"}'
```

## 📖 API Documentation

### Authentication
Currently, the API is public for development. In production, implement proper authentication for score updates and player management.

### Base URL
```
Development: http://localhost:3000
Production: https://your-domain.com
```

### Player Management

#### Create Player
```http
POST /api/players
Content-Type: application/json

{
  "username": "player123",
  "region": "NA",
  "email": "player@example.com" // optional
}
```

#### Get Player Details
```http
GET /api/players/{playerId}
```

#### Update Player Score
```http
POST /api/players/{playerId}/score
Content-Type: application/json

{
  "score": 1500,
  "gameMode": "ranked",
  "delta": 100,
  "reason": "match_win"
}
```

### Leaderboard Queries

#### Get Leaderboard
```http
GET /api/leaderboard?limit=50&page=1&region=NA&gameMode=ranked&onlineOnly=true
```

#### Get Top N Players
```http
GET /api/leaderboard/top/10?region=EU&gameMode=blitz
```

#### Get Players Around Specific Player
```http
GET /api/leaderboard/around/{playerId}?range=5
```

### Game Sessions

#### Create Game Session
```http
POST /api/sessions
Content-Type: application/json

{
  "gameMode": "blitz",
  "region": "NA",
  "maxPlayers": 4,
  "gameSettings": {
    "timeLimit": 300,
    "difficulty": "medium"
  }
}
```

#### Join Session
```http
POST /api/sessions/{sessionId}/join
Content-Type: application/json

{
  "playerId": "player-uuid",
  "username": "player123"
}
```

## 🔌 Socket.IO Events

### Client Events (Send to Server)

```javascript
// Connect and join leaderboard system
socket.emit('player:join', {
  playerId: 'player-uuid',
  region: 'NA',
  gameMode: 'ranked'
});

// Update score in real-time
socket.emit('score:update', {
  playerId: 'player-uuid',
  score: 1500,
  delta: 100,
  gameMode: 'ranked'
});

// Update online status
socket.emit('player:status', {
  playerId: 'player-uuid',
  isOnline: true
});

// Subscribe to leaderboard updates
socket.emit('leaderboard:subscribe', {
  region: 'NA',
  gameMode: 'ranked'
});
```

### Server Events (Receive from Server)

```javascript
// Player successfully joined
socket.on('player:joined', (data) => {
  console.log('Joined successfully:', data);
});

// Real-time score updates
socket.on('leaderboard:score_updated', (data) => {
  console.log('Score update:', data);
  // Update UI with new score
});

// Player status changes
socket.on('player:online', (data) => {
  console.log('Player came online:', data);
});

socket.on('player:offline', (data) => {
  console.log('Player went offline:', data);
});

// Session events
socket.on('session:score_updated', (data) => {
  console.log('Session score update:', data);
});

// Error handling
socket.on('error', (error) => {
  console.error('Socket error:', error);
});
```

## 🗄️ Database Schema

### Player Document
```javascript
{
  playerId: "uuid-string",
  username: "player123",
  email: "player@example.com",
  region: "NA",
  currentScore: 1500,
  currentGameMode: "ranked",
  totalGamesPlayed: 25,
  averageScore: 1200,
  bestScore: 1850,
  isOnline: true,
  lastActiveAt: "2024-01-15T10:30:00Z",
  gameStats: {
    wins: 15,
    losses: 8,
    draws: 2
  },
  achievements: [...],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-15T10:30:00Z"
}
```

### Game Session Document
```javascript
{
  sessionId: "game_uuid-string",
  gameMode: "blitz",
  region: "NA",
  status: "active",
  maxPlayers: 4,
  players: [
    {
      playerId: "player-uuid",
      username: "player123",
      currentSessionScore: 500,
      position: 1,
      isActive: true
    }
  ],
  gameSettings: {
    timeLimit: 300,
    difficulty: "medium"
  },
  realTimeEvents: [...],
  startedAt: "2024-01-15T10:00:00Z",
  endedAt: null,
  duration: null
}
```

## 🔧 Performance Optimization

### Database Indexes
The system automatically creates optimized indexes:

```javascript
// Player indexes
{ region: 1, currentScore: -1 }
{ currentGameMode: 1, currentScore: -1 }
{ region: 1, currentGameMode: 1, currentScore: -1 }
{ isOnline: 1, currentScore: -1 }

// Session indexes
{ status: 1, createdAt: -1 }
{ gameMode: 1, region: 1, status: 1 }
{ 'players.playerId': 1, status: 1 }
```

### Performance Tips

1. **Pagination**: Always use pagination for large result sets
2. **Filtering**: Apply region and game mode filters to reduce query scope
3. **Lean Queries**: The system uses `.lean()` for read-only operations
4. **Connection Pooling**: Configured for optimal concurrent connections
5. **Rate Limiting**: Score updates are rate-limited to prevent abuse

## 🔒 Security Considerations

### Production Checklist
- [ ] Implement proper authentication (JWT tokens)
- [ ] Add input sanitization middleware
- [ ] Configure CORS for specific domains
- [ ] Enable MongoDB authentication
- [ ] Use HTTPS for all connections
- [ ] Add request rate limiting
- [ ] Implement API key authentication
- [ ] Add logging and monitoring
- [ ] Secure environment variables

### Example Authentication Middleware
```javascript
// Add to routes that need protection
const authenticatePlayer = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  // Verify JWT token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.playerId = decoded.playerId;
    next();
  });
};
```

## 📊 Monitoring & Analytics

### Health Monitoring
```bash
# Check system health
curl http://localhost:3000/health

# Response includes:
{
  "status": "healthy",
  "uptime": 3600,
  "database": "connected",
  "socketConnections": 150,
  "memoryUsage": {...}
}
```

### Performance Metrics
- Active WebSocket connections
- Database query performance
- Memory usage and heap size
- Average response times
- Error rates

## 🧪 Testing

### Manual Testing Commands
```bash
# Create a test player
curl -X POST http://localhost:3000/api/players \
  -H "Content-Type: application/json" \
  -d '{"username":"testplayer","region":"NA","currentGameMode":"ranked"}'

# Update player score
curl -X POST http://localhost:3000/api/players/{playerId}/score \
  -H "Content-Type: application/json" \
  -d '{"score":1500,"delta":100,"reason":"match_win"}'

# Get leaderboard
curl "http://localhost:3000/api/leaderboard?limit=10&region=NA"

# Create game session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"gameMode":"blitz","region":"NA","maxPlayers":4}'
```

### WebSocket Testing (Browser Console)
```javascript
// Connect to Socket.IO
const socket = io('http://localhost:3000');

// Join as a player
socket.emit('player:join', {
  playerId: 'test-player-123',
  region: 'NA',
  gameMode: 'ranked'
});

// Listen for events
socket.on('player:joined', console.log);
socket.on('leaderboard:score_updated', console.log);
```

## 🚀 Deployment

### Using PM2 (Recommended)
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start server.js --name "leaderboard-system"

# Monitor
pm2 monit

# Auto-restart on file changes (development)
pm2 start server.js --name "leaderboard-dev" --watch
```

### Docker Deployment
```dockerfile
# Dockerfile
FROM node:16-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE 3000

CMD ["node", "server.js"]
```

### Environment Variables for Production
```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/leaderboard_prod
PORT=3000
CORS_ORIGIN=https://yourgame.com
JWT_SECRET=your-super-secret-jwt-key
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For issues and questions:
1. Check the [Health Check endpoint](http://localhost:3000/health)
2. Review server logs for error messages
3. Ensure MongoDB is running and accessible
4. Verify environment variables are set correctly

---

**Built with ❤️ for high-performance gaming applications** "# remoatly" 
