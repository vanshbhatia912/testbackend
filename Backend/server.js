const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

// Cross-platform screen capture and control with Nut.js
let screenshot, mouse, keyboard, screen, Point, Region, Button;

try {
    // Import @nut-tree-fork/nut-js components
    const nut = require('@nut-tree-fork/nut-js');
    mouse = nut.mouse;
    keyboard = nut.keyboard;
    screen = nut.screen;
    Point = nut.Point;
    Region = nut.Region;
    Button = nut.Button;
    
    // Configure for low latency
    screen.config.autoDelayMs = 0;
    screen.config.highlightDurationMs = 0;
    screen.config.highlightOpacity = 0;
    mouse.config.autoDelayMs = 0;
    mouse.config.mouseSpeed = 0; // Instant movement
    keyboard.config.autoDelayMs = 0;
    
    console.log('✅ Nut.js library loaded and configured for low latency');
} catch (error) {
    console.warn('⚠️ Nut.js library not available:', error.message);
}

// Try screenshot-desktop with better options
try {
    screenshot = require('screenshot-desktop');
    console.log('✅ Screenshot library loaded');
} catch (error) {
    console.warn('⚠️ Screenshot library not available:', error.message);
}

const app = express();
const server = http.createServer(app);

// Optimized Socket.IO configuration for low latency
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    transports: ['websocket'], // Prefer WebSocket for lower latency
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,
    maxHttpBufferSize: 10e6, // 10MB for large screen data
    compression: false, // Disable compression for lower latency
    perMessageDeflate: false
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

// Store active sessions with performance tracking
const sessions = new Map();
const connectedClients = new Map();

// Optimized quality settings for low latency
const QUALITY_SETTINGS = {
    low: { fps: 15, quality: 60, interval: 67, compression: 'fast' },
    medium: { fps: 24, quality: 70, interval: 42, compression: 'medium' },
    high: { fps: 30, quality: 80, interval: 33, compression: 'medium' },
    ultra: { fps: 60, quality: 90, interval: 17, compression: 'high' }
};

// Screen capture optimization
const CAPTURE_OPTIONS = {
    format: 'jpg', // JPEG for better compression/speed ratio
    quality: 80,
    filename: null
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

// Performance monitoring utilities
class PerformanceMonitor {
    constructor() {
        this.metrics = {
            captureTime: 0,
            encodeTime: 0,
            transmitTime: 0,
            totalLatency: 0,
            frameCount: 0,
            bytesTransferred: 0
        };
        this.startTime = performance.now();
    }

    recordCapture(duration) {
        this.metrics.captureTime = duration;
    }

    recordEncode(duration) {
        this.metrics.encodeTime = duration;
    }

    recordTransmit(duration, bytes) {
        this.metrics.transmitTime = duration;
        this.metrics.bytesTransferred += bytes;
        this.metrics.frameCount++;
    }

    getTotalLatency() {
        return this.metrics.captureTime + this.metrics.encodeTime + this.metrics.transmitTime;
    }

    getStats() {
        const runtime = (performance.now() - this.startTime) / 1000;
        return {
            ...this.metrics,
            totalLatency: this.getTotalLatency(),
            avgFps: runtime > 0 ? this.metrics.frameCount / runtime : 0,
            avgBandwidth: runtime > 0 ? this.metrics.bytesTransferred / runtime : 0,
            runtime: Math.round(runtime)
        };
    }
}

// Routes with enhanced performance monitoring
app.get('/', (req, res) => {
    res.json({
        name: 'Remote Desktop Server - Low Latency Edition',
        version: '2.0.0',
        platform: os.platform(),
        arch: os.arch(),
        status: 'running',
        sessions: sessions.size,
        clients: connectedClients.size,
        optimizations: {
            nutJs: !!mouse,
            screenshot: !!screenshot,
            webSocketOnly: true,
            compressionDisabled: true
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
        performance: session.performanceMonitor ? session.performanceMonitor.getStats() : null
    }));
    
    res.json(sessionList);
});

app.post('/api/sessions', (req, res) => {
    const { quality = 'medium', platform = 'unknown' } = req.body;
    
    const sessionId = generateSessionId();
    const password = generatePassword();
    
    const session = {
        id: sessionId,
        password,
        createdAt: new Date(),
        isActive: false,
        hostSocket: null,
        controllers: [],
        quality,
        platform,
        captureInterval: null,
        performanceMonitor: new PerformanceMonitor(),
        lastFrameTime: 0,
        frameBuffer: null,
        deltaCompression: true,
        lastScreenData: null
    };
    
    sessions.set(sessionId, session);
    
    console.log(`🎯 Session created: ${sessionId} (${platform}, ${quality})`);
    
    res.json({
        success: true,
        sessionId,
        password,
        quality,
        platform
    });
});

app.delete('/api/sessions/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    endSession(sessionId);
    res.json({ success: true, message: 'Session ended' });
});

