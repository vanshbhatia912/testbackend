const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

const app = express();
const server = http.createServer(app);

// Enhanced WebRTC-optimized Socket.IO configuration
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    transports: ['websocket', 'polling'], // Add polling fallback
    allowEIO3: true,
    pingTimeout: 60000,        // Increased for poor connections
    pingInterval: 25000,       // More frequent pings
    upgradeTimeout: 10000,     // Increased timeout
    maxHttpBufferSize: 1e6,    // Reduced buffer size
    compression: true,
    perMessageDeflate: {
        threshold: 1024,
        concurrencyLimit: 10,
        windowBits: 15,
        serverMaxNoContextTakeover: true
    }
});

// Middleware
app.use(cors({
    origin: "*",
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Enhanced session storage with multi-user support
const sessions = new Map();
const connectedClients = new Map();
const userSessions = new Map(); // Track which session each user is in

// Enhanced WebRTC STUN/TURN configuration
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Add more STUN servers for better connectivity
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:global.stun.twilio.com:3478' }
    // Add TURN servers for production (required for restrictive networks):
    // {
    //     urls: 'turn:your-turn-server.com:3478',
    //     username: 'username',
    //     credential: 'password'
    // }
];

// Enhanced priority queue for WebRTC signaling with multi-user support
class EnhancedWebRTCSignalingQueue {
    constructor() {
        this.queues = {
            1: [], // ICE candidates (highest priority)
            2: [], // SDP offers/answers
            3: [], // DataChannel messages (input events)
            4: [], // Mouse position updates
            5: []  // General signaling
        };
        this.processing = false;
        this.maxQueueSize = 100;
    }

    enqueue(event, priority = 5) {
        // Prevent queue overflow
        if (this.queues[priority].length >= this.maxQueueSize) {
            this.queues[priority].shift(); // Remove oldest
        }

        this.queues[priority].push({
            ...event,
            timestamp: performance.now()
        });
        
        if (!this.processing) {
            this.process();
        }
    }

    async process() {
        this.processing = true;
        
        // Process in priority order
        for (let priority = 1; priority <= 5; priority++) {
            while (this.queues[priority].length > 0) {
                const event = this.queues[priority].shift();
                await this.handleEvent(event);
                
                // Small delay to prevent overwhelming
                if (priority >= 4) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
        }
        
        this.processing = false;
        
        // Check if more events arrived during processing
        if (this.hasEvents()) {
            setImmediate(() => this.process());
        }
    }

    hasEvents() {
        return Object.values(this.queues).some(queue => queue.length > 0);
    }

    async handleEvent(event) {
        try {
            if (event.targetSocket) {
                io.to(event.targetSocket).emit(event.type, event.data);
            } else if (event.sessionId) {
                io.to(`session-${event.sessionId}`).emit(event.type, event.data);
            }
        } catch (error) {
            console.error('❌ WebRTC signaling error:', error);
        }
    }

    getQueueStatus() {
        const status = {};
        for (let priority = 1; priority <= 5; priority++) {
            status[priority] = this.queues[priority].length;
        }
        return status;
    }
}

// Global signaling queue
const signalingQueue = new EnhancedWebRTCSignalingQueue();

// Enhanced WebRTC Performance Monitor with multi-user metrics
class EnhancedWebRTCPerformanceMonitor {
    constructor() {
        this.metrics = {
            signalingSent: 0,
            iceExchanges: 0,
            sdpExchanges: 0,
            dataChannelMessages: 0,
            mousePositionUpdates: 0,
            averageSignalingLatency: 0,
            connectionEstablishTime: 0,
            lastConnectionTime: 0,
            activeConnections: 0,
            peakConnections: 0,
            totalDataTransferred: 0,
            qualityAdaptations: 0
        };
        this.startTime = performance.now();
        this.signalingLatencies = [];
        this.connectionTimes = [];
    }

    recordSignaling(type, latency, dataSize = 0) {
        this.metrics.signalingSent++;
        this.metrics.totalDataTransferred += dataSize;
        
        switch (type) {
            case 'ice-candidate':
                this.metrics.iceExchanges++;
                break;
            case 'sdp-offer':
            case 'sdp-answer':
                this.metrics.sdpExchanges++;
                break;
            case 'datachannel':
                this.metrics.dataChannelMessages++;
                break;
            case 'mouse-position':
                this.metrics.mousePositionUpdates++;
                break;
            case 'quality-adaptation':
                this.metrics.qualityAdaptations++;
                break;
        }

        if (latency) {
            this.signalingLatencies.push(latency);
            if (this.signalingLatencies.length > 100) {
                this.signalingLatencies = this.signalingLatencies.slice(-50);
            }
            
            const sum = this.signalingLatencies.reduce((a, b) => a + b, 0);
            this.metrics.averageSignalingLatency = sum / this.signalingLatencies.length;
        }
    }

    recordConnection(connectionCount) {
        const now = performance.now();
        this.metrics.connectionEstablishTime = now - this.metrics.lastConnectionTime;
        this.metrics.lastConnectionTime = now;
        this.metrics.activeConnections = connectionCount;
        this.metrics.peakConnections = Math.max(this.metrics.peakConnections, connectionCount);
        
        this.connectionTimes.push(this.metrics.connectionEstablishTime);
        if (this.connectionTimes.length > 20) {
            this.connectionTimes = this.connectionTimes.slice(-10);
        }
    }

    getStats() {
        const runtime = (performance.now() - this.startTime) / 1000;
        const avgConnectionTime = this.connectionTimes.length > 0 ? 
            this.connectionTimes.reduce((a, b) => a + b, 0) / this.connectionTimes.length : 0;

        return {
            ...this.metrics,
            runtime: Math.round(runtime),
            signalingPerSecond: runtime > 0 ? this.metrics.signalingSent / runtime : 0,
            averageConnectionTime: Math.round(avgConnectionTime),
            dataTransferredMB: Math.round(this.metrics.totalDataTransferred / 1024 / 1024 * 100) / 100
        };
    }
}

// Enhanced session structure with multi-user support
function createSession(sessionId, password, hostSocketId, platform) {
    return {
        id: sessionId,
        password,
        createdAt: new Date(),
        isActive: false,
        hostSocket: hostSocketId,
        controllers: new Map(), // Changed to Map for better user management
        platform,
        performanceMonitor: new EnhancedWebRTCPerformanceMonitor(),
        
        // WebRTC specific
        webrtcConnected: false,
        rtpPort: null,
        iceServers: ICE_SERVERS,
        webrtcCapabilities: {},
        
        // Multi-user features
        maxUsers: 5, // Limit to 5 concurrent users
        userColors: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b'],
        mousePositions: new Map(),
        
        // Quality management
        currentQuality: 'good',
        qualityHistory: [],
        adaptiveQuality: true,
        
        // Network monitoring
        networkStats: {
            totalBandwidth: 0,
            averageLatency: 0,
            packetLoss: 0,
            qualityLevel: 'good'
        }
    };
}

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

function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

function getSystemInfo() {
    return {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpus: os.cpus().length,
        memory: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        uptime: os.uptime(),
        webrtcSupport: true,
        multiUserSupport: true,
        maxUsersPerSession: 5
    };
}

function isValidSession(sessionId, password) {
    const session = sessions.get(sessionId);
    return session && session.password === password;
}

// Enhanced routes with multi-user info
app.get('/', (req, res) => {
    res.json({
        name: 'Enhanced WebRTC Remote Desktop Signaling Server',
        version: '2.1.0',
        platform: os.platform(),
        arch: os.arch(),
        status: 'running',
        sessions: sessions.size,
        clients: connectedClients.size,
        features: {
            multiUserSupport: true,
            maxUsersPerSession: 5,
            adaptiveQuality: true,
            crossPlatformOptimized: true,
            enhancedNetworking: true
        },
        webrtc: {
            signalingOnly: true,
            p2pMediaStreaming: true,
            dataChannelInput: true,
            ultraLowLatency: true,
            frameSkipping: true,
            qualityAdaptation: true,
            iceServers: ICE_SERVERS.map(server => server.urls)
        }
    });
});

app.get('/health', (req, res) => {
    const memUsage = process.memoryUsage();
    
    // Calculate total users across all sessions
    let totalUsers = 0;
    let activeConnections = 0;
    sessions.forEach(session => {
        totalUsers += session.controllers.size;
        if (session.webrtcConnected) activeConnections++;
    });
    
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
        },
        system: getSystemInfo(),
        sessions: {
            total: sessions.size,
            active: Array.from(sessions.values()).filter(s => s.isActive).length,
            webrtcConnected: activeConnections
        },
        users: {
            total: totalUsers,
            connected: connectedClients.size
        },
        performance: {
            signalingQueueStatus: signalingQueue.getQueueStatus(),
            averageLatency: calculateAverageLatency(),
            totalDataTransferred: calculateTotalDataTransferred()
        },
        timestamp: new Date().toISOString()
    });
});

