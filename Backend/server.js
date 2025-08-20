const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

const app = express();
const server = http.createServer(app);

// Optimized Socket.IO configuration for low latency binary transmission
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    transports: ['websocket'], // WebSocket only for lower latency
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,
    maxHttpBufferSize: 50e6, // 50MB for large binary frames
    compression: false, // Disable compression for lower latency
    perMessageDeflate: false,
    // Enable binary support
    parser: require('socket.io-parser'),
    allowRequest: (req, callback) => {
        callback(null, true);
    }
});

// Middleware
app.use(cors({
    origin: "*",
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Store active sessions with enhanced performance tracking
const sessions = new Map();
const connectedClients = new Map();

// Priority queue for different event types
class PriorityEventQueue {
    constructor() {
        this.queues = {
            1: [], // Keyboard events (highest priority)
            2: [], // Mouse clicks
            3: [], // Mouse moves
            4: [], // Scroll events
            5: []  // Frame data (lowest priority)
        };
        this.processing = false;
    }

    enqueue(event, priority = 5) {
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
        
        // Process events in priority order
        for (let priority = 1; priority <= 5; priority++) {
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
            // Relay event to appropriate session participants
            if (event.sessionId && event.targetSocket) {
                io.to(event.targetSocket).emit(event.type, event.data);
            } else if (event.sessionId) {
                io.to(`session-${event.sessionId}`).emit(event.type, event.data);
            }
        } catch (error) {
            console.error('❌ Event handling error:', error);
        }
    }
}

// Global event queue for prioritized processing
const eventQueue = new PriorityEventQueue();

// Enhanced Quality settings for adaptive FPS
const ADAPTIVE_QUALITY_SETTINGS = {
    low: { baseFps: 15, minFps: 8, maxFps: 20, latencyThreshold: 150 },
    medium: { baseFps: 24, minFps: 15, maxFps: 30, latencyThreshold: 100 },
    high: { baseFps: 30, minFps: 20, maxFps: 45, latencyThreshold: 80 },
    ultra: { baseFps: 60, minFps: 30, maxFps: 60, latencyThreshold: 50 }
};

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
        uptime: os.uptime()
    };
}

function isValidSession(sessionId, password) {
    const session = sessions.get(sessionId);
    return session && session.password === password;
}

// Enhanced Performance monitoring for relay server
class RelayPerformanceMonitor {
    constructor() {
        this.metrics = {
            eventsProcessed: 0,
            binaryFramesRelayed: 0,
            inputEventsRelayed: 0,
            averageLatency: 0,
            bytesTransferred: 0,
            adaptiveFPSChanges: 0
        };
        this.startTime = performance.now();
        this.latencyHistory = [];
    }

    recordEvent(type, latency, bytes = 0) {
        this.metrics.eventsProcessed++;
        this.metrics.bytesTransferred += bytes;
        
        if (type === 'frame') {
            this.metrics.binaryFramesRelayed++;
        } else if (['keyboard', 'mouse', 'scroll'].includes(type)) {
            this.metrics.inputEventsRelayed++;
        }

        // Track latency
        if (latency) {
            this.latencyHistory.push(latency);
            if (this.latencyHistory.length > 100) {
                this.latencyHistory = this.latencyHistory.slice(-50);
            }
            
            const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
            this.metrics.averageLatency = sum / this.latencyHistory.length;
        }
    }

    recordAdaptiveFPSChange() {
        this.metrics.adaptiveFPSChanges++;
    }

    getStats() {
        const runtime = (performance.now() - this.startTime) / 1000;
        return {
            ...this.metrics,
            runtime: Math.round(runtime),
            eventsPerSecond: runtime > 0 ? this.metrics.eventsProcessed / runtime : 0,
            mbTransferred: this.metrics.bytesTransferred / (1024 * 1024)
        };
    }
}

// Routes with enhanced binary support info
app.get('/', (req, res) => {
    res.json({
        name: 'Remote Desktop Relay Server - Binary Optimized',
        version: '2.0.0',
        platform: os.platform(),
        arch: os.arch(),
        status: 'running',
        sessions: sessions.size,
        clients: connectedClients.size,
        optimizations: {
            binaryFrames: true,
            prioritizedEvents: true,
            adaptiveFPS: true,
            webSocketOnly: true,
            compressionDisabled: true,
            inputPrioritization: true
        }
    });
});

app.get('/health', (req, res) => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024)
        },
        cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system
        },
        system: getSystemInfo(),
        sessions: sessions.size,
        eventQueueSize: Object.values(eventQueue.queues).reduce((sum, q) => sum + q.length, 0),
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
        quality: session.quality,
        currentFPS: session.currentFPS,
        adaptiveFPSEnabled: session.adaptiveFPS,
        performance: session.performanceMonitor ? session.performanceMonitor.getStats() : null
    }));
    
    res.json(sessionList);
});