// Socket.IO connection handling with optimized event processing
io.on('connection', (socket) => {
    const clientInfo = {
        id: socket.id,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        connectedAt: new Date(),
        latency: 0
    };
    
    connectedClients.set(socket.id, clientInfo);
    
    console.log(`🔗 Client connected: ${socket.id} from ${clientInfo.ip}`);
    console.log(`📊 Total clients: ${connectedClients.size}, Active sessions: ${sessions.size}`);

    // Latency measurement
    socket.on('ping', (timestamp) => {
        const latency = Date.now() - timestamp;
        clientInfo.latency = latency;
        socket.emit('pong', { timestamp, latency });
    });

    // Create session
    socket.on('create-session', (data) => {
        const { quality = 'medium', platform = 'unknown' } = data;
        
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
            captureInterval: null,
            performanceMonitor: new PerformanceMonitor(),
            lastFrameTime: 0,
            frameBuffer: null,
            deltaCompression: true,
            lastScreenData: null
        };
        
        sessions.set(sessionId, session);
        socket.join(`session-${sessionId}`);
        
        socket.emit('session-created', {
            success: true,
            sessionId,
            password,
            quality,
            platform
        });
        
        console.log(`🎯 Session created: ${sessionId} by ${socket.id}`);
    });

    // Start hosting with optimized capture
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
        session.performanceMonitor = new PerformanceMonitor();
        
        socket.emit('host-connected', { success: true });
        
        // Start optimized screen capture
        startOptimizedScreenCapture(sessionId);
        
        console.log(`🖥️ Host started: ${sessionId}`);
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

    // Optimized mouse events with Nut.js
    socket.on('mouse-event', async (data) => {
        const { sessionId, type, x, y, button, deltaX, deltaY, sensitivity = 1 } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.controllers.some(c => c.socketId === socket.id)) return;
        
        if (!mouse) {
            console.warn('⚠️ Nut.js mouse not available');
            return;
        }
        
        try {
            const startTime = performance.now();
            
            switch (type) {
                case 'mousemove':
                    const adjustedX = Math.round(x * sensitivity);
                    const adjustedY = Math.round(y * sensitivity);
                    
                    await mouse.setPosition(new Point(adjustedX, adjustedY));
                    
                    // Broadcast to other controllers
                    socket.to(`session-${sessionId}`).emit('mouse-position', { 
                        x: adjustedX, 
                        y: adjustedY 
                    });
                    break;
                    
                case 'mousedown':
                    await mouse.setPosition(new Point(Math.round(x * sensitivity), Math.round(y * sensitivity)));
                    const downBtn = button === 0 ? Button.LEFT : button === 2 ? Button.RIGHT : Button.MIDDLE;
                    await mouse.pressButton(downBtn);
                    break;
                    
                case 'mouseup':
                    const upBtn = button === 0 ? Button.LEFT : button === 2 ? Button.RIGHT : Button.MIDDLE;
                    await mouse.releaseButton(upBtn);
                    break;
                    
                case 'wheel':
                    // Nut.js scroll implementation
                    const scrollAmount = Math.abs(deltaY || deltaX || 1);
                    const direction = (deltaY || deltaX) > 0 ? 'down' : 'up';
                    
                    for (let i = 0; i < scrollAmount; i++) {
                        if (direction === 'up') {
                            await mouse.scrollUp(1);
                        } else {
                            await mouse.scrollDown(1);
                        }
                    }
                    break;
            }
            
            // Track mouse event latency
            const processingTime = performance.now() - startTime;
            if (processingTime > 5) { // Log if > 5ms
                console.log(`🖱️ Mouse event took ${processingTime.toFixed(2)}ms`);
            }
            
        } catch (error) {
            console.error('❌ Mouse event error:', error.message);
        }
    });

    // Optimized keyboard events with Nut.js
    socket.on('keyboard-event', async (data) => {
        const { sessionId, type, key, code, ctrlKey, altKey, shiftKey, metaKey } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.controllers.some(c => c.socketId === socket.id && c.mode === 'control')) return;
        
        if (!keyboard) {
            console.warn('⚠️ Nut.js keyboard not available');
            return;
        }
        
        try {
            const startTime = performance.now();
            
            // Map keys to Nut.js format
            const { Key } = require('@nut-tree-fork/nut-js');
            
            let nutKey = key;
            
            // Map special keys
            const keyMap = {
                'ArrowUp': Key.Up,
                'ArrowDown': Key.Down,
                'ArrowLeft': Key.Left,
                'ArrowRight': Key.Right,
                'Enter': Key.Return,
                'Escape': Key.Escape,
                'Backspace': Key.Backspace,
                'Delete': Key.Delete,
                'Tab': Key.Tab,
                'CapsLock': Key.CapsLock,
                ' ': Key.Space,
                'Control': Key.LeftControl,
                'Alt': Key.LeftAlt,
                'Shift': Key.LeftShift,
                'Meta': Key.LeftSuper
            };
            
            if (keyMap[key]) {
                nutKey = keyMap[key];
            } else if (key.length === 1) {
                // Single character key
                nutKey = key.toLowerCase();
            }
            
            // Handle modifier combinations
            const modifiers = [];
            if (ctrlKey) modifiers.push(Key.LeftControl);
            if (altKey) modifiers.push(Key.LeftAlt);
            if (shiftKey) modifiers.push(Key.LeftShift);
            if (metaKey) modifiers.push(Key.LeftSuper);
            
            switch (type) {
                case 'keydown':
                    if (modifiers.length > 0 && typeof nutKey === 'string') {
                        // Key combination
                        await keyboard.pressKey(...modifiers, nutKey);
                        await keyboard.releaseKey(...modifiers, nutKey);
                    } else if (typeof nutKey === 'string') {
                        await keyboard.pressKey(nutKey);
                    } else {
                        await keyboard.pressKey(nutKey);
                    }
                    break;
                    
                case 'keyup':
                    if (typeof nutKey === 'string') {
                        await keyboard.releaseKey(nutKey);
                    } else {
                        await keyboard.releaseKey(nutKey);
                    }
                    break;
            }
            
            // Track keyboard event latency
            const processingTime = performance.now() - startTime;
            if (processingTime > 10) { // Log if > 10ms
                console.log(`⌨️ Keyboard event took ${processingTime.toFixed(2)}ms`);
            }
            
        } catch (error) {
            console.error('❌ Keyboard event error:', error.message);
        }
    });

    // Optimized key combination handler
    socket.on('key-combination', async (data) => {
        const { sessionId, keys } = data;
        const session = sessions.get(sessionId);
        
        if (!session || !session.controllers.some(c => c.socketId === socket.id && c.mode === 'control')) return;
        
        if (!keyboard) {
            console.warn('⚠️ Nut.js keyboard not available');
            return;
        }
        
        try {
            const { Key } = require('@nut-tree-fork/nut-js');
            const startTime = performance.now();
            
            // Map key combination
            const nutKeys = keys.map(key => {
                switch (key.toLowerCase()) {
                    case 'ctrl': return Key.LeftControl;
                    case 'control': return Key.LeftControl;
                    case 'alt': return Key.LeftAlt;
                    case 'shift': return Key.LeftShift;
                    case 'meta': return Key.LeftSuper;
                    case 'cmd': return Key.LeftSuper;
                    case 'super': return Key.LeftSuper;
                    case 'tab': return Key.Tab;
                    case 'enter': return Key.Return;
                    case 'escape': return Key.Escape;
                    case 'space': return Key.Space;
                    default: return key.toLowerCase();
                }
            });
            
            // Press all keys together
            await keyboard.pressKey(...nutKeys);
            await keyboard.releaseKey(...nutKeys);
            
            const processingTime = performance.now() - startTime;
            console.log(`⌨️ Key combo ${keys.join('+')} took ${processingTime.toFixed(2)}ms`);
            
        } catch (error) {
            console.error('❌ Key combination error:', error.message);
        }
    });

    // Change quality with immediate effect
    socket.on('change-quality', (data) => {
        const { sessionId, quality } = data;
        const session = sessions.get(sessionId);
        
        if (!session || session.hostSocket !== socket.id) return;
        
        session.quality = quality;
        
        // Restart screen capture with new quality
        if (session.captureInterval) {
            clearInterval(session.captureInterval);
            startOptimizedScreenCapture(sessionId);
        }
        
        console.log(`📊 Quality changed: ${sessionId} -> ${quality}`);
    });

    // End session
    socket.on('end-session', (data) => {
        const { sessionId } = data;
        endSession(sessionId, socket.id);
    });

    // Disconnect from session
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