app.get('/api/sessions', (req, res) => {
    const sessionList = Array.from(sessions.values()).map(session => ({
        id: session.id,
        createdAt: session.createdAt,
        isActive: session.isActive,
        hostConnected: !!session.hostSocket,
        controllerCount: session.controllers.size,
        maxUsers: session.maxUsers,
        platform: session.platform,
        webrtcConnected: session.webrtcConnected,
        rtpPort: session.rtpPort,
        currentQuality: session.currentQuality,
        networkStats: session.networkStats,
        performance: session.performanceMonitor ? session.performanceMonitor.getStats() : null,
        users: Array.from(session.controllers.values()).map(controller => ({
            id: controller.userId,
            name: controller.name,
            joinedAt: controller.joinedAt,
            color: controller.color,
            latency: controller.signalingLatency
        }))
    }));
    
    res.json({
        sessions: sessionList,
        totalUsers: sessionList.reduce((sum, s) => sum + s.controllerCount, 0),
        systemLoad: process.cpuUsage()
    });
});

// WebRTC ICE servers endpoint
app.get('/api/ice-servers', (req, res) => {
    res.json({
        iceServers: ICE_SERVERS,
        config: {
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        }
    });
});

// Quality levels endpoint
app.get('/api/quality-levels', (req, res) => {
    res.json({
        levels: {
            excellent: { width: 1920, height: 1080, framerate: 60, bitrate: 2000000 },
            good: { width: 1920, height: 1080, framerate: 30, bitrate: 1500000 },
            fair: { width: 1280, height: 720, framerate: 30, bitrate: 1000000 },
            poor: { width: 854, height: 480, framerate: 20, bitrate: 500000 }
        },
        adaptationThresholds: {
            latency: { excellent: 30, good: 50, fair: 100 },
            packetLoss: { excellent: 1, good: 3, fair: 5 },
            bandwidth: { excellent: 1500000, good: 1000000, fair: 500000 }
        }
    });
});