// Socket.IO connection handling with binary frame support
io.on('connection', (socket) => {
    const clientInfo = {
        id: socket.id,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        connectedAt: new Date(),
        latency: 0,
        eventsSent: 0,
        bytesSent: 0
    };
    
    connectedClients.set(socket.id, clientInfo);
    
    console.log(`🔗 Client connected: ${socket.id} from ${clientInfo.ip}`);
    console.log(`📊 Total clients: ${connectedClients.size}, Active sessions: ${sessions.size}`);

    // Enhanced latency measurement with adaptive FPS
    socket.on('ping', (timestamp) => {
        const latency = Date.now() - timestamp;
        clientInfo.latency = latency;
        socket.emit('pong', { timestamp, latency });
        
        // Trigger adaptive FPS adjustment based on latency
        updateAdaptiveFPS(socket.id, latency);
    });

    // Create session
    socket.on('create-session', (data) => {
        const { quality = 'medium', platform = 'unknown', clientCapabilities = {} } = data;
        
        const sessionId = generateSessionId();
        const password = generatePassword();
        
        const session = {
            id: sessionId,
            password,
            createdAt: new Date(),
            isActive: false,
            hostSocket: socket.id,
            controllers: [],
            quality,
            platform,
            performanceMonitor: new RelayPerformanceMonitor(),
            // Adaptive FPS settings
            adaptiveFPS: clientCapabilities.adaptiveFPS !== false,
            currentFPS: ADAPTIVE_QUALITY_SETTINGS[quality].baseFps,
            qualitySettings: ADAPTIVE_QUALITY_SETTINGS[quality],
            lastFrameTime: 0,
            frameCount: 0,
            // Binary frame support
            binaryFrames: clientCapabilities.binaryFrames !== false,
            clientCapabilities
        };
        
        sessions.set(sessionId, session);
        socket.join(`session-${sessionId}`);
        
        socket.emit('session-created', {
            success: true,
            sessionId,
            password,
            quality,
            platform,
            adaptiveFPS: session.adaptiveFPS,
            binaryFrames: session.binaryFrames
        });
        
        console.log(`🎯 Session created: ${sessionId} by ${socket.id} (${quality}, adaptive: ${session.adaptiveFPS})`);
    });

    // Start hosting
    socket.on('start-host', (data) => {
        const { sessionId, password } = data;
        
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
        session.performanceMonitor = new RelayPerformanceMonitor();
        
        socket.emit('host-connected', { 
            success: true,
            adaptiveFPS: session.adaptiveFPS,
            currentFPS: session.currentFPS
        });
        
        console.log(`🖥️ Host started: ${sessionId} (FPS: ${session.currentFPS})`);
    });

    // Join session as controller
    socket.on('join-session', (data) => {
        const { sessionId, password, mode = 'control', platform = 'unknown' } = data;
        
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
            mode,
            platform,
            joinedAt: new Date(),
            latency: clientInfo.latency
        };
        
        session.controllers.push(controller);
        socket.join(`session-${sessionId}`);
        
        socket.emit('controller-connected', { 
            success: true,
            mode,
            sessionInfo: {
                id: sessionId,
                platform: session.platform,
                quality: session.quality,
                currentFPS: session.currentFPS,
                adaptiveFPS: session.adaptiveFPS,
                binaryFrames: session.binaryFrames,
                hostConnected: !!session.hostSocket
            }
        });
        
        // Notify host
        if (session.hostSocket) {
            io.to(session.hostSocket).emit('controller-joined', {
                userId: socket.id,
                userCount: session.controllers.length,
                platform,
                latency: clientInfo.latency
            });
        }
        
        console.log(`🎮 Controller joined: ${socket.id} -> ${sessionId} (${mode})`);
    });

    // Binary frame relay with prioritization
    socket.on('screen-frame-binary', (data) => {
        const { sessionId, frameBuffer, metadata } = data;
        const session = sessions.get(sessionId);
        
        if (!session || session.hostSocket !== socket.id) return;
        
        const frameStartTime = performance.now();
        
        // Add to priority queue (lowest priority for frames)
        eventQueue.enqueue({
            type: 'screen-frame-binary',
            sessionId,
            data: { frameBuffer, metadata },
            targetSocket: null // Broadcast to all controllers
        }, 5);
        
        // Update performance stats
        session.performanceMonitor.recordEvent('frame', 
            performance.now() - frameStartTime, 
            frameBuffer.byteLength
        );
        
        session.frameCount++;
        session.lastFrameTime = Date.now();
        
        // Adaptive FPS check
        if (session.adaptiveFPS && session.frameCount % 30 === 0) {
            checkAndAdjustFPS(sessionId);
        }
    });

    // Legacy base64 frame relay (fallback)
    socket.on('screen-frame-data', (data) => {
        const { sessionId } = data;
        const session = sessions.get(sessionId);
        
        if (!session || session.hostSocket !== socket.id) return;
        
        // Convert to binary if client supports it
        if (session.binaryFrames && data.image) {
            try {
                const base64Data = data.image.split(',')[1];
                const frameBuffer = Buffer.from(base64Data, 'base64');
                
                eventQueue.enqueue({
                    type: 'screen-frame-binary',
                    sessionId,
                    data: { 
                        frameBuffer,
                        metadata: {
                            width: data.width,
                            height: data.height,
                            timestamp: data.timestamp,
                            frameNumber: data.frameNumber,
                            format: 'jpeg'
                        }
                    }
                }, 5);
            } catch (error) {
                console.error('❌ Binary conversion error:', error);
                // Fallback to original format
                eventQueue.enqueue({
                    type: 'screen-update',
                    sessionId,
                    data: data
                }, 5);
            }
        } else {
            eventQueue.enqueue({
                type: 'screen-update',
                sessionId,
                data: data
            }, 5);
        }
        
        session.performanceMonitor.recordEvent('frame', 0, 
            data.image ? data.image.length : 0);
    });

    // Prioritized input event relay
    socket.on('mouse-event', (data) => {
        const { sessionId, type } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.controllers.some(c => c.socketId === socket.id)) return;
        
        // Prioritize input events
        const priority = type === 'mousemove' ? 3 : 2;
        
        eventQueue.enqueue({
            type: 'remote-mouse-event',
            sessionId,
            data: data,
            targetSocket: session.hostSocket
        }, priority);
        
        session.performanceMonitor.recordEvent('mouse', 0);
        clientInfo.eventsSent++;
    });

    socket.on('keyboard-event', (data) => {
        const { sessionId } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.controllers.some(c => c.socketId === socket.id && c.mode === 'control')) return;
        
        // Highest priority for keyboard events
        eventQueue.enqueue({
            type: 'remote-keyboard-event',
            sessionId,
            data: data,
            targetSocket: session.hostSocket
        }, 1);
        
        session.performanceMonitor.recordEvent('keyboard', 0);
        clientInfo.eventsSent++;
    });

    socket.on('key-combination', (data) => {
        const { sessionId } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.controllers.some(c => c.socketId === socket.id && c.mode === 'control')) return;
        
        eventQueue.enqueue({
            type: 'remote-key-combination',
            sessionId,
            data: data,
            targetSocket: session.hostSocket
        }, 1);
        
        session.performanceMonitor.recordEvent('keyboard', 0);
    });

    // Quality and FPS control
    socket.on('change-quality', (data) => {
        const { sessionId, quality } = data;
        const session = sessions.get(sessionId);
        
        if (!session || session.hostSocket !== socket.id) return;
        
        session.quality = quality;
        session.qualitySettings = ADAPTIVE_QUALITY_SETTINGS[quality];
        session.currentFPS = session.qualitySettings.baseFps;
        
        // Notify all participants
        io.to(`session-${sessionId}`).emit('quality-changed', { 
            quality, 
            currentFPS: session.currentFPS 
        });
        
        console.log(`📊 Quality changed: ${sessionId} -> ${quality} (${session.currentFPS} FPS)`);
    });

    socket.on('fps-adjustment', (data) => {
        const { sessionId, fps } = data;
        const session = sessions.get(sessionId);
        
        if (!session || session.hostSocket !== socket.id) return;
        
        const settings = session.qualitySettings;
        session.currentFPS = Math.max(settings.minFps, Math.min(settings.maxFps, fps));
        
        io.to(`session-${sessionId}`).emit('fps-changed', { fps: session.currentFPS });
        
        session.performanceMonitor.recordAdaptiveFPSChange();
        console.log(`🎛️ FPS adjusted: ${sessionId} -> ${session.currentFPS}`);
    });

    // Performance stats relay
    socket.on('client-performance-stats', (data) => {
        const { sessionId } = data;
        
        io.to(`session-${sessionId}`).emit('relay-performance-stats', {
            ...data,
            relayLatency: clientInfo.latency,
            serverStats: sessions.get(sessionId)?.performanceMonitor?.getStats()
        });
    });

    // Session management
    socket.on('end-session', (data) => {
        const { sessionId } = data;
        endSession(sessionId, socket.id);
    });

    socket.on('disconnect-from-session', (data) => {
        const { sessionId } = data;
        const session = sessions.get(sessionId);
        
        if (session) {
            session.controllers = session.controllers.filter(c => c.socketId !== socket.id);
            socket.leave(`session-${sessionId}`);
            
            socket.to(`session-${sessionId}`).emit('user-disconnected', {
                userId: socket.id,
                userCount: session.controllers.length
            });
            
            console.log(`👋 Controller left: ${socket.id} from ${sessionId}`);
        }
    });

    // Handle client disconnect
    socket.on('disconnect', () => {
        connectedClients.delete(socket.id);
        
        sessions.forEach((session, sessionId) => {
            if (session.hostSocket === socket.id) {
                console.log(`🖥️ Host disconnected: ${sessionId}`);
                endSession(sessionId);
            } else {
                const wasController = session.controllers.some(c => c.socketId === socket.id);
                if (wasController) {
                    session.controllers = session.controllers.filter(c => c.socketId !== socket.id);
                    
                    socket.to(`session-${sessionId}`).emit('user-disconnected', {
                        userId: socket.id,
                        userCount: session.controllers.length
                    });
                    
                    console.log(`🎮 Controller disconnected: ${socket.id} from ${sessionId}`);
                }
            }
        });
        
        console.log(`🔌 Client disconnected: ${socket.id}`);
        console.log(`📊 Total clients: ${connectedClients.size}, Active sessions: ${sessions.size}`);
    });
});

