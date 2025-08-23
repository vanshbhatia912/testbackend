const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

const app = express();
const server = http.createServer(app);

// WebRTC-optimized Socket.IO configuration
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    transports: ['websocket'], // WebSocket only for signaling
    allowEIO3: true,
    pingTimeout: 30000,        // Shorter timeouts for WebRTC
    pingInterval: 10000,
    upgradeTimeout: 5000,
    maxHttpBufferSize: 10e6,   // Smaller buffer - WebRTC handles media
    compression: true,         // Compress signaling data
    perMessageDeflate: {
        threshold: 1024,       // Only compress larger messages
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

// WebRTC Sessions storage
const sessions = new Map();
const connectedClients = new Map();

// WebRTC STUN/TURN configuration
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Add TURN servers for production:
    // {
    //     urls: 'turn:your-turn-server.com:3478',
    //     username: 'username',
    //     credential: 'password'
    // }
];

// Priority queue for WebRTC signaling (faster than media relay)
class WebRTCSignalingQueue {
    constructor() {
        this.queues = {
            1: [], // ICE candidates (highest priority)
            2: [], // SDP offers/answers
            3: [], // DataChannel messages (input events)
            4: []  // General signaling
        };
        this.processing = false;
    }

    enqueue(event, priority = 4) {
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
        
        // Process in priority order: ICE > SDP > DataChannel > General
        for (let priority = 1; priority <= 4; priority++) {
            while (this.queues[priority].length > 0) {
                const event = this.queues[priority].shift();
                await this.handleEvent(event);
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
}

// Global signaling queue
const signalingQueue = new WebRTCSignalingQueue();

// WebRTC Performance Monitor
class WebRTCPerformanceMonitor {
    constructor() {
        this.metrics = {
            signalingSent: 0,
            iceExchanges: 0,
            sdpExchanges: 0,
            dataChannelMessages: 0,
            averageSignalingLatency: 0,
            connectionEstablishTime: 0,
            lastConnectionTime: 0
        };
        this.startTime = performance.now();
        this.signalingLatencies = [];
    }

    recordSignaling(type, latency) {
        this.metrics.signalingSent++;
        
        if (type === 'ice-candidate') {
            this.metrics.iceExchanges++;
        } else if (type.includes('sdp')) {
            this.metrics.sdpExchanges++;
        } else if (type === 'datachannel') {
            this.metrics.dataChannelMessages++;
        }

        if (latency) {
            this.signalingLatencies.push(latency);
            if (this.signalingLatencies.length > 50) {
                this.signalingLatencies = this.signalingLatencies.slice(-25);
            }
            
            const sum = this.signalingLatencies.reduce((a, b) => a + b, 0);
            this.metrics.averageSignalingLatency = sum / this.signalingLatencies.length;
        }
    }

    recordConnection() {
        const now = performance.now();
        this.metrics.connectionEstablishTime = now - this.metrics.lastConnectionTime;
        this.metrics.lastConnectionTime = now;
    }

    getStats() {
        const runtime = (performance.now() - this.startTime) / 1000;
        return {
            ...this.metrics,
            runtime: Math.round(runtime),
            signalingPerSecond: runtime > 0 ? this.metrics.signalingSent / runtime : 0
        };
    }
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

function getSystemInfo() {
    return {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpus: os.cpus().length,
        memory: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        uptime: os.uptime(),
        webrtcSupport: true
    };
}

function isValidSession(sessionId, password) {
    const session = sessions.get(sessionId);
    return session && session.password === password;
}

// Routes with WebRTC info
app.get('/', (req, res) => {
    res.json({
        name: 'WebRTC Remote Desktop Signaling Server',
        version: '2.0.0',
        platform: os.platform(),
        arch: os.arch(),
        status: 'running',
        sessions: sessions.size,
        clients: connectedClients.size,
        webrtc: {
            signalingOnly: true,
            p2pMediaStreaming: true,
            dataChannelInput: true,
            ultraLowLatency: true,
            frameSkipping: true,
            iceServers: ICE_SERVERS.map(server => server.urls)
        }
    });
});

app.get('/health', (req, res) => {
    const memUsage = process.memoryUsage();
    
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
        },
        system: getSystemInfo(),
        sessions: sessions.size,
        signalingQueueSize: Object.values(signalingQueue.queues).reduce((sum, q) => sum + q.length, 0),
        webrtc: {
            iceServers: ICE_SERVERS.length,
            activeSessions: Array.from(sessions.values()).filter(s => s.webrtcConnected).length
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
        controllerCount: session.controllers.length,
        platform: session.platform,
        webrtcConnected: session.webrtcConnected,
        rtpPort: session.rtpPort,
        performance: session.performanceMonitor ? session.performanceMonitor.getStats() : null
    }));
    
    res.json(sessionList);
});

// WebRTC ICE servers endpoint
app.get('/api/ice-servers', (req, res) => {
    res.json({
        iceServers: ICE_SERVERS
    });
});

// Socket.IO WebRTC signaling
io.on('connection', (socket) => {
    const clientInfo = {
        id: socket.id,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        connectedAt: new Date(),
        signalingLatency: 0,
        webrtcSupported: true
    };
    
    connectedClients.set(socket.id, clientInfo);
    
    console.log(`🔗 WebRTC client connected: ${socket.id} from ${clientInfo.ip}`);
    console.log(`📊 Total clients: ${connectedClients.size}, Active sessions: ${sessions.size}`);

    // Send ICE servers configuration
    socket.emit('ice-servers', { iceServers: ICE_SERVERS });

    // WebRTC signaling latency measurement
    socket.on('ping', (timestamp) => {
        const latency = Date.now() - timestamp;
        clientInfo.signalingLatency = latency;
        socket.emit('pong', { timestamp, latency });
    });

    // Create WebRTC session
    socket.on('create-session', (data) => {
        const { platform = 'unknown', webrtcCapabilities = {} } = data;
        
        const sessionId = generateSessionId();
        const password = generatePassword();
        
        const session = {
            id: sessionId,
            password,
            createdAt: new Date(),
            isActive: false,
            hostSocket: socket.id,
            controllers: [],
            platform,
            performanceMonitor: new WebRTCPerformanceMonitor(),
            // WebRTC specific
            webrtcConnected: false,
            rtpPort: null,
            iceServers: ICE_SERVERS,
            webrtcCapabilities
        };
        
        sessions.set(sessionId, session);
        socket.join(`session-${sessionId}`);
        
        socket.emit('session-created', {
            success: true,
            sessionId,
            password,
            platform,
            iceServers: ICE_SERVERS,
            webrtcEnabled: true
        });
        
        console.log(`🎯 WebRTC session created: ${sessionId} by ${socket.id}`);
    });

    // Start WebRTC hosting
    socket.on('start-webrtc-host', (data) => {
        const { sessionId, password, rtpPort } = data;
        
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
        session.performanceMonitor = new WebRTCPerformanceMonitor();
        
        socket.emit('webrtc-host-ready', { 
            success: true,
            rtpPort: rtpPort,
            iceServers: ICE_SERVERS
        });
        
        console.log(`🖥️ WebRTC host started: ${sessionId} (RTP port: ${rtpPort})`);
    });

    // Join WebRTC session as controller
    socket.on('join-webrtc-session', (data) => {
        const { sessionId, password, webrtcCapabilities = {} } = data;
        
        if (!isValidSession(sessionId, password)) {
            socket.emit('join-error', { message: 'Invalid session or password' });
            return;
        }
        
        const session = sessions.get(sessionId);
        if (!session.isActive) {
            socket.emit('join-error', { message: 'Session is not active' });
            return;
        }
        
        const controller = {
            socketId: socket.id,
            joinedAt: new Date(),
            signalingLatency: clientInfo.signalingLatency,
            webrtcCapabilities
        };
        
        session.controllers.push(controller);
        socket.join(`session-${sessionId}`);
        
        socket.emit('webrtc-join-ready', { 
            success: true,
            sessionInfo: {
                id: sessionId,
                platform: session.platform,
                rtpPort: session.rtpPort,
                hostConnected: !!session.hostSocket
            },
            iceServers: ICE_SERVERS
        });
        
        // Notify host
        if (session.hostSocket) {
            io.to(session.hostSocket).emit('controller-joined', {
                userId: socket.id,
                userCount: session.controllers.length
            });
        }
        
        console.log(`🎮 WebRTC controller joined: ${socket.id} -> ${sessionId}`);
    });

    // WebRTC SDP signaling (high priority)
    socket.on('webrtc-offer', (data) => {
        const { sessionId, offer, targetPeer } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        signalingQueue.enqueue({
            type: 'webrtc-offer',
            sessionId,
            data: { offer, fromPeer: socket.id },
            targetSocket: targetPeer
        }, 2);
        
        session.performanceMonitor.recordSignaling('sdp-offer');
        console.log(`📡 WebRTC offer: ${socket.id} -> ${targetPeer} (${sessionId})`);
    });

    socket.on('webrtc-answer', (data) => {
        const { sessionId, answer, targetPeer } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        signalingQueue.enqueue({
            type: 'webrtc-answer',
            sessionId,
            data: { answer, fromPeer: socket.id },
            targetSocket: targetPeer
        }, 2);
        
        session.performanceMonitor.recordSignaling('sdp-answer');
        console.log(`📡 WebRTC answer: ${socket.id} -> ${targetPeer} (${sessionId})`);
    });

    // ICE candidate signaling (highest priority)
    socket.on('webrtc-ice-candidate', (data) => {
        const { sessionId, candidate, targetPeer } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        signalingQueue.enqueue({
            type: 'webrtc-ice-candidate',
            sessionId,
            data: { candidate, fromPeer: socket.id },
            targetSocket: targetPeer
        }, 1);
        
        session.performanceMonitor.recordSignaling('ice-candidate');
    });

    // WebRTC connection established
    socket.on('webrtc-connected', (data) => {
        const { sessionId } = data;
        const session = sessions.get(sessionId);
        
        if (session) {
            session.webrtcConnected = true;
            session.performanceMonitor.recordConnection();
            
            socket.to(`session-${sessionId}`).emit('peer-connected', {
                peerId: socket.id,
                sessionId
            });
            
            console.log(`✅ WebRTC P2P connected: ${socket.id} in ${sessionId}`);
        }
    });

    // DataChannel input events (medium priority)
    socket.on('datachannel-input', (data) => {
        const { sessionId, inputData, targetPeer } = data;
        const session = sessions.get(sessionId);
        
        if (!session) return;
        
        signalingQueue.enqueue({
            type: 'datachannel-input',
            sessionId,
            data: inputData,
            targetSocket: targetPeer
        }, 3);
        
        session.performanceMonitor.recordSignaling('datachannel');
    });

    // WebRTC stats reporting
    socket.on('webrtc-stats', (data) => {
        const { sessionId, stats } = data;
        
        // Relay stats to other participants
        socket.to(`session-${sessionId}`).emit('peer-stats', {
            peerId: socket.id,
            stats: stats
        });
    });

    // Session management
    socket.on('end-session', (data) => {
        const { sessionId } = data;
        endWebRTCSession(sessionId, socket.id);
    });

    socket.on('disconnect-from-session', (data) => {
        const { sessionId } = data;
        const session = sessions.get(sessionId);
        
        if (session) {
            session.controllers = session.controllers.filter(c => c.socketId !== socket.id);
            socket.leave(`session-${sessionId}`);
            
            socket.to(`session-${sessionId}`).emit('peer-disconnected', {
                peerId: socket.id,
                userCount: session.controllers.length
            });
            
            console.log(`👋 WebRTC controller left: ${socket.id} from ${sessionId}`);
        }
    });

    // Handle client disconnect
    socket.on('disconnect', () => {
        connectedClients.delete(socket.id);
        
        sessions.forEach((session, sessionId) => {
            if (session.hostSocket === socket.id) {
                console.log(`🖥️ WebRTC host disconnected: ${sessionId}`);
                endWebRTCSession(sessionId);
            } else {
                const wasController = session.controllers.some(c => c.socketId === socket.id);
                if (wasController) {
                    session.controllers = session.controllers.filter(c => c.socketId !== socket.id);
                    
                    socket.to(`session-${sessionId}`).emit('peer-disconnected', {
                        peerId: socket.id,
                        userCount: session.controllers.length
                    });
                    
                    console.log(`🎮 WebRTC controller disconnected: ${socket.id} from ${sessionId}`);
                }
            }
        });
        
        console.log(`🔌 WebRTC client disconnected: ${socket.id}`);
        console.log(`📊 Total clients: ${connectedClients.size}, Active sessions: ${sessions.size}`);
    });
});

// End WebRTC session function
function endWebRTCSession(sessionId, requesterId = null) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    // Get final performance stats
    const finalStats = session.performanceMonitor ? session.performanceMonitor.getStats() : null;
    