// Helper functions
function calculateAverageLatency() {
    let totalLatency = 0;
    let count = 0;
    
    sessions.forEach(session => {
        session.controllers.forEach(controller => {
            if (controller.signalingLatency > 0) {
                totalLatency += controller.signalingLatency;
                count++;
            }
        });
    });
    
    return count > 0 ? Math.round(totalLatency / count) : 0;
}

function calculateTotalDataTransferred() {
    let total = 0;
    sessions.forEach(session => {
        if (session.performanceMonitor) {
            total += session.performanceMonitor.getStats().totalDataTransferred;
        }
    });
    return total;
}

// Enhanced Socket.IO WebRTC signaling with multi-user support
io.on('connection', (socket) => {
    const clientInfo = {
        id: socket.id,
        userId: generateUserId(),
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        connectedAt: new Date(),
        signalingLatency: 0,
        webrtcSupported: true,
        platform: 'unknown',
        sessionId: null
    };
    
    connectedClients.set(socket.id, clientInfo);
    
    console.log(`🔗 Enhanced WebRTC client connected: ${socket.id} (${clientInfo.userId}) from ${clientInfo.ip}`);
    console.log(`📊 Total clients: ${connectedClients.size}, Active sessions: ${sessions.size}`);

    // Send enhanced configuration
    socket.emit('ice-servers', { 
        iceServers: ICE_SERVERS,
        userId: clientInfo.userId,
        serverCapabilities: {
            multiUser: true,
            adaptiveQuality: true,
            maxUsersPerSession: 5
        }
    });

    // Enhanced latency monitoring
    socket.on('ping', (timestamp) => {
        const latency = Date.now() - timestamp;
        clientInfo.signalingLatency = latency;
        socket.emit('pong', { 
            timestamp, 
            latency,
            serverId: socket.id,
            queueStatus: signalingQueue.getQueueStatus()
        });
    });

    // Enhanced session creation with multi-user support
    socket.on('create-session', (data) => {
        const { platform = 'unknown', webrtcCapabilities = {}, userInfo = {} } = data;
        
        const sessionId = generateSessionId();
        const password = generatePassword();
        
        const session = createSession(sessionId, password, socket.id, platform);
        session.webrtcCapabilities = webrtcCapabilities;
        
        sessions.set(sessionId, session);
        socket.join(`session-${sessionId}`);
        
        clientInfo.sessionId = sessionId;
        clientInfo.platform = platform;
        
        socket.emit('session-created', {
            success: true,
            sessionId,
            password,
            platform,
            iceServers: ICE_SERVERS,
            webrtcEnabled: true,
            multiUserSupport: true,
            maxUsers: session.maxUsers,
            userId: clientInfo.userId
        });
        
        console.log(`🎯 Enhanced WebRTC session created: ${sessionId} by ${socket.id} (${platform})`);
    });

    // Enhanced WebRTC hosting
    socket.on('start-webrtc-host', (data) => {
        const { sessionId, password, rtpPort, qualitySettings } = data;
        
        if (!isValidSession(sessionId, password)) {
            socket.emit('host-error', { message: 'Invalid session or password' });
            return;
        }
        
        const session = sessions.get(sessionId);
        if (session.hostSocket !== socket.id) {
            socket.emit('host-error', { message: 'Not authorized to host this session' });
            return;
        }
        
        session.isActive = true;
        session.rtpPort = rtpPort;
        session.performanceMonitor = new EnhancedWebRTCPerformanceMonitor();
        
        if (qualitySettings) {
            session.currentQuality = qualitySettings.level || 'good';
            session.adaptiveQuality = qualitySettings.adaptive !== false;
        }
        
        socket.emit('webrtc-host-ready', { 
            success: true,
            rtpPort: rtpPort,
            iceServers: ICE_SERVERS,
            qualityLevel: session.currentQuality,
            maxUsers: session.maxUsers,
            adaptiveQuality: session.adaptiveQuality
        });
        
        console.log(`🖥️ Enhanced WebRTC host started: ${sessionId} (RTP port: ${rtpPort}, Quality: ${session.currentQuality})`);
    });

    // Enhanced session joining with user management
    socket.on('join-webrtc-session', (data) => {
        const { sessionId, password, webrtcCapabilities = {}, userInfo = {} } = data;
        
        if (!isValidSession(sessionId, password)) {
            socket.emit('join-error', { message: 'Invalid session or password' });
            return;
        }
        
        const session = sessions.get(sessionId);
        if (!session.isActive) {
            socket.emit('join-error', { message: 'Session is not active' });
            return;
        }
        
        if (session.controllers.size >= session.maxUsers) {
            socket.emit('join-error', { message: `Session is full (max ${session.maxUsers} users)` });
            return;
        }
        
        // Create controller with enhanced info
        const colorIndex = session.controllers.size % session.userColors.length;
        const controller = {
            socketId: socket.id,
            userId: clientInfo.userId,
            name: userInfo.name || `User ${session.controllers.size + 1}`,
            color: session.userColors[colorIndex],
            joinedAt: new Date(),
            signalingLatency: clientInfo.signalingLatency,
            webrtcCapabilities,
            platform: clientInfo.platform || 'unknown',
            mousePosition: { x: 0, y: 0, visible: false }
        };
        
        session.controllers.set(clientInfo.userId, controller);
        socket.join(`session-${sessionId}`);
        
        clientInfo.sessionId = sessionId;
        
        socket.emit('webrtc-join-ready', { 
            success: true,
            sessionInfo: {
                id: sessionId,
                platform: session.platform,
                rtpPort: session.rtpPort,
                hostConnected: !!session.hostSocket,
                currentQuality: session.currentQuality,
                adaptiveQuality: session.adaptiveQuality
            },
            userInfo: {
                userId: clientInfo.userId,
                name: controller.name,
                color: controller.color
            },
            iceServers: ICE_SERVERS,
            connectedUsers: Array.from(session.controllers.values()).map(c => ({
                userId: c.userId,
                name: c.name,
                color: c.color,
                platform: c.platform
            }))
        });
        
        // Notify host about new controller
        if (session.hostSocket) {
            io.to(session.hostSocket).emit('controller-joined', {
                userId: clientInfo.userId,
                userInfo: {
                    name: controller.name,
                    color: controller.color,
                    platform: controller.platform
                },
                userCount: session.controllers.size
            });
        }
        
        // Notify other controllers
        socket.to(`session-${sessionId}`).emit('user-joined', {
            userId: clientInfo.userId,
            userInfo: {
                name: controller.name,
                color: controller.color,
                platform: controller.platform
            },
            userCount: session.controllers.size
        });
        
        console.log(`🎮 Enhanced WebRTC controller joined: ${controller.name} (${socket.id}) -> ${sessionId}`);
    });

    // Enhanced WebRTC signaling with multi-user support
    socket.on('webrtc-offer', (data) => {
        const { sessionId, offer, targetPeer, fromUser } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        signalingQueue.enqueue({
            type: 'webrtc-offer',
            sessionId,
            data: { offer, fromPeer: socket.id, fromUser },
            targetSocket: targetPeer
        }, 2);
        
        session.performanceMonitor.recordSignaling('sdp-offer', null, JSON.stringify(offer).length);
        console.log(`📡 WebRTC offer: ${socket.id} -> ${targetPeer} (${sessionId})`);
    });

    socket.on('webrtc-answer', (data) => {
        const { sessionId, answer, targetPeer, fromUser } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        signalingQueue.enqueue({
            type: 'webrtc-answer',
            sessionId,
            data: { answer, fromPeer: socket.id, fromUser },
            targetSocket: targetPeer
        }, 2);
        
        session.performanceMonitor.recordSignaling('sdp-answer', null, JSON.stringify(answer).length);
        console.log(`📡 WebRTC answer: ${socket.id} -> ${targetPeer} (${sessionId})`);
    });

    // Enhanced ICE candidate handling
    socket.on('webrtc-ice-candidate', (data) => {
        const { sessionId, candidate, targetPeer, fromUser } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        signalingQueue.enqueue({
            type: 'webrtc-ice-candidate',
            sessionId,
            data: { candidate, fromPeer: socket.id, fromUser },
            targetSocket: targetPeer
        }, 1);
        
        session.performanceMonitor.recordSignaling('ice-candidate');
    });

    // Enhanced WebRTC connection tracking
    socket.on('webrtc-connected', (data) => {
        const { sessionId, targetPeer } = data;
        const session = sessions.get(sessionId);
        
        if (session) {
            session.webrtcConnected = true;
            session.performanceMonitor.recordConnection(session.controllers.size);
            
            socket.to(`session-${sessionId}`).emit('peer-connected', {
                peerId: socket.id,
                userId: clientInfo.userId,
                sessionId
            });
            
            console.log(`✅ WebRTC P2P connected: ${socket.id} in ${sessionId}`);
        }
    });

    // Enhanced mouse position tracking
    socket.on('mouse-position-update', (data) => {
        const { sessionId, userId, x, y, visible } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        // Update mouse position in session
        if (session.controllers.has(userId)) {
            const controller = session.controllers.get(userId);
            controller.mousePosition = { x, y, visible };
            
            // Broadcast to all other users in session (except sender)
            socket.to(`session-${sessionId}`).emit('mouse-position-update', {
                userId,
                x, y, visible,
                color: controller.color,
                name: controller.name
            });
            
            session.performanceMonitor.recordSignaling('mouse-position', null, 50);
        }
    });

    // Enhanced DataChannel input events
    socket.on('datachannel-input', (data) => {
        const { sessionId, inputData, targetPeer } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        signalingQueue.enqueue({
            type: 'datachannel-input',
            sessionId,
            data: { ...inputData, fromUser: clientInfo.userId },
            targetSocket: targetPeer
        }, 3);
        
        session.performanceMonitor.recordSignaling('datachannel', null, JSON.stringify(inputData).length);
    });

    // Quality adaptation signaling
    socket.on('quality-adaptation', (data) => {
        const { sessionId, qualityLevel, networkStats } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.adaptiveQuality) return;
        
        session.currentQuality = qualityLevel;
        session.networkStats = { ...session.networkStats, ...networkStats };
        session.qualityHistory.push({
            level: qualityLevel,
            timestamp: Date.now(),
            stats: networkStats
        });
        
        // Keep only last 10 quality changes
        if (session.qualityHistory.length > 10) {
            session.qualityHistory = session.qualityHistory.slice(-10);
        }
        
        // Broadcast quality change to all session participants
        io.to(`session-${sessionId}`).emit('quality-changed', {
            qualityLevel,
            networkStats,
            adaptedBy: clientInfo.userId
        });
        
        session.performanceMonitor.recordSignaling('quality-adaptation');
        console.log(`📊 Quality adapted to ${qualityLevel} in session ${sessionId}`);
    });

    // Enhanced WebRTC stats reporting
    socket.on('webrtc-stats', (data) => {
        const { sessionId, stats, userId } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        // Update session network stats
        if (stats.bandwidth) session.networkStats.totalBandwidth += stats.bandwidth;
        if (stats.latency) session.networkStats.averageLatency = stats.latency;
        if (stats.packetLoss) session.networkStats.packetLoss = stats.packetLoss;
        
        // Relay stats to other participants
        socket.to(`session-${sessionId}`).emit('peer-stats', {
            peerId: socket.id,
            userId: userId || clientInfo.userId,
            stats: stats
        });
    });

    // Enhanced session management
    socket.on('end-session', (data) => {
        const { sessionId } = data;
        endEnhancedWebRTCSession(sessionId, socket.id);
    });

    socket.on('disconnect-from-session', (data) => {
        const { sessionId } = data;
        disconnectFromEnhancedSession(sessionId, socket.id);
    });

    socket.on('kick-user', (data) => {
        const { sessionId, userId, reason } = data;
        const session = sessions.get(sessionId);
        
        if (!session || session.hostSocket !== socket.id) {
            socket.emit('error', { message: 'Not authorized to kick users' });
            return;
        }
        
        const controller = Array.from(session.controllers.values())
            .find(c => c.userId === userId);
        
        if (controller) {
            const targetSocket = controller.socketId;
            
            // Notify the kicked user
            io.to(targetSocket).emit('kicked-from-session', {
                reason: reason || 'Removed by host',
                sessionId
            });
            
            // Remove from session
            disconnectFromEnhancedSession(sessionId, targetSocket);
            
            console.log(`👮 User ${userId} kicked from session ${sessionId}: ${reason}`);
        }
    });

    // Enhanced disconnect handling
    socket.on('disconnect', () => {
        connectedClients.delete(socket.id);
        
        const sessionId = clientInfo.sessionId;
        if (sessionId) {
            disconnectFromEnhancedSession(sessionId, socket.id);
        }
        
        console.log(`🔌 Enhanced WebRTC client disconnected: ${socket.id}`);
        console.log(`📊 Total clients: ${connectedClients.size}, Active sessions: ${sessions.size}`);
    });
});