// Adaptive FPS functions
function updateAdaptiveFPS(socketId, latency) {
    const session = Array.from(sessions.values()).find(s => 
        s.hostSocket === socketId || s.controllers.some(c => c.socketId === socketId)
    );
    
    if (!session || !session.adaptiveFPS) return;
    
    const settings = session.qualitySettings;
    const targetFPS = calculateOptimalFPS(latency, settings);
    
    if (Math.abs(targetFPS - session.currentFPS) >= 2) {
        session.currentFPS = targetFPS;
        
        io.to(`session-${session.id}`).emit('adaptive-fps-change', { 
            fps: session.currentFPS,
            reason: `latency: ${latency}ms`
        });
        
        session.performanceMonitor.recordAdaptiveFPSChange();
    }
}

function calculateOptimalFPS(latency, settings) {
    if (latency > settings.latencyThreshold * 1.5) {
        return settings.minFps;
    } else if (latency < settings.latencyThreshold * 0.7) {
        return settings.maxFps;
    } else {
        // Linear interpolation between min and max based on latency
        const ratio = Math.max(0, Math.min(1, 
            (settings.latencyThreshold * 1.5 - latency) / 
            (settings.latencyThreshold * 0.8)
        ));
        return Math.round(settings.minFps + (settings.maxFps - settings.minFps) * ratio);
    }
}

