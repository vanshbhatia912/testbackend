const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);

// Enhanced Socket.IO configuration for multi-user WebRTC
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    transports: ['websocket', 'polling'], // Support both for better compatibility
    allowEIO3: true,
    pingTimeout: 60000,        // Longer timeout for cross-platform
    pingInterval: 25000,       // More frequent pings
    upgradeTimeout: 10000,     // Extended upgrade timeout
    maxHttpBufferSize: 10e6,
    compression: true,
    perMessageDeflate: {
        threshold: 1024,
        concurrencyLimit: 10,
        windowBits: 15,
        serverMaxNoContextTakeover: true
    }
});

// Middleware
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Enhanced session storage with multi-user support
const sessions = new Map();
const connectedClients = new Map();
const userColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];

// ICE servers with better cross-platform support
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Additional STUN servers for better connectivity
    { urls: 'stun:stun.12connect.com:3478' },
    { urls: 'stun:stun.12voip.com:3478' },
    { urls: 'stun:stun.1und1.de:3478' }
];

// Network quality monitoring
class NetworkQualityMonitor {
    constructor() {
        this.qualityLevels = {
            excellent: { minBandwidth: 5000000, maxLatency: 50, maxPacketLoss: 1 },
            good: { minBandwidth: 2000000, maxLatency: 100, maxPacketLoss: 3 },
            fair: { minBandwidth: 1000000, maxLatency: 200, maxPacketLoss: 5 },
            poor: { minBandwidth: 500000, maxLatency: 500, maxPacketLoss: 10 }
        };
    }

    assessQuality(bandwidth, latency, packetLoss) {
        if (bandwidth >= this.qualityLevels.excellent.minBandwidth && 
            latency <= this.qualityLevels.excellent.maxLatency && 
            packetLoss <= this.qualityLevels.excellent.maxPacketLoss) {
            return 'excellent';
        } else if (bandwidth >= this.qualityLevels.good.minBandwidth && 
                   latency <= this.qualityLevels.good.maxLatency && 
                   packetLoss <= this.qualityLevels.good.maxPacketLoss) {
            return 'good';
        } else if (bandwidth >= this.qualityLevels.fair.minBandwidth && 
                   latency <= this.qualityLevels.fair.maxLatency && 
                   packetLoss <= this.qualityLevels.fair.maxPacketLoss) {
            return 'fair';
        }
        return 'poor';
    }

    getRecommendedSettings(quality) {
        const settings = {
            excellent: { resolution: '2k', frameRate: 60, bitrate: 8000000 },
            good: { resolution: '1080p', frameRate: 60, bitrate: 4000000 },
            fair: { resolution: '720p', frameRate: 30, bitrate: 2000000 },
            poor: { resolution: '480p', frameRate: 24, bitrate: 1000000 }
        };
        return settings[quality] || settings.poor;
    }
}

const qualityMonitor = new NetworkQualityMonitor();