// Enhanced session management functions
function endEnhancedWebRTCSession(sessionId, requesterId = null) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    // Get final performance stats
    const finalStats = session.performanceMonitor ? session.performanceMonitor.getStats() : null;
    
    // Notify all participants
    io.to(`session-${sessionId}`).emit('session-ended', {
        sessionId,
        endedBy: requesterId,
        stats: finalStats,
        sessionDuration: Date.now() - session.createdAt.getTime(),
        totalUsers: session.controllers.size,
        qualityHistory: session.qualityHistory
    });
    
    // Clean up user sessions
    session.controllers.forEach(controller => {
        userSessions.delete(controller.socketId);
    });
    
    sessions.delete(sessionId);
    
    console.log(`🔴 Enhanced WebRTC session ended: ${sessionId} (${session.controllers.size} controllers)`);
    if (finalStats) {
        console.log(`📊 Final stats: ${finalStats.signalingSent} signals, ${finalStats.averageSignalingLatency.toFixed(2)}ms avg latency, ${finalStats.dataTransferredMB}MB transferred`);
    }
}

function disconnectFromEnhancedSession(sessionId, socketId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    const clientInfo = connectedClients.get(socketId);
    if (!clientInfo) return;
    
    // Check if it's the host
    if (session.hostSocket === socketId) {
        console.log(`🖥️ Enhanced WebRTC host disconnected: ${sessionId}`);
        endEnhancedWebRTCSession(sessionId, socketId);
        return;
    }
    
    // Find and remove controller
    let removedController = null;
    for (const [userId, controller] of session.controllers) {
        if (controller.socketId === socketId) {
            removedController = controller;
            session.controllers.delete(userId);
            break;
        }
    }
    
    if (removedController) {
        // Clean up user session tracking
        userSessions.delete(socketId);
        clientInfo.sessionId = null;
        
        // Leave socket room
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            socket.leave(`session-${sessionId}`);
        }
        
        // Notify remaining participants
        io.to(`session-${sessionId}`).emit('user-disconnected', {
            userId: removedController.userId,
            userName: removedController.name,
            userCount: session.controllers.size,
            remainingUsers: Array.from(session.controllers.values()).map(c => ({
                userId: c.userId,
                name: c.name,
                color: c.color
            }))
        });
        
        // Notify host
        if (session.hostSocket) {
            io.to(session.hostSocket).emit('controller-disconnected', {
                userId: removedController.userId,
                userName: removedController.name,
                userCount: session.controllers.size
            });
        }
        
        console.log(`🎮 Enhanced WebRTC controller disconnected: ${removedController.name} (${socketId}) from ${sessionId}`);
        
        // End session if no controllers remain and it's been active for more than 5 minutes
        if (session.controllers.size === 0 && 
            (Date.now() - session.createdAt.getTime()) > 5 * 60 * 1000) {
            setTimeout(() => {
                if (sessions.has(sessionId) && sessions.get(sessionId).controllers.size === 0) {
                    console.log(`🧹 Auto-ending session ${sessionId} - no users remaining`);
                    endEnhancedWebRTCSession(sessionId);
                }
            }, 30000); // 30-second grace period
        }
    }
}