function checkAndAdjustFPS(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || !session.adaptiveFPS) return;
    
    // Calculate current actual FPS based on frame intervals
    const now = Date.now();
    const timeSinceLastCheck = now - (session.lastFpsCheck || now - 1000);
    const framesSinceLastCheck = session.frameCount - (session.lastFrameCheck || 0);
    
    if (timeSinceLastCheck > 0) {
        const actualFPS = Math.round((framesSinceLastCheck * 1000) / timeSinceLastCheck);
        
        // Adjust target FPS if actual FPS is consistently different
        if (Math.abs(actualFPS - session.currentFPS) > 5) {
            const newFPS = Math.max(session.qualitySettings.minFps, 
                                  Math.min(session.qualitySettings.maxFps, actualFPS));
            
            if (newFPS !== session.currentFPS) {
                session.currentFPS = newFPS;
                
                io.to(`session-${sessionId}`).emit('adaptive-fps-change', { 
                    fps: session.currentFPS,
                    reason: `performance adjustment: actual ${actualFPS} vs target ${session.currentFPS}`
                });
            }
        }
    }
    
    session.lastFpsCheck = now;
    session.lastFrameCheck = session.frameCount;
}

// End session function
function endSession(sessionId, requesterId = null) {
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
    
    console.log(`🔴 Session ended: ${sessionId} (${session.controllers.length} controllers)`);
    if (finalStats) {
        console.log(`📊 Final stats: ${finalStats.eventsProcessed} events, ${finalStats.mbTransferred.toFixed(2)}MB transferred`);
    }
}