    // Notify all participants
    io.to(`session-${sessionId}`).emit('session-ended', {
        sessionId,
        endedBy: requesterId,
        stats: finalStats
    });
    
    // Clean up
    sessions.delete(sessionId);
    
    console.log(`🔴 WebRTC session ended: ${sessionId} (${session.controllers.length} controllers)`);
    if (finalStats) {
        console.log(`📊 Final stats: ${finalStats.signalingSent} signals, ${finalStats.averageSignalingLatency.toFixed(2)}ms avg latency`);
    }
}

// Clean up inactive sessions
setInterval(() => {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes
    
    sessions.forEach((session, sessionId) => {
        const inactiveTime = now - session.createdAt.getTime();
        
        if (!session.isActive && inactiveTime > inactiveThreshold) {
            console.log(`🧹 Cleaning up inactive WebRTC session: ${sessionId}`);
            endWebRTCSession(sessionId);
        }
    });
}, 5 * 60 * 1000);

// Performance monitoring
setInterval(() => {
    const activeSessionsCount = Array.from(sessions.values()).filter(s => s.isActive).length;
    const connectedSessionsCount = Array.from(sessions.values()).filter(s => s.webrtcConnected).length;
    const totalSignaling = Object.values(signalingQueue.queues).reduce((sum, q) => sum + q.length, 0);
    
    if (totalSignaling > 50) {
        console.log(`⚠️ High signaling queue load: ${totalSignaling} messages pending`);
    }
    
    if (activeSessionsCount > 0) {
        console.log(`📈 Active: ${activeSessionsCount}, WebRTC Connected: ${connectedSessionsCount}, Queue: ${totalSignaling}, Clients: ${connectedClients.size}`);
    }
}, 30000);