// Enhanced cleanup for inactive sessions with multi-user considerations
setInterval(() => {
    const now = Date.now();
    const inactiveThreshold = 45 * 60 * 1000; // 45 minutes for multi-user sessions
    const emptyThreshold = 10 * 60 * 1000;    // 10 minutes for empty sessions
    
    sessions.forEach((session, sessionId) => {
        const inactiveTime = now - session.createdAt.getTime();
        const lastActivity = Math.max(
            session.createdAt.getTime(),
            ...Array.from(session.controllers.values()).map(c => c.joinedAt.getTime())
        );
        const timeSinceLastActivity = now - lastActivity;
        
        let shouldCleanup = false;
        let reason = '';
        
        if (!session.isActive && inactiveTime > inactiveThreshold) {
            shouldCleanup = true;
            reason = 'inactive too long';
        } else if (session.controllers.size === 0 && timeSinceLastActivity > emptyThreshold) {
            shouldCleanup = true;
            reason = 'empty session timeout';
        } else if (session.performanceMonitor) {
            const stats = session.performanceMonitor.getStats();
            // Clean up sessions with extremely poor performance
            if (stats.averageSignalingLatency > 5000 && stats.runtime > 300) {
                shouldCleanup = true;
                reason = 'poor performance';
            }
        }
        
        if (shouldCleanup) {
            console.log(`🧹 Cleaning up Enhanced WebRTC session: ${sessionId} (${reason})`);
            endEnhancedWebRTCSession(sessionId);
        }
    });
}, 5 * 60 * 1000); // Check every 5 minutes