// Enhanced cleanup for inactive sessions
setInterval(() => {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes
    
    sessions.forEach((session, sessionId) => {
        const inactiveTime = now - session.createdAt.getTime();
        
        if (!session.isActive && inactiveTime > inactiveThreshold) {
            console.log(`🧹 Cleaning up inactive session: ${sessionId}`);
            endSession(sessionId);
        }
    });
}, 5 * 60 * 1000);

// Performance monitoring
setInterval(() => {
    const activeSessionsCount = Array.from(sessions.values()).filter(s => s.isActive).length;
    const totalEvents = Object.values(eventQueue.queues).reduce((sum, q) => sum + q.length, 0);
    
    if (totalEvents > 100) {
        console.log(`⚠️ High event queue load: ${totalEvents} events pending`);
    }
    
    if (activeSessionsCount > 0) {
        console.log(`📈 Active sessions: ${activeSessionsCount}, Queue size: ${totalEvents}, Clients: ${connectedClients.size}`);
    }
}, 30000);

// Server startup
const PORT =  3000;


server.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 Low Latency Remote Desktop Relay Server');
    console.log('='.repeat(60));
    console.log(`🔗 Server running on: http://${HOST}:${PORT}`);
    console.log(`🏥 Health check: http://${HOST}:${PORT}/health`);
    console.log(`📊 API endpoint: http://${HOST}:${PORT}/api/sessions`);
    console.log(`🌍 Platform: ${os.platform()} ${os.arch()}`);
    console.log(`💾 Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
    console.log('='.repeat(60));
    console.log(`⚡ Optimizations Enabled:`);
    console.log(`   ✅ Binary frame transmission`);
    console.log(`   ✅ Input event prioritization`);
    console.log(`   ✅ Adaptive FPS control`);
    console.log(`   ✅ WebSocket-only transport`);
    console.log(`   ✅ Compression disabled for speed`);
    console.log(`   ✅ Priority-based event queue`);
    console.log('='.repeat(60));
    console.log(`📝 Connection Only - No Screen Capture:`);
    console.log(`   • Screen capture moved to Electron frontend`);
    console.log(`   • Server acts as optimized relay only`);
    console.log(`   • FFmpeg integration on client side`);
    console.log(`   • Cross-platform input via RobotJS/Nut.js`);
    console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down relay server...');
    
    // End all sessions with performance summary
    sessions.forEach((session, sessionId) => {
        if (session.performanceMonitor) {
            const stats = session.performanceMonitor.getStats();
            console.log(`📊 Session ${sessionId}: ${stats.eventsProcessed} events, ${stats.mbTransferred.toFixed(2)}MB`);
        }
        endSession(sessionId);
    });
    
    server.close(() => {
        console.log('✅ Relay server closed gracefully');
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
        endSession(sessionId);
    });
    
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Enhanced error handling
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Memory usage monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.rss / 1024 / 1024);
    
    if (memMB > 500) {
        console.log(`⚠️ High memory usage: ${memMB}MB RSS, ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB heap`);
    }
}, 30000);