// Optimized screen capture with delta compression and adaptive quality
function startOptimizedScreenCapture(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || !session.isActive) return;
    
    if (!screenshot) {
        console.warn('⚠️ Screenshot library not available');
        return;
    }
    
    const qualitySettings = QUALITY_SETTINGS[session.quality] || QUALITY_SETTINGS.medium;
    
    console.log(`📸 Starting optimized screen capture: ${sessionId} (${session.quality}, ${qualitySettings.fps}fps)`);
    
    // Use setImmediate for better performance than setInterval
    const captureFrame = async () => {
        const currentSession = sessions.get(sessionId);
        if (!currentSession || !currentSession.isActive) return;
        
        const frameStartTime = performance.now();
        
        try {
            // Capture screen with optimized settings
            const captureStart = performance.now();
            
            const img = await screenshot({ 
                format: 'jpg',
                quality: qualitySettings.quality
            });
            
            if (!img) return;
            
            const captureTime = performance.now() - captureStart;
            currentSession.performanceMonitor.recordCapture(captureTime);
            
            // Convert to base64 (consider binary transmission in future)
            const encodeStart = performance.now();
            const base64Image = img.toString('base64');
            const imageData = `data:image/jpeg;base64,${base64Image}`;
            const encodeTime = performance.now() - encodeStart;
            currentSession.performanceMonitor.recordEncode(encodeTime);
            
            // Get screen dimensions
            let screenSize = { width: 1920, height: 1080 };
            
            if (screen) {
                try {
                    screenSize = await screen.size();
                } catch (e) {
                    // Use fallback
                }
            }
            
            const screenData = {
                image: imageData,
                width: screenSize.width,
                height: screenSize.height,
                timestamp: Date.now(),
                quality: currentSession.quality,
                frameNumber: currentSession.performanceMonitor.metrics.frameCount,
                captureTime: Math.round(captureTime),
                encodeTime: Math.round(encodeTime),
                compression: qualitySettings.compression
            };
            
            // Send to all controllers
            const transmitStart = performance.now();
            io.to(`session-${sessionId}`).emit('screen-update', screenData);
            const transmitTime = performance.now() - transmitStart;
            
            currentSession.performanceMonitor.recordTransmit(transmitTime, base64Image.length);
            
            // Send performance stats every 30 frames
            if (currentSession.performanceMonitor.metrics.frameCount % 30 === 0) {
                const stats = currentSession.performanceMonitor.getStats();
                io.to(`session-${sessionId}`).emit('performance-stats', {
                    ...stats,
                    frameLatency: performance.now() - frameStartTime
                });
                
                // Log performance metrics
                console.log(`📊 ${sessionId}: ${stats.totalLatency.toFixed(1)}ms total, ${stats.avgFps.toFixed(1)} fps`);
            }
            
        } catch (error) {
            console.error(`❌ Screen capture error for ${sessionId}:`, error.message);
        }
        
        // Schedule next frame with adaptive timing
        const frameTime = performance.now() - frameStartTime;
        const targetInterval = qualitySettings.interval;
        const nextFrameDelay = Math.max(0, targetInterval - frameTime);
        
        setTimeout(() => {
            if (sessions.get(sessionId)?.isActive) {
                setImmediate(captureFrame);
            }
        }, nextFrameDelay);
    };
    
    // Start the capture loop
    setImmediate(captureFrame);
}