// Enhanced performance monitoring with multi-user metrics
setInterval(() => {
    const activeSessionsCount = Array.from(sessions.values()).filter(s => s.isActive).length;
    const connectedSessionsCount = Array.from(sessions.values()).filter(s => s.webrtcConnected).length;
    const totalUsers = Array.from(sessions.values()).reduce((sum, s) => sum + s.controllers.size, 0);
    const totalSignaling = Object.values(signalingQueue.queues).reduce((sum, q) => sum + q.length, 0);
    
    // Calculate average session utilization
    let totalUtilization = 0;
    let utilizationCount = 0;
    sessions.forEach(session => {
        if (session.isActive) {
            const utilization = (session.controllers.size / session.maxUsers) * 100;
            totalUtilization += utilization;
            utilizationCount++;
        }
    });
    const avgUtilization = utilizationCount > 0 ? totalUtilization / utilizationCount : 0;
    
    // Warning thresholds for multi-user environment
    if (totalSignaling > 200) {
        console.log(`⚠️ High signaling queue load: ${totalSignaling} messages pending`);
    }
    
    if (totalUsers > 50) {
        console.log(`⚠️ High user load: ${totalUsers} connected users across ${activeSessionsCount} sessions`);
    }
    
    if (activeSessionsCount > 0) {
        console.log(`📈 Active: ${activeSessionsCount}, WebRTC: ${connectedSessionsCount}, Users: ${totalUsers}, Queue: ${totalSignaling}, Util: ${avgUtilization.toFixed(1)}%`);
    }
    
    // Performance optimization suggestions
    if (avgUtilization > 80) {
        console.log(`💡 High utilization detected - consider increasing maxUsers or load balancing`);
    }
    
}, 30000); // Check every 30 seconds