// Utility functions
function generateSessionId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generatePassword(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function generateUserName() {
    const adjectives = ['Swift', 'Bright', 'Cool', 'Smart', 'Fast', 'Pro', 'Elite', 'Super'];
    const nouns = ['User', 'Guest', 'Player', 'Client', 'Viewer', 'Remote', 'Control', 'Access'];
    return adjectives[Math.floor(Math.random() * adjectives.length)] + 
           nouns[Math.floor(Math.random() * nouns.length)] + 
           Math.floor(Math.random() * 100);
}

// Enhanced session class
class EnhancedSession {
    constructor(id, password, hostId, platform = 'unknown') {
        this.id = id;
        this.password = password;
        this.hostId = hostId;
        this.platform = platform;
        this.createdAt = new Date();
        this.isActive = false;
        this.maxUsers = 5;
        this.users = new Map(); // userId -> userInfo
        this.qualitySettings = {
            current: '1080p',
            adaptive: true,
            available: ['2k', '1080p', '720p', '480p']
        };
        this.networkStats = {
            totalBandwidth: 0,
            averageLatency: 0,
            packetLoss: 0,
            quality: 'good'
        };
        this.rtpPort = null;
    }

    addUser(userId, userInfo) {
        if (this.users.size >= this.maxUsers) {
            throw new Error('Session is full');
        }

        const color = userColors[this.users.size % userColors.length];
        const userName = userInfo.userName || generateUserName();

        this.users.set(userId, {
            ...userInfo,
            userName,
            color,
            joinedAt: new Date(),
            isConnected: false,
            networkQuality: 'unknown'
        });

        return { userName, color };
    }

    removeUser(userId) {
        return this.users.delete(userId);
    }

    getConnectedUsers() {
        return Array.from(this.users.entries())
            .filter(([_, user]) => user.isConnected)
            .map(([id, user]) => ({ id, ...user }));
    }

    updateNetworkStats(bandwidth, latency, packetLoss) {
        this.networkStats.totalBandwidth = bandwidth;
        this.networkStats.averageLatency = latency;
        this.networkStats.packetLoss = packetLoss;
        this.networkStats.quality = qualityMonitor.assessQuality(bandwidth, latency, packetLoss);
        
        // Adjust quality if adaptive is enabled
        if (this.qualitySettings.adaptive) {
            const recommended = qualityMonitor.getRecommendedSettings(this.networkStats.quality);
            if (recommended.resolution !== this.qualitySettings.current) {
                this.qualitySettings.current = recommended.resolution;
                return recommended;
            }
        }
        
        return null;
    }
}

// Routes
app.get('/', (req, res) => {
    res.json({
        name: 'Enhanced WebRTC Remote Desktop Server',
        version: '2.1.0',
        features: {
            multiUser: true,
            adaptiveQuality: true,
            crossPlatform: true,
            maxUsersPerSession: 5
        },
        sessions: sessions.size,
        clients: connectedClients.size,
        platform: os.platform(),
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    const memUsage = process.memoryUsage();
    const activeSessions = Array.from(sessions.values()).filter(s => s.isActive).length;
    const totalUsers = Array.from(sessions.values()).reduce((sum, s) => sum + s.users.size, 0);
    
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
        },
        sessions: {
            total: sessions.size,
            active: activeSessions,
            users: totalUsers
        },
        webrtc: {
            iceServers: ICE_SERVERS.length,
            multiUserSupport: true,
            adaptiveQuality: true
        },
        timestamp: new Date().toISOString()
    });
});