// End session function
function endSession(sessionId, requesterId = null) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    // Stop screen capture
    if (session.captureInterval) {
        clearInterval(session.captureInterval);
    }
    
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
        console.log(`📊 Final stats: ${finalStats.totalLatency.toFixed(1)}ms avg latency, ${finalStats.avgFps.toFixed(1)} fps`);
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

// Server startup
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log('='.repeat(60));
    console.log('🚀 Low Latency Remote Desktop Server Started');
    console.log('='.repeat(60));
    console.log(`🔡 Server running on: http://${HOST}:${PORT}`);
    console.log(`🏥 Health check: http://${HOST}:${PORT}/health`);
    console.log(`📊 API endpoint: http://${HOST}:${PORT}/api/sessions`);
    console.log(`🌍 Platform: ${os.platform()} ${os.arch()}`);
    console.log(`💾 Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
    console.log(`🖥️ Screenshot support: ${screenshot ? '✅' : '❌'}`);
    console.log(`🎮 Nut.js control support: ${mouse ? '✅' : '❌'}`);
    console.log('='.repeat(60));
    console.log(`💡 Optimizations Enabled:`);
    console.log(`   - WebSocket-only transport for lower latency`);
    console.log(`   - Compression disabled for speed`);
    console.log(`   - Nut.js with zero-delay configuration`);
    console.log(`   - Adaptive frame timing`);
    console.log(`   - Performance monitoring`);
    console.log(`   - JPEG compression for better speed/quality ratio`);
    console.log(`   - Delta frame compression ready`);
    console.log('='.repeat(60));
    console.log(`📝 Installation Notes:`);
    console.log(`   npm install @nut-tree-fork/nut-js screenshot-desktop`);
    console.log(`   - @nut-tree-fork/nut-js: Modern cross-platform automation`);
    console.log(`   - Configured for zero-delay, instant response`);
    console.log(`   - Press Ctrl+C to stop the server`);
    console.log('='.repeat(60));
});

// Graceful shutdown with cleanup
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    
    // End all sessions with performance summary
    sessions.forEach((session, sessionId) => {
        if (session.performanceMonitor) {
            const stats = session.performanceMonitor.getStats();
            console.log(`📊 Session ${sessionId} final stats: ${stats.totalLatency.toFixed(1)}ms latency, ${stats.avgFps.toFixed(1)} fps`);
        }
        endSession(sessionId);
    });
    
    // Close server
    server.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
    
    // Force exit after 10 seconds
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

// Handle unhandled errors
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
    
    if (memMB > 500) { // Alert if using more than 500MB
        console.log(`⚠️ High memory usage: ${memMB}MB RSS, ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB heap`);
    }
}, 30000); // Check every 30 seconds