// Network quality assessment endpoint
app.get('/api/network-quality/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    const networkAssessment = {
        sessionId,
        currentQuality: session.currentQuality,
        networkStats: session.networkStats,
        qualityHistory: session.qualityHistory.slice(-5), // Last 5 adaptations
        recommendations: []
    };
    
    // Generate recommendations
    if (session.networkStats.averageLatency > 100) {
        networkAssessment.recommendations.push({
            type: 'latency',
            message: 'High latency detected - consider reducing quality or checking network',
            priority: 'high'
        });
    }
    
    if (session.networkStats.packetLoss > 3) {
        networkAssessment.recommendations.push({
            type: 'packetLoss',
            message: 'Packet loss detected - network connection may be unstable',
            priority: 'medium'
        });
    }
    
    if (session.controllers.size >= session.maxUsers * 0.8) {
        networkAssessment.recommendations.push({
            type: 'capacity',
            message: 'Session nearing capacity - performance may degrade',
            priority: 'low'
        });
    }
    
    res.json(networkAssessment);
});

// User management endpoint
app.get('/api/session/:sessionId/users', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    const users = Array.from(session.controllers.values()).map(controller => ({
        userId: controller.userId,
        name: controller.name,
        color: controller.color,
        platform: controller.platform,
        joinedAt: controller.joinedAt,
        signalingLatency: controller.signalingLatency,
        mousePosition: controller.mousePosition,
        isActive: connectedClients.has(controller.socketId)
    }));
    
    res.json({
        sessionId,
        hostConnected: !!session.hostSocket,
        totalUsers: users.length,
        maxUsers: session.maxUsers,
        users,
        sessionStats: session.performanceMonitor ? session.performanceMonitor.getStats() : null
    });
});