app.get('/api/sessions', (req, res) => {
    const sessionList = Array.from(sessions.values()).map(session => ({
        id: session.id,
        isActive: session.isActive,
        platform: session.platform,
        userCount: session.users.size,
        maxUsers: session.maxUsers,
        quality: session.qualitySettings.current,
        networkQuality: session.networkStats.quality,
        createdAt: session.createdAt
    }));
    
    res.json(sessionList);
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    const clientInfo = {
        id: socket.id,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        connectedAt: new Date(),
        platform: 'unknown',
        latency: 0
    };
    
    connectedClients.set(socket.id, clientInfo);
    
    console.log(`🔗 Client connected: ${socket.id} from ${clientInfo.ip}`);
    console.log(`📊 Total clients: ${connectedClients.size}, Sessions: ${sessions.size}`);

    // Send ICE servers
    socket.emit('ice-servers', { iceServers: ICE_SERVERS });

    // Ping/pong for latency measurement
    socket.on('ping', (timestamp) => {
        const latency = Date.now() - timestamp;
        clientInfo.latency = latency;
        socket.emit('pong', { timestamp, latency });
    });

    // Create session
    socket.on('create-session', (data) => {
        const { platform = 'unknown', maxUsers = 5, webrtcCapabilities = {} } = data;
        
        const sessionId = generateSessionId();
        const password = generatePassword();
        
        const session = new EnhancedSession(sessionId, password, socket.id, platform);
        session.maxUsers = Math.min(maxUsers, 5); // Enforce max limit
        
        sessions.set(sessionId, session);
        socket.join(`session-${sessionId}`);
        
        // Add host as first user
        try {
            const hostInfo = session.addUser(socket.id, {
                isHost: true,
                platform,
                webrtcCapabilities
            });
            
            clientInfo.sessionId = sessionId;
            clientInfo.isHost = true;
            
            socket.emit('session-created', {
                success: true,
                sessionId,
                password,
                hostInfo,
                iceServers: ICE_SERVERS
            });
            
            console.log(`🎯 Session created: ${sessionId} (${platform}) - Max users: ${session.maxUsers}`);
        } catch (error) {
            socket.emit('session-error', { message: error.message });
        }
    });

    // Start hosting
    socket.on('start-webrtc-host', (data) => {
        const { sessionId, password, qualitySettings = {}, maxUsers = 5 } = data;
        
        const session = sessions.get(sessionId);
        if (!session || session.password !== password || session.hostId !== socket.id) {
            socket.emit('host-error', { message: 'Invalid session or unauthorized' });
            return;
        }
        
        session.isActive = true;
        session.maxUsers = Math.min(maxUsers, 5);
        session.rtpPort = data.rtpPort || 5004;
        
        if (qualitySettings) {
            session.qualitySettings = { ...session.qualitySettings, ...qualitySettings };
        }
        
        socket.emit('webrtc-host-ready', { 
            success: true,
            rtpPort: session.rtpPort,
            maxUsers: session.maxUsers,
            iceServers: ICE_SERVERS,
            qualitySettings: session.qualitySettings
        });
        
        console.log(`Host started: ${sessionId} (Port: ${session.rtpPort}, Max users: ${session.maxUsers})`);
    });

    // Join session
    socket.on('join-webrtc-session', (data) => {
        const { sessionId, password, userName, webrtcCapabilities = {} } = data;
        
        const session = sessions.get(sessionId);
        if (!session) {
            socket.emit('join-error', { message: 'Session not found' });
            return;
        }
        
        if (session.password !== password) {
            socket.emit('join-error', { message: 'Invalid password' });
            return;
        }
        
        if (!session.isActive) {
            socket.emit('join-error', { message: 'Session not active' });
            return;
        }
        
        try {
            const userInfo = session.addUser(socket.id, {
                userName,
                isHost: false,
                webrtcCapabilities,
                platform: clientInfo.userAgent
            });
            
            socket.join(`session-${sessionId}`);
            clientInfo.sessionId = sessionId;
            clientInfo.userName = userInfo.userName;
            
            // Notify all users about new participant
            socket.to(`session-${sessionId}`).emit('user-joined', {
                userId: socket.id,
                userName: userInfo.userName,
                color: userInfo.color,
                userCount: session.users.size
            });
            
            // Send session info to new user
            socket.emit('webrtc-join-ready', {
                success: true,
                sessionInfo: {
                    id: sessionId,
                    platform: session.platform,
                    maxUsers: session.maxUsers,
                    currentUsers: session.users.size
                },
                userInfo: {
                    userName: userInfo.userName,
                    color: userInfo.color
                },
                iceServers: ICE_SERVERS,
                connectedUsers: session.getConnectedUsers()
            });
            
            console.log(`User joined: ${userInfo.userName} (${socket.id}) -> ${sessionId} (${session.users.size}/${session.maxUsers})`);
            
        } catch (error) {
            socket.emit('join-error', { message: error.message });
        }
    });

    // WebRTC signaling with multi-user support
    socket.on('webrtc-offer', (data) => {
        const { sessionId, offer, targetUser } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.users.has(socket.id)) return;
        
        if (targetUser) {
            // Direct peer-to-peer offer
            io.to(targetUser).emit('webrtc-offer', {
                offer,
                fromUser: socket.id,
                sessionId
            });
        } else {
            // Broadcast to all users in session
            socket.to(`session-${sessionId}`).emit('webrtc-offer', {
                offer,
                fromUser: socket.id,
                sessionId
            });
        }
        
        console.log(`WebRTC offer: ${socket.id} -> ${targetUser || 'all'} (${sessionId})`);
    });

    socket.on('webrtc-answer', (data) => {
        const { sessionId, answer, targetUser } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.users.has(socket.id)) return;
        
        io.to(targetUser).emit('webrtc-answer', {
            answer,
            fromUser: socket.id,
            sessionId
        });
        
        console.log(`WebRTC answer: ${socket.id} -> ${targetUser} (${sessionId})`);
    });

    socket.on('webrtc-ice-candidate', (data) => {
        const { sessionId, candidate, targetUser } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.users.has(socket.id)) return;
        
        io.to(targetUser).emit('webrtc-ice-candidate', {
            candidate,
            fromUser: socket.id,
            sessionId
        });
    });

    // User connection state updates
    socket.on('webrtc-connected', (data) => {
        const { sessionId, targetUser } = data;
        const session = sessions.get(sessionId);
        
        if (session && session.users.has(socket.id)) {
            const user = session.users.get(socket.id);
            user.isConnected = true;
            
            socket.to(`session-${sessionId}`).emit('peer-connected', {
                userId: socket.id,
                userName: user.userName,
                color: user.color
            });
            
            console.log(`WebRTC connected: ${user.userName} (${socket.id}) in ${sessionId}`);
        }
    });

    // Mouse movement broadcasting
    socket.on('user-mouse-move', (data) => {
        const { sessionId, x, y } = data;
        const session = sessions.get(sessionId);
        
        if (session && session.users.has(socket.id)) {
            const user = session.users.get(socket.id);
            
            socket.to(`session-${sessionId}`).emit('user-mouse-move', {
                userId: socket.id,
                userName: user.userName,
                color: user.color,
                x,
                y,
                sessionId
            });
        }
    });

    // Network quality monitoring
    socket.on('network-stats', (data) => {
        const { sessionId, bandwidth, latency, packetLoss } = data;
        const session = sessions.get(sessionId);
        
        if (session && session.users.has(socket.id)) {
            const user = session.users.get(socket.id);
            user.networkQuality = qualityMonitor.assessQuality(bandwidth || 0, latency || 0, packetLoss || 0);
            
            // Update session-wide stats (average of all users)
            const connectedUsers = session.getConnectedUsers();
            if (connectedUsers.length > 0) {
                const avgBandwidth = connectedUsers.reduce((sum, u) => sum + (u.bandwidth || 0), 0) / connectedUsers.length;
                const avgLatency = connectedUsers.reduce((sum, u) => sum + (u.latency || 0), 0) / connectedUsers.length;
                const avgPacketLoss = connectedUsers.reduce((sum, u) => sum + (u.packetLoss || 0), 0) / connectedUsers.length;
                
                const recommendedSettings = session.updateNetworkStats(avgBandwidth, avgLatency, avgPacketLoss);
                
                if (recommendedSettings && session.users.get(session.hostId)?.isHost) {
                    // Notify all users about quality adjustment
                    io.to(`session-${sessionId}`).emit('quality-adjustment', {
                        quality: session.networkStats.quality,
                        settings: recommendedSettings,
                        reason: 'Network conditions changed'
                    });
                }
            }
        }
    });

    // Quality change requests
    socket.on('change-quality', (data) => {
        const { sessionId, quality, settings } = data;
        const session = sessions.get(sessionId);
        
        if (session && session.users.has(socket.id)) {
            const user = session.users.get(socket.id);
            
            // Only host can change quality, or if adaptive is disabled
            if (user.isHost || !session.qualitySettings.adaptive) {
                session.qualitySettings.current = quality;
                
                socket.to(`session-${sessionId}`).emit('quality-changed', {
                    quality,
                    settings,
                    changedBy: user.userName
                });
                
                console.log(`Quality changed to ${quality} by ${user.userName} in ${sessionId}`);
            }
        }
    });

    // Session management
    socket.on('end-session', (data) => {
        const { sessionId } = data;
        endSession(sessionId, socket.id);
    });

    socket.on('kick-user', (data) => {
        const { sessionId, targetUserId } = data;
        const session = sessions.get(sessionId);
        
        if (session && session.hostId === socket.id && session.users.has(targetUserId)) {
            const targetUser = session.users.get(targetUserId);
            
            // Notify the user being kicked
            io.to(targetUserId).emit('kicked-from-session', {
                reason: 'Removed by host'
            });
            
            // Remove user from session
            session.removeUser(targetUserId);
            
            // Notify other users
            socket.to(`session-${sessionId}`).emit('user-left', {
                userId: targetUserId,
                userName: targetUser.userName,
                reason: 'kicked'
            });
            
            console.log(`User kicked: ${targetUser.userName} from ${sessionId}`);
        }
    });

    socket.on('disconnect-from-session', (data) => {
        const { sessionId } = data;
        handleUserLeave(sessionId, socket.id, 'voluntary');
    });

    // Handle client disconnect
    socket.on('disconnect', (reason) => {
        const clientInfo = connectedClients.get(socket.id);
        
        if (clientInfo && clientInfo.sessionId) {
            handleUserLeave(clientInfo.sessionId, socket.id, 'disconnect');
        }
        
        connectedClients.delete(socket.id);
        
        console.log(`Client disconnected: ${socket.id} (${reason})`);
        console.log(`Total clients: ${connectedClients.size}, Sessions: ${sessions.size}`);
    });

    // Error handling
    socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
    });
});