// Server startup
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log('='.repeat(70));
    console.log('🚀 WebRTC Remote Desktop Signaling Server');
    console.log('='.repeat(70));
    console.log(`🔗 Server running on: http://${HOST}:${PORT}`);
    console.log(`🏥 Health check: http://${HOST}:${PORT}/health`);
    console.log(`📊 API endpoint: http://${HOST}:${PORT}/api/sessions`);
    console.log(`🧊 ICE servers: http://${HOST}:${PORT}/api/ice-servers`);
    console.log(`🌐 Platform: ${os.platform()} ${os.arch()}`);
    console.log(`💾 Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
    console.log('='.repeat(70));
    console.log(`⚡ WebRTC Ultra Low-Latency Features:`);
    console.log(`   ✅ P2P media streaming (bypasses server)`);
    console.log(`   ✅ DataChannel input events`);
    console.log(`   ✅ FFmpeg RTP -> WebRTC bridge`);
    console.log(`   ✅ Frame skipping for real-time`);
    console.log(`   ✅ ICE/STUN for NAT traversal`);
    console.log(`   ✅ Priority-based signaling queue`);
    console.log(`   ✅ <50ms end-to-end target`);
    console.log('='.repeat(70));
    console.log(`🎯 Architecture:`);
    console.log(`   • Server: WebRTC signaling only`);
    console.log(`   • Media: Direct P2P UDP streams`);
    console.log(`   • Input: WebRTC DataChannels`);
    console.log(`   • Capture: FFmpeg RTP ultra-fast`);
    console.log('='.repeat(70));
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down WebRTC signaling server...');
    
    // End all sessions with performance summary
    sessions.forEach((session, sessionId) => {
        if (session.performanceMonitor) {
            const stats = session.performanceMonitor.getStats();
            console.log(`📊 Session ${sessionId}: ${stats.signalingSent} signals, ${stats.averageSignalingLatency.toFixed(2)}ms avg`);
        }
        endWebRTCSession(sessionId);
    });
    
    server.close(() => {
        console.log('✅ WebRTC signaling server closed gracefully');
        process.exit(0);
    });
    
    setTimeout(() => {
        console.log('⚠️ Forcing server shutdown');
        process.exit(1);
    }, 10000);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    
    sessions.forEach((session, sessionId) => {
        endWebRTCSession(sessionId);
    });
    
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Memory monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.rss / 1024 / 1024);
    
    if (memMB > 300) {
        console.log(`⚠️ High memory usage: ${memMB}MB RSS, ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB heap`);
    }
}, 60000);