// Server startup with enhanced logging
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log('='.repeat(80));
    console.log('🚀 Enhanced WebRTC Remote Desktop Signaling Server v2.1.0');
    console.log('='.repeat(80));
    console.log(`🔗 Server running on: http://${HOST}:${PORT}`);
    console.log(`🏥 Health check: http://${HOST}:${PORT}/health`);
    console.log(`📊 API endpoint: http://${HOST}:${PORT}/api/sessions`);
    console.log(`🧊 ICE servers: http://${HOST}:${PORT}/api/ice-servers`);
    console.log(`📈 Quality levels: http://${HOST}:${PORT}/api/quality-levels`);
    console.log(`🌍 Platform: ${os.platform()} ${os.arch()}`);
    console.log(`💾 Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
    console.log('='.repeat(80));
    console.log(`⚡ Enhanced WebRTC Features:`);
    console.log(`   ✅ Multi-user support (up to 5 users per session)`);
    console.log(`   ✅ Adaptive quality (2K to 480p automatic)`);
    console.log(`   ✅ Cross-platform optimizations`);
    console.log(`   ✅ Enhanced networking with fallbacks`);
    console.log(`   ✅ Real-time mouse cursor sharing`);
    console.log(`   ✅ User management and kick functionality`);
    console.log(`   ✅ Network quality monitoring`);
    console.log(`   ✅ P2P media streaming (bypasses server)`);
    console.log(`   ✅ DataChannel input events`);
    console.log(`   ✅ FFmpeg RTP -> WebRTC bridge`);
    console.log(`   ✅ Frame skipping for real-time`);
    console.log(`   ✅ Priority-based signaling queue`);
    console.log(`   ✅ <50ms end-to-end latency target`);
    console.log('='.repeat(80));
    console.log(`🎯 Multi-User Architecture:`);
    console.log(`   • Server: Enhanced WebRTC signaling with user management`);
    console.log(`   • Media: Direct P2P UDP streams between all participants`);
    console.log(`   • Input: Individual WebRTC DataChannels per user`);
    console.log(`   • Cursors: Real-time mouse position sharing`);
    console.log(`   • Quality: Automatic adaptation based on network conditions`);
    console.log(`   • Capture: FFmpeg RTP ultra-fast with platform optimizations`);
    console.log('='.repeat(80));
    console.log(`📋 Session Management:`);
    console.log(`   • Max users per session: 5`);
    console.log(`   • Auto-cleanup: Inactive (45min), Empty (10min)`);
    console.log(`   • Quality adaptation: Every second`);
    console.log(`   • Performance monitoring: Real-time`);
    console.log(`   • User colors: Automatic assignment`);
    console.log(`   • Host controls: Kick users, quality override`);
    console.log('='.repeat(80));
});

// Enhanced graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Enhanced WebRTC signaling server...');
    
    let totalStats = {
        signalingSent: 0,
        dataTransferred: 0,
        totalUsers: 0,
        totalSessions: sessions.size
    };
    
    // End all sessions with enhanced performance summary
    sessions.forEach((session, sessionId) => {
        if (session.performanceMonitor) {
            const stats = session.performanceMonitor.getStats();
            console.log(`📊 Session ${sessionId}: ${stats.signalingSent} signals, ${stats.averageSignalingLatency.toFixed(2)}ms avg, ${session.controllers.size} users`);
            
            totalStats.signalingSent += stats.signalingSent;
            totalStats.dataTransferred += stats.totalDataTransferred;
            totalStats.totalUsers += session.controllers.size;
        }
        endEnhancedWebRTCSession(sessionId);
    });
    
    console.log('='.repeat(60));
    console.log('📈 Final Server Statistics:');
    console.log(`   Total sessions: ${totalStats.totalSessions}`);
    console.log(`   Total users served: ${totalStats.totalUsers}`);
    console.log(`   Total signals sent: ${totalStats.signalingSent}`);
    console.log(`   Total data transferred: ${(totalStats.dataTransferred / 1024 / 1024).toFixed(2)}MB`);
    console.log('='.repeat(60));
    
    server.close(() => {
        console.log('✅ Enhanced WebRTC signaling server closed gracefully');
        process.exit(0);
    });
    
    setTimeout(() => {
        console.log('⚠️ Forcing server shutdown');
        process.exit(1);
    }, 10000);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down Enhanced WebRTC server gracefully...');
    
    sessions.forEach((session, sessionId) => {
        endEnhancedWebRTCSession(sessionId);
    });
    
    server.close(() => {
        console.log('✅ Enhanced server closed');
        process.exit(0);
    });
});

// Enhanced error handling
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception in Enhanced WebRTC Server:', error);
    console.error('Stack:', error.stack);
    
    // Try to gracefully close sessions before exiting
    sessions.forEach((session, sessionId) => {
        try {
            endEnhancedWebRTCSession(sessionId);
        } catch (e) {
            console.error(`Error closing session ${sessionId}:`, e);
        }
    });
    
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection in Enhanced WebRTC Server at:', promise, 'reason:', reason);
    
    // Don't exit on unhandled rejections, just log them
    console.error('Continuing server operation...');
});

// Enhanced memory and performance monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.rss / 1024 / 1024);
    
    // Memory warnings for multi-user environment
    if (memMB > 500) {
        console.log(`⚠️ High memory usage: ${memMB}MB RSS, ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB heap`);
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            console.log('🗑️ Forced garbage collection');
        }
    }
    
    // Session memory usage estimation
    let sessionMemoryUsage = 0;
    sessions.forEach(session => {
        // Rough estimation: 1MB per session + 200KB per user
        sessionMemoryUsage += 1 + (session.controllers.size * 0.2);
    });
    
    if (sessionMemoryUsage > 50) {
        console.log(`📊 Estimated session memory usage: ${sessionMemoryUsage.toFixed(1)}MB`);
    }
    
}, 60000); // Check every minute

module.exports = { app, server, io };