// Helper functions
function handleUserLeave(sessionId, userId, reason = 'unknown') {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    const user = session.users.get(userId);
    if (!user) return;
    
    // Remove user from session
    session.removeUser(userId);
    
    // If host left, end the session
    if (session.hostId === userId) {
        console.log(`Host left: ${sessionId}, ending session`);
        endSession(sessionId);
        return;
    }
    
    // Notify other users
    io.to(`session-${sessionId}`).emit('user-left', {
        userId,
        userName: user.userName,
        userCount: session.users.size,
        reason
    });
    
    console.log(`User left: ${user.userName} (${userId}) from ${sessionId} - ${reason} (${session.users.size} remaining)`);
    
    // Clean up empty sessions
    if (session.users.size === 0) {
        console.log(`Session empty: ${sessionId}, cleaning up`);
        sessions.delete(sessionId);
    }
}

function endSession(sessionId, requesterId = null) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    // Only host can end session
    if (requesterId && session.hostId !== requesterId) {
        return;
    }
    
    // Notify all users
    io.to(`session-${sessionId}`).emit('session-ended', {
        sessionId,
        reason: requesterId ? 'Host ended session' : 'Session timeout',
        endedBy: requesterId
    });
    
    // Clean up
    sessions.delete(sessionId);
    
    console.log(`Session ended: ${sessionId} (${session.users.size} users affected)`);
}

// Periodic cleanup and monitoring
setInterval(() => {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes
    
    sessions.forEach((session, sessionId) => {
        const inactiveTime = now - session.createdAt.getTime();
        
        // Clean up inactive sessions
        if (!session.isActive && inactiveTime > inactiveThreshold) {
            console.log(`Cleaning up inactive session: ${sessionId}`);
            endSession(sessionId);
        }
        
        // Clean up sessions with no connected users
        const connectedUsers = session.getConnectedUsers();
        if (session.isActive && connectedUsers.length === 0 && inactiveTime > 5 * 60 * 1000) {
            console.log(`Cleaning up empty session: ${sessionId}`);
            endSession(sessionId);
        }
    });
}, 5 * 60 * 1000); // Check every 5 minutes

// Performance monitoring
setInterval(() => {
    const activeSessionsCount = Array.from(sessions.values()).filter(s => s.isActive).length;
    const totalUsers = Array.from(sessions.values()).reduce((sum, s) => sum + s.users.size, 0);
    const connectedUsersCount = Array.from(sessions.values())
        .reduce((sum, s) => sum + s.getConnectedUsers().length, 0);
    
    if (activeSessionsCount > 0 || totalUsers > 0) {
        console.log(`Active: ${activeSessionsCount} sessions, ${connectedUsersCount}/${totalUsers} users connected, ${connectedClients.size} clients`);
    }
    
    // Memory usage warning
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.rss / 1024 / 1024);
    if (memMB > 500) {
        console.log(`High memory usage: ${memMB}MB RSS`);
    }
}, 30000); // Every 30 seconds

// Server startup
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log('='.repeat(80));
    console.log('Enhanced WebRTC Remote Desktop Server v2.1.0');
    console.log('='.repeat(80));
    console.log(`Server: http://${HOST}:${PORT}`);
    console.log(`Health: http://${HOST}:${PORT}/health`);
    console.log(`Platform: ${os.platform()} ${os.arch()}`);
    console.log(`Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
    console.log('='.repeat(80));
    console.log('Enhanced Features:');
    console.log('  ✓ Multi-user support (up to 5 users per session)');
    console.log('  ✓ Adaptive quality based on network conditions');
    console.log('  ✓ Cross-platform compatibility (Windows/Linux/macOS)');
    console.log('  ✓ Multiple mouse cursors with user identification');
    console.log('  ✓ Real-time network quality monitoring');
    console.log('  ✓ Host mouse isolation during remote control');
    console.log('  ✓ Automatic quality scaling (2K -> 480p)');
    console.log('  ✓ Enhanced connection reliability');
    console.log('='.repeat(80));
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down Enhanced WebRTC server...');
    
    // End all active sessions
    sessions.forEach((session, sessionId) => {
        if (session.isActive) {
            endSession(sessionId);
        }
    });
    
    server.close(() => {
        console.log('Enhanced WebRTC server shutdown complete');
        process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
        console.log('Force shutdown');
        process.exit(1);
    }, 10000);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    
    sessions.forEach((session, sessionId) => {
        endSession(sessionId);
    });
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
