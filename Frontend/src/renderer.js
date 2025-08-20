// Enhanced Low Latency Remote Desktop Client with Binary Frames and Adaptive FPS
class OptimizedRemoteDesktopApp {
    constructor() {
        this.socket = null;
        this.currentSessionId = null;
        this.currentPassword = null;
        this.isHost = false;
        this.isController = false;
        this.canvas = null;
        this.ctx = null;
        this.settings = {};

        // Enhanced performance tracking
        this.performance = {
            latency: 0,
            frameRate: 0,
            bandwidth: 0,
            startTime: null,
            frameCount: 0,
            lastFrameTime: 0,
            networkLatency: 0,
            renderLatency: 0,
            inputLatency: 0,
            // Binary frame metrics
            binaryFramesReceived: 0,
            avgFrameSize: 0,
            compressionRatio: 0
        };

        // Adaptive FPS control
        this.adaptiveFPS = {
            enabled: true,
            currentFPS: 30,
            targetFPS: 30,
            baseFPS: 30,
            minFPS: 8,
            maxFPS: 60,
            latencyThreshold: 100,
            lastAdjustment: 0,
            adjustmentCooldown: 2000 // 2 seconds between adjustments
        };

        // Binary frame processing
        this.binaryFrames = {
            enabled: true,
            decoder: null,
            frameBuffer: new ArrayBuffer(0),
            processingFrame: false,
            lastFrameTimestamp: 0
        };

        // Enhanced input handling with prioritization
        this.inputHandler = {
            mousePosition: { x: 0, y: 0 },
            remoteMousePosition: { x: 0, y: 0 },
            mouseMoveBuffer: [],
            keyStates: new Map(),
            lastMouseSend: 0,
            lastKeySend: 0,
            mouseThrottle: 8, // 8ms = 125fps max
            keyThrottle: 5,   // 5ms = 200fps max
            priorityQueue: {
                keyboard: [],
                mouseClick: [],
                mouseMove: [],
                scroll: []
            }
        };

        // Display optimization
        this.display = {
            scale: 1,
            adaptiveQuality: true,
            targetLatency: 50,
            lastResolution: { width: 0, height: 0 },
            canvasImageData: null
        };

        this.init();
    }

    async init() {
        console.log('🚀 Initializing Enhanced Remote Desktop with Binary Frames...');

        try {
            await this.loadPlatformInfo();
            await this.loadSettings();
            await this.checkFFmpegAvailability();
            this.setupEventListeners();
            this.setupMenuHandlers();
            this.initializeUI();
            this.startPerformanceMonitoring();
            this.setupInputPriorityQueue();

            console.log('✅ Application initialized with binary frame support');

        } catch (error) {
            console.error('❌ Failed to initialize application:', error);
            this.showNotification('Failed to initialize application', 'error');
        }
    }

    async checkFFmpegAvailability() {
        try {
            const ffmpegInfo = await window.electronAPI.checkFFmpegAvailability();
            
            if (ffmpegInfo.available) {
                console.log('✅ FFmpeg available:', ffmpegInfo.version);
                this.showNotification(`FFmpeg ready: ${ffmpegInfo.version}`, 'success');
            } else {
                console.warn('⚠️ FFmpeg not available:', ffmpegInfo.error);
                this.showNotification('FFmpeg not found - screen capture may be limited', 'warning');
            }
            
            return ffmpegInfo;
        } catch (error) {
            console.error('❌ FFmpeg check failed:', error);
            return { available: false, error: error.message };
        }
    }

    setupInputPriorityQueue() {
        // Process input events in priority order every 5ms
        setInterval(() => {
            this.processInputQueue();
        }, 5);
    }

    processInputQueue() {
        if (!this.isController || !this.socket?.connected) return;

        const queue = this.inputHandler.priorityQueue;
        
        // Process in priority order: keyboard > mouseClick > mouseMove > scroll
        const priorities = ['keyboard', 'mouseClick', 'mouseMove', 'scroll'];
        
        for (const priority of priorities) {
            while (queue[priority].length > 0) {
                const event = queue[priority].shift();
                this.sendInputEvent(event);
                
                // Limit processing per cycle to prevent blocking
                if (performance.now() - event.timestamp > 50) break;
            }
        }
    }

    sendInputEvent(event) {
        if (!this.socket?.connected) return;
        
        const now = performance.now();
        this.socket.emit(event.type, event.data);
        
        // Track input latency
        this.performance.inputLatency = now - event.timestamp;
        
        // Update throttling stats
        this.inputHandler[`last${event.type === 'mouse-event' ? 'Mouse' : 'Key'}Send`] = now;
    }

    // Socket connection and events
    async connectToServer(serverUrl) {
        if (!serverUrl) {
            serverUrl = 'https://testbackend-hbo4.onrender.com';
        }

        try {
            console.log('🔗 Connecting to server:', serverUrl);
            this.updateStatus('connecting', 'Connecting...');

            if (this.socket) {
                this.socket.disconnect();
            }

            this.socket = io(serverUrl, {
                transports: ['websocket'],
                timeout: this.settings.connectionTimeout * 1000,
                forceNew: true
            });

            this.setupOptimizedSocketEvents();

            return new Promise((resolve, reject) => {
                this.socket.on('connect', () => {
                    resolve(true);
                });

                this.socket.on('connect_error', (error) => {
                    reject(error);
                });

                // Timeout handling
                setTimeout(() => {
                    if (!this.socket?.connected) {
                        reject(new Error('Connection timeout'));
                    }
                }, this.settings.connectionTimeout * 1000);
            });

        } catch (error) {
            console.error('❌ Connection failed:', error);
            this.updateStatus('offline', 'Connection failed');
            throw error;
        }
    }

    // Enhanced socket setup with binary frame support
    setupOptimizedSocketEvents() {
        if (!this.socket) return;

        // Connection events
        this.socket.on('connect', () => {
            console.log('✅ Connected to relay server');
            this.updateStatus('online', 'Connected - Binary frames ready');
            this.showNotification('Connected with binary frame support', 'success');
            this.startLatencyMonitoring();
        });

        this.socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected from server:', reason);
            this.updateStatus('offline', 'Disconnected');
            this.showNotification('Disconnected from server', 'warning');
            this.stopLatencyMonitoring();
            
            if (this.isHost) {
                this.stopHostScreenCapture();
            }
        });

        // Enhanced latency monitoring with adaptive FPS
        this.socket.on('pong', (data) => {
            this.performance.networkLatency = data.latency;
            this.updateNetworkLatencyDisplay();
            this.adjustAdaptiveFPS(data.latency);
        });

        // Binary frame reception (prioritized)
        this.socket.on('screen-frame-binary', (data) => {
            this.handleBinaryScreenUpdate(data);
        });

        // Fallback base64 frame reception
        this.socket.on('screen-update', (data) => {
            console.log('📺 Received fallback base64 frame');
            this.handleOptimizedScreenUpdate(data);
        });

        // Adaptive FPS notifications
        this.socket.on('adaptive-fps-change', (data) => {
            console.log(`🎛️ Server adaptive FPS change: ${data.fps} (${data.reason})`);
            this.adaptiveFPS.currentFPS = data.fps;
            this.updateFPSDisplay();
        });

        this.socket.on('fps-changed', (data) => {
            this.adaptiveFPS.currentFPS = data.fps;
            this.updateFPSDisplay();
        });

        // Quality change with immediate FPS update
        this.socket.on('quality-changed', (data) => {
            console.log('📊 Quality changed:', data);
            this.settings.quality = data.quality;
            this.adaptiveFPS.currentFPS = data.currentFPS || this.adaptiveFPS.currentFPS;
            
            const currentQualityEl = document.getElementById('currentQuality');
            if (currentQualityEl) {
                const qualityOptions = window.constants.QUALITY_OPTIONS;
                const option = qualityOptions.find(opt => opt.value === data.quality);
                currentQualityEl.textContent = option ? option.label : data.quality;
            }
            
            this.showNotification(`Quality: ${data.quality} (${this.adaptiveFPS.currentFPS} FPS)`, 'info');
            
            if (this.isHost) {
                this.restartScreenCaptureWithNewSettings();
            }
        });

        // Session events with enhanced info
        this.socket.on('session-created', (data) => {
            if (data.binaryFrames) {
                console.log('✅ Binary frame support enabled');
            }
            this.handleSessionCreated(data);
        });

        this.socket.on('host-connected', (data) => this.handleHostConnected(data));
        this.socket.on('controller-connected', (data) => this.handleControllerConnected(data));
        this.socket.on('controller-joined', (data) => this.handleControllerJoined(data));

        // Input event relays for host
        this.socket.on('remote-mouse-event', async (data) => {
            if (!this.isHost) return;
            
            try {
                const { type, x, y, button, deltaX, deltaY, sensitivity } = data;
                
                switch (type) {
                    case 'mousemove':
                        await window.electronAPI.simulateMouseMove(x, y, sensitivity);
                        break;
                    case 'mousedown':
                    case 'mouseup':
                        await window.electronAPI.simulateMouseClick(x, y, button, type);
                        break;
                    case 'wheel':
                        await window.electronAPI.simulateMouseWheel(deltaY, deltaX);
                        break;
                }
            } catch (error) {
                console.error('❌ Mouse simulation error:', error);
            }
        });

        this.socket.on('remote-keyboard-event', async (data) => {
            if (!this.isHost) return;
            
            try {
                await window.electronAPI.simulateKeyPress(data);
            } catch (error) {
                console.error('❌ Keyboard simulation error:', error);
            }
        });

        this.socket.on('remote-key-combination', async (data) => {
            if (!this.isHost) return;
            
            try {
                await window.electronAPI.simulateKeyCombo(data.keys);
            } catch (error) {
                console.error('❌ Key combination error:', error);
            }
        });

        // Performance stats relay
        this.socket.on('relay-performance-stats', (data) => {
            this.updateServerPerformanceStats(data);
        });

        this.socket.on('session-ended', () => this.handleSessionEnded());
        this.socket.on('user-disconnected', (data) => this.handleUserDisconnected(data));
    }

    // Binary frame processing
    handleBinaryScreenUpdate(data) {
        if (!this.canvas || !this.ctx) return;

        const renderStart = performance.now();
        const { frameBuffer, metadata } = data;

        try {
            // Convert ArrayBuffer to Blob for image processing
            const blob = new Blob([frameBuffer], { type: 'image/jpeg' });
            const imageUrl = URL.createObjectURL(blob);
            
            const img = new Image();
            img.onload = () => {
                // Resize canvas if needed
                if (this.canvas.width !== metadata.width || this.canvas.height !== metadata.height) {
                    this.canvas.width = metadata.width;
                    this.canvas.height = metadata.height;
                    this.adjustCanvasScale();
                }

                // Hardware-accelerated rendering
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(img, 0, 0);

                // Cleanup
                URL.revokeObjectURL(imageUrl);

                // Update performance metrics
                const renderTime = performance.now() - renderStart;
                this.performance.renderLatency = renderTime;
                this.performance.binaryFramesReceived++;
                this.performance.avgFrameSize = (this.performance.avgFrameSize + frameBuffer.byteLength) / 2;
                
                this.updateFrameRate();
                this.updatePerformanceDisplay(metadata);
                this.hideConnectionOverlay();

                // Adaptive quality adjustment
                if (this.display.adaptiveQuality) {
                    this.adjustQualityBasedOnPerformance();
                }
            };

            img.onerror = (error) => {
                console.error('❌ Binary frame decode error:', error);
                URL.revokeObjectURL(imageUrl);
            };

            img.src = imageUrl;

        } catch (error) {
            console.error('❌ Binary frame processing error:', error);
        }
    }

    // Fallback for base64 frames
    handleOptimizedScreenUpdate(data) {
        if (!this.canvas || !this.ctx) return;

        const renderStart = performance.now();

        try {
            const img = new Image();
            img.onload = () => {
                // Resize canvas if needed
                if (this.canvas.width !== data.width || this.canvas.height !== data.height) {
                    this.canvas.width = data.width;
                    this.canvas.height = data.height;
                    this.adjustCanvasScale();
                }

                // Clear and draw
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(img, 0, 0);

                // Update performance metrics
                const renderTime = performance.now() - renderStart;
                this.performance.renderLatency = renderTime;
                
                this.updateFrameRate();
                this.updatePerformanceDisplay(data);
                this.hideConnectionOverlay();

                // Adaptive quality adjustment
                if (this.display.adaptiveQuality) {
                    this.adjustQualityBasedOnPerformance();
                }
            };

            img.onerror = (error) => {
                console.error('❌ Frame decode error:', error);
            };

            img.src = data.image;

        } catch (error) {
            console.error('❌ Screen update error:', error);
        }
    }

    // Adaptive FPS control
    adjustAdaptiveFPS(currentLatency) {
        if (!this.adaptiveFPS.enabled) return;

        const now = performance.now();
        if (now - this.adaptiveFPS.lastAdjustment < this.adaptiveFPS.adjustmentCooldown) return;

        const threshold = this.adaptiveFPS.latencyThreshold;
        let newFPS = this.adaptiveFPS.currentFPS;

        if (currentLatency > threshold * 1.5) {
            // High latency: reduce FPS
            newFPS = Math.max(this.adaptiveFPS.minFPS, Math.round(this.adaptiveFPS.currentFPS * 0.8));
        } else if (currentLatency < threshold * 0.6) {
            // Low latency: increase FPS
            newFPS = Math.min(this.adaptiveFPS.maxFPS, Math.round(this.adaptiveFPS.currentFPS * 1.2));
        }

        if (Math.abs(newFPS - this.adaptiveFPS.currentFPS) >= 2) {
            this.adaptiveFPS.currentFPS = newFPS;
            this.adaptiveFPS.lastAdjustment = now;
            
            // Notify server of FPS change
            if (this.socket?.connected && this.currentSessionId) {
                this.socket.emit('fps-adjustment', {
                    sessionId: this.currentSessionId,
                    fps: newFPS
                });
            }

            console.log(`🎛️ Adaptive FPS: ${newFPS} (latency: ${currentLatency}ms)`);
            this.updateFPSDisplay();
        }
    }

    // Enhanced screen capture start with FFmpeg
    async startHostScreenCapture() {
        if (!this.isHost || !this.socket?.connected || !this.currentSessionId) {
            console.log('❌ Cannot start screen capture: missing requirements');
            return;
        }

        console.log('🎥 Starting FFmpeg screen capture...');

        const qualitySettings = this.getQualitySettings();
        
        try {
            const result = await window.electronAPI.startScreenCapture({
                fps: this.adaptiveFPS.currentFPS,
                quality: qualitySettings.quality,
                preset: qualitySettings.ffmpegPreset,
                bitrate: qualitySettings.bitrate,
                useGPU: this.settings.useGPUEncoding
            });

            if (result.success) {
                console.log('✅ FFmpeg screen capture started');
                this.showNotification('Screen capture active with FFmpeg', 'success');
                this.setupScreenCaptureHandlers();
            } else {
                throw new Error(result.error);
            }

        } catch (error) {
            console.error('❌ Failed to start screen capture:', error);
            this.showNotification('Screen capture failed: ' + error.message, 'error');
        }
    }

    setupScreenCaptureHandlers() {
        // Listen for FFmpeg frames
        window.electronAPI.onScreenFrame((frameData) => {
            if (!this.isHost || !this.socket?.connected || !this.currentSessionId) return;

            try {
                // Send binary frame if supported
                if (this.binaryFrames.enabled) {
                    // Convert base64 to ArrayBuffer for binary transmission
                    const base64Data = frameData.image.split(',')[1];
                    const binaryData = window.utils.base64ToArrayBuffer(base64Data);
                    
                    this.socket.emit('screen-frame-binary', {
                        sessionId: this.currentSessionId,
                        frameBuffer: binaryData,
                        metadata: {
                            width: frameData.width,
                            height: frameData.height,
                            timestamp: frameData.timestamp,
                            frameNumber: frameData.frameNumber,
                            format: frameData.format || 'jpeg'
                        }
                    });
                } else {
                    // Fallback to base64
                    this.socket.emit('screen-frame-data', {
                        sessionId: this.currentSessionId,
                        ...frameData
                    });
                }

            } catch (error) {
                console.error('❌ Frame transmission error:', error);
            }
        });

        // Performance stats from FFmpeg
        window.electronAPI.onPerformanceStats((stats) => {
            if (this.socket?.connected && this.currentSessionId) {
                this.socket.emit('client-performance-stats', {
                    sessionId: this.currentSessionId,
                    ...stats,
                    type: 'host',
                    adaptiveFPS: this.adaptiveFPS.currentFPS
                });
            }
        });
    }

    async stopHostScreenCapture() {
        console.log('🛑 Stopping FFmpeg screen capture');
        
        try {
            const result = await window.electronAPI.stopScreenCapture();
            console.log('📊 Screen capture stopped:', result);
        } catch (error) {
            console.error('❌ Error stopping screen capture:', error);
        }

        // Remove listeners
        window.electronAPI.removeAllListeners('screen-frame-data');
        window.electronAPI.removeAllListeners('capture-performance-stats');
    }

    restartScreenCaptureWithNewSettings() {
        if (!this.isHost) return;
        
        this.stopHostScreenCapture();
        setTimeout(() => {
            this.startHostScreenCapture();
        }, 500);
    }

    // Session Management
    async createSession() {
        if (!this.socket?.connected) {
            this.showNotification('Not connected to server', 'error');
            return;
        }

        const platformInfo = await window.electronAPI.getPlatform();
        
        this.socket.emit('create-session', {
            quality: this.settings.quality,
            platform: `${platformInfo.platform}-${platformInfo.arch}`,
            clientCapabilities: {
                binaryFrames: this.binaryFrames.enabled,
                adaptiveFPS: this.adaptiveFPS.enabled,
                inputPrioritization: true
            }
        });
    }

    async joinSession(sessionId, password, mode = 'control') {
        if (!this.socket?.connected) {
            this.showNotification('Not connected to server', 'error');
            return;
        }

        const platformInfo = await window.electronAPI.getPlatform();

        this.socket.emit('join-session', {
            sessionId,
            password,
            mode,
            platform: `${platformInfo.platform}-${platformInfo.arch}`
        });
    }

    // Event handlers for session events
    handleSessionCreated(data) {
        if (data.success) {
            this.currentSessionId = data.sessionId;
            this.currentPassword = data.password;
            this.isHost = true;

            // Update UI
            document.getElementById('sessionId').textContent = data.sessionId;
            document.getElementById('sessionPassword').textContent = data.password;
            
            // Show step 2
            this.showCreationStep(2);
            
            this.showNotification(`Session created: ${data.sessionId}`, 'success');
        } else {
            this.showNotification('Failed to create session', 'error');
        }
    }

    handleHostConnected(data) {
        if (data.success) {
            this.showCreationStep(3);
            document.getElementById('activeSessionId').textContent = this.currentSessionId;
            this.startHostScreenCapture();
        }
    }

    handleControllerConnected(data) {
        if (data.success) {
            this.isController = true;
            this.currentSessionId = data.sessionInfo.id;
            
            // Switch to control screen
            this.showScreen('controlScreen');
            document.getElementById('controlSessionId').textContent = this.currentSessionId;
            
            // Setup canvas for receiving frames
            this.setupCanvas();
            
            this.showNotification('Connected as controller', 'success');
        } else {
            this.showNotification('Failed to join session', 'error');
        }
    }

    handleControllerJoined(data) {
        if (this.isHost) {
            const userCountEl = document.getElementById('connectedUsers');
            if (userCountEl) {
                userCountEl.textContent = data.userCount;
            }
            
            this.showNotification(`User joined (${data.userCount} connected)`, 'info');
        }
    }

    handleSessionEnded() {
        this.showNotification('Session ended', 'warning');
        this.resetSession();
        this.showScreen('welcomeScreen');
    }

    handleUserDisconnected(data) {
        if (this.isHost) {
            const userCountEl = document.getElementById('connectedUsers');
            if (userCountEl) {
                userCountEl.textContent = data.userCount;
            }
            
            this.showNotification(`User disconnected (${data.userCount} remaining)`, 'info');
        }
    }

    // Canvas setup and management
    setupCanvas() {
        this.canvas = document.getElementById('remoteDesktop');
        if (!this.canvas) {
            console.error('❌ Canvas element not found');
            return;
        }

        this.ctx = this.canvas.getContext('2d');
        
        // Setup input handlers
        this.setupCanvasInputHandlers();
        
        // Show connection overlay
        this.showConnectionOverlay();
    }

    setupCanvasInputHandlers() {
        if (!this.canvas) return;

        // Mouse events
        this.canvas.addEventListener('mousemove', (e) => this.handleOptimizedMouseMove(e));
        this.canvas.addEventListener('mousedown', (e) => this.handleOptimizedMouseClick(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleOptimizedMouseClick(e));
        this.canvas.addEventListener('wheel', (e) => this.handleOptimizedMouseWheel(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Keyboard events (canvas needs to be focusable)
        this.canvas.setAttribute('tabindex', '0');
        this.canvas.addEventListener('keydown', (e) => this.handleOptimizedKeyDown(e));
        this.canvas.addEventListener('keyup', (e) => this.handleOptimizedKeyUp(e));

        // Focus canvas for keyboard input
        this.canvas.focus();
    }

    // Enhanced mouse handling with priority queue
    handleOptimizedMouseMove(e) {
        if (!this.isController || !this.socket?.connected) return;

        e.preventDefault();
        const pos = this.getCanvasPosition(e);
        const now = performance.now();

        // Add to priority queue instead of immediate send
        this.inputHandler.priorityQueue.mouseMove.push({
            type: 'mouse-event',
            data: {
                sessionId: this.currentSessionId,
                type: 'mousemove',
                x: pos.x * this.settings.mouseSensitivity,
                y: pos.y * this.settings.mouseSensitivity,
                sensitivity: this.settings.mouseSensitivity,
                timestamp: now
            },
            timestamp: now
        });

        this.updateLocalMousePosition(pos);
        
        // Limit queue size to prevent memory buildup
        if (this.inputHandler.priorityQueue.mouseMove.length > 10) {
            this.inputHandler.priorityQueue.mouseMove = 
                this.inputHandler.priorityQueue.mouseMove.slice(-5);
        }
    }

    handleOptimizedMouseClick(e) {
        if (!this.isController || !this.socket?.connected) return;

        e.preventDefault();
        const pos = this.getCanvasPosition(e);
        const now = performance.now();

        // High priority for mouse clicks
        this.inputHandler.priorityQueue.mouseClick.push({
            type: 'mouse-event',
            data: {
                sessionId: this.currentSessionId,
                type: e.type, // mousedown/mouseup
                x: pos.x,
                y: pos.y,
                button: e.button,
                sensitivity: this.settings.mouseSensitivity,
                timestamp: now
            },
            timestamp: now
        });
    }

    handleOptimizedMouseWheel(e) {
        if (!this.isController || !this.socket?.connected) return;

        e.preventDefault();
        const now = performance.now();

        // Medium priority for scroll events
        this.inputHandler.priorityQueue.scroll.push({
            type: 'mouse-event',
            data: {
                sessionId: this.currentSessionId,
                type: 'wheel',
                deltaX: e.deltaX,
                deltaY: e.deltaY,
                timestamp: now
            },
            timestamp: now
        });
    }

    handleOptimizedKeyDown(e) {
        if (!this.isController || !this.socket?.connected) return;
        if (this.shouldAllowBrowserShortcut(e)) return;

        e.preventDefault();
        const now = performance.now();
        const keyId = `${e.code}_${e.key}`;

        // Prevent key repeat spam
        if (this.inputHandler.keyStates.has(keyId) && 
            (now - this.inputHandler.keyStates.get(keyId)) < this.inputHandler.keyThrottle) {
            return;
        }

        this.inputHandler.keyStates.set(keyId, now);

        // Highest priority for keyboard events
        this.inputHandler.priorityQueue.keyboard.push({
            type: 'keyboard-event',
            data: {
                sessionId: this.currentSessionId,
                type: 'keydown',
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                timestamp: now
            },
            timestamp: now
        });
    }

    handleOptimizedKeyUp(e) {
        if (!this.isController || !this.socket?.connected) return;
        if (this.shouldAllowBrowserShortcut(e)) return;

        e.preventDefault();
        const now = performance.now();

        this.inputHandler.priorityQueue.keyboard.push({
            type: 'keyboard-event',
            data: {
                sessionId: this.currentSessionId,
                type: 'keyup',
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                timestamp: now
            },
            timestamp: now
        });
    }

    shouldAllowBrowserShortcut(e) {
        // Allow certain browser shortcuts
        const allowedShortcuts = [
            'F12', // Dev tools
            'F5',  // Refresh
        ];

        if (allowedShortcuts.includes(e.key)) return true;
        
        // Allow Ctrl+Shift+I (Dev tools)
        if (e.ctrlKey && e.shiftKey && e.key === 'I') return true;
        
        // Allow Ctrl+R (Refresh)
        if (e.ctrlKey && e.key === 'r') return true;
        
        return false;
    }

    getCanvasPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    updateLocalMousePosition(pos) {
        this.inputHandler.mousePosition = pos;
        
        const localCursor = document.getElementById('localCursor');
        if (localCursor) {
            localCursor.style.left = `${pos.x}px`;
            localCursor.style.top = `${pos.y}px`;
        }
    }

    adjustCanvasScale() {
        if (!this.canvas) return;

        const container = this.canvas.parentElement;
        if (!container) return;

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const canvasAspectRatio = this.canvas.width / this.canvas.height;
        const containerAspectRatio = containerWidth / containerHeight;

        let scale;
        if (canvasAspectRatio > containerAspectRatio) {
            scale = containerWidth / this.canvas.width;
        } else {
            scale = containerHeight / this.canvas.height;
        }

        this.canvas.style.width = `${this.canvas.width * scale}px`;
        this.canvas.style.height = `${this.canvas.height * scale}px`;
        
        this.display.scale = scale;
    }

    // Key combination sending
    sendKeyCombo(keys) {
        if (!this.isController || !this.socket?.connected || !this.currentSessionId) return;

        this.socket.emit('key-combination', {
            sessionId: this.currentSessionId,
            keys: keys
        });

        this.showNotification(`Sent: ${keys.join('+')}`, 'info');
    }

    // UI Management
    setupEventListeners() {
        // Welcome screen buttons
        document.getElementById('hostCard')?.addEventListener('click', () => {
            this.showScreen('hostScreen');
        });

        document.getElementById('joinCard')?.addEventListener('click', () => {
            this.showScreen('joinScreen');
        });

        // Host screen buttons
        document.getElementById('backToWelcome')?.addEventListener('click', () => {
            this.showScreen('welcomeScreen');
        });

        document.getElementById('createSessionBtn')?.addEventListener('click', async () => {
            try {
                await this.connectToServer();
                await this.createSession();
            } catch (error) {
                this.showNotification('Failed to create session: ' + error.message, 'error');
            }
        });

        document.getElementById('startHostingBtn')?.addEventListener('click', () => {
            if (this.socket?.connected && this.currentSessionId) {
                this.socket.emit('start-host', {
                    sessionId: this.currentSessionId,
                    password: this.currentPassword
                });
            }
        });

        document.getElementById('endSessionBtn')?.addEventListener('click', () => {
            this.endSession();
        });

        // Join screen buttons
        document.getElementById('backToWelcomeFromJoin')?.addEventListener('click', () => {
            this.showScreen('welcomeScreen');
        });

        document.getElementById('joinSessionBtn')?.addEventListener('click', async () => {
            const sessionId = document.getElementById('joinSessionId')?.value;
            const password = document.getElementById('joinPassword')?.value;
            const fullControl = document.getElementById('fullControlMode')?.checked;

            if (!sessionId || !password) {
                this.showNotification('Please enter session ID and password', 'error');
                return;
            }

            try {
                await this.connectToServer();
                await this.joinSession(sessionId, password, fullControl ? 'control' : 'view');
            } catch (error) {
                this.showNotification('Failed to join session: ' + error.message, 'error');
            }
        });

        // Control screen buttons
        document.getElementById('disconnectBtn')?.addEventListener('click', () => {
            this.disconnect();
        });

        document.getElementById('toggleFullscreen')?.addEventListener('click', () => {
            this.toggleFullscreen();
        });

        document.getElementById('takeScreenshot')?.addEventListener('click', () => {
            this.takeScreenshot();
        });

        // Settings
        document.getElementById('mouseSensitivity')?.addEventListener('input', (e) => {
            this.settings.mouseSensitivity = parseFloat(e.target.value);
            document.getElementById('sensitivityValue').textContent = `${e.target.value}x`;
        });

        document.getElementById('displayQuality')?.addEventListener('change', (e) => {
            this.changeQuality(e.target.value);
        });

        // Server configuration
        document.getElementById('serverConfigToggle')?.addEventListener('click', () => {
            document.getElementById('serverConfig').classList.toggle('show');
        });

        document.getElementById('closeServerConfig')?.addEventListener('click', () => {
            document.getElementById('serverConfig').classList.remove('show');
        });

        document.getElementById('testConnectionBtn')?.addEventListener('click', () => {
            this.testConnection();
        });

        document.getElementById('saveConfigBtn')?.addEventListener('click', () => {
            this.saveServerConfig();
        });
    }

    setupMenuHandlers() {
        window.electronAPI.onMenuAction((action) => {
            switch (action) {
                case 'new-session':
                    this.showScreen('hostScreen');
                    break;
                case 'join-session':
                    this.showScreen('joinScreen');
                    break;
                case 'settings':
                    this.showModal('settingsModal');
                    break;
                case 'server-settings':
                    document.getElementById('serverConfig').classList.add('show');
                    break;
                case 'test-connection':
                    this.testConnection();
                    break;
            }
        });
    }

    initializeUI() {
        // Load quality options
        const qualitySelects = document.querySelectorAll('#qualitySelect, #displayQuality');
        qualitySelects.forEach(select => {
            select.innerHTML = '';
            window.constants.QUALITY_OPTIONS.forEach(option => {
                const optionEl = document.createElement('option');
                optionEl.value = option.value;
                optionEl.textContent = option.label;
                if (option.value === this.settings.quality) {
                    optionEl.selected = true;
                }
                select.appendChild(optionEl);
            });
        });

        // Set server URL
        const serverUrlInput = document.getElementById('serverUrl');
        if (serverUrlInput) {
            serverUrlInput.value = this.settings.serverUrl;
        }

        // Set mouse sensitivity
        const mouseSensitivitySlider = document.getElementById('mouseSensitivity');
        const sensitivityValue = document.getElementById('sensitivityValue');
        if (mouseSensitivitySlider && sensitivityValue) {
            mouseSensitivitySlider.value = this.settings.mouseSensitivity;
            sensitivityValue.textContent = `${this.settings.mouseSensitivity}x`;
        }
    }

    showScreen(screenId) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Show target screen
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
        }
    }

    showCreationStep(step) {
        // Hide all steps
        document.querySelectorAll('.creation-step').forEach(stepEl => {
            stepEl.classList.remove('active');
        });

        // Show target step
        const targetStep = document.getElementById(`step${step}`);
        if (targetStep) {
            targetStep.classList.add('active');
        }
    }

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }

    showConnectionOverlay() {
        const overlay = document.getElementById('connectionOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
    }

    hideConnectionOverlay() {
        const overlay = document.getElementById('connectionOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    // Performance monitoring
    startPerformanceMonitoring() {
        this.performance.startTime = performance.now();
        
        setInterval(() => {
            this.updatePerformanceStats();
        }, 1000);
    }

    startLatencyMonitoring() {
        this.latencyInterval = setInterval(() => {
            if (this.socket?.connected) {
                this.socket.emit('ping', Date.now());
            }
        }, 1000);
    }

    stopLatencyMonitoring() {
        if (this.latencyInterval) {
            clearInterval(this.latencyInterval);
            this.latencyInterval = null;
        }
    }

    updateFrameRate() {
        const now = performance.now();
        
        if (this.performance.lastFrameTime > 0) {
            const timeDiff = now - this.performance.lastFrameTime;
            if (timeDiff > 0) {
                const currentFPS = 1000 / timeDiff;
                this.performance.frameRate = (this.performance.frameRate + currentFPS) / 2;
            }
        }
        
        this.performance.lastFrameTime = now;
        this.performance.frameCount++;
    }

    updatePerformanceStats() {
        // Update FPS display
        this.updateFPSDisplay();
        
        // Update latency display
        this.updateLatencyDisplay();
        
        // Update bandwidth display (placeholder)
        this.updateBandwidthDisplay();
    }

    updateFPSDisplay() {
        const fpsElements = ['controlFps', 'perfFrameRate'];
        fpsElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const fps = Math.round(this.performance.frameRate);
                element.textContent = `${fps} FPS`;
                
                // Color coding based on FPS
                if (fps >= 25) {
                    element.style.color = '#00ff00'; // Green
                } else if (fps >= 15) {
                    element.style.color = '#ffaa00'; // Orange
                } else {
                    element.style.color = '#ff0000'; // Red
                }
            }
        });
    }

    updateLatencyDisplay() {
        const latencyElements = ['controlLatency', 'perfLatency'];
        latencyElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const latency = Math.round(this.performance.networkLatency);
                element.textContent = `${latency} ms`;
                
                // Color coding based on latency
                if (latency <= 50) {
                    element.style.color = '#00ff00'; // Green
                } else if (latency <= 100) {
                    element.style.color = '#ffaa00'; // Orange
                } else {
                    element.style.color = '#ff0000'; // Red
                }
            }
        });
    }

    updateNetworkLatencyDisplay() {
        this.updateLatencyDisplay();
    }

    updateBandwidthDisplay() {
        // Placeholder for bandwidth calculation
        const bandwidthElements = ['controlBandwidth', 'perfBandwidth'];
        bandwidthElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = '-- KB/s'; // TODO: Calculate actual bandwidth
            }
        });
    }

    updatePerformanceDisplay(metadata) {
        // Update resolution
        const perfResolution = document.getElementById('perfResolution');
        if (perfResolution && metadata) {
            perfResolution.textContent = `${metadata.width}×${metadata.height}`;
        }
    }

    adjustQualityBasedOnPerformance() {
        // Placeholder for adaptive quality adjustment
        if (!this.display.adaptiveQuality) return;
        
        const avgLatency = this.performance.networkLatency + this.performance.renderLatency;
        
        if (avgLatency > this.display.targetLatency * 2) {
            // Reduce quality if latency is too high
            // Implementation would go here
        }
    }

    // Utility functions
    async loadPlatformInfo() {
        try {
            const platformInfo = await window.electronAPI.getPlatform();
            const version = await window.electronAPI.getAppVersion();

            document.getElementById('platformInfo').textContent =
                `${platformInfo.platform} ${platformInfo.arch}`;
            document.getElementById('versionInfo').textContent = `v${version} (FFmpeg Binary)`;

            console.log('📋 Platform:', platformInfo);
        } catch (error) {
            console.error('Failed to load platform info:', error);
        }
    }

    async loadSettings() {
        try {
            const defaultSettings = {
                ...window.constants.DEFAULT_SETTINGS,
                mouseThrottle: 8,
                keyThrottle: 5,
                adaptiveQuality: true,
                targetLatency: 50,
                useGPUEncoding: false,
                binaryFrames: true,
                inputPrioritization: true,
                adaptiveFPS: true
            };

            for (const [key, defaultValue] of Object.entries(defaultSettings)) {
                const value = await window.electronAPI.getSetting(key);
                this.settings[key] = value !== undefined ? value : defaultValue;
            }

            // Apply settings to components
            this.inputHandler.mouseThrottle = this.settings.mouseThrottle;
            this.inputHandler.keyThrottle = this.settings.keyThrottle;
            this.display.adaptiveQuality = this.settings.adaptiveQuality;
            this.display.targetLatency = this.settings.targetLatency;
            this.binaryFrames.enabled = this.settings.binaryFrames;
            this.adaptiveFPS.enabled = this.settings.adaptiveFPS;

            this.applySettingsToUI();
            console.log('⚙️ Settings loaded with binary frame support:', this.settings);
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.settings = window.constants.DEFAULT_SETTINGS;
        }
    }

    applySettingsToUI() {
        // Apply loaded settings to UI elements
        const serverUrlInput = document.getElementById('serverUrl');
        if (serverUrlInput) {
            serverUrlInput.value = this.settings.serverUrl;
        }
    }

    getQualitySettings() {
        const qualityOptions = window.constants.QUALITY_OPTIONS;
        return qualityOptions.find(opt => opt.value === this.settings.quality) || qualityOptions[1];
    }

    // Connection and session management
    async testConnection() {
        const serverUrl = document.getElementById('serverUrl')?.value || this.settings.serverUrl;
        const statusEl = document.getElementById('connectionStatus');
        const testBtn = document.getElementById('testConnectionBtn');
        
        if (statusEl) statusEl.textContent = 'Testing...';
        if (testBtn) testBtn.disabled = true;

        try {
            const response = await fetch(serverUrl + '/health');
            if (response.ok) {
                const data = await response.json();
                if (statusEl) {
                    statusEl.textContent = `✅ Connected (${data.sessions} sessions active)`;
                    statusEl.style.color = '#00ff00';
                }
            } else {
                throw new Error('Server not responding');
            }
        } catch (error) {
            if (statusEl) {
                statusEl.textContent = `❌ ${error.message}`;
                statusEl.style.color = '#ff0000';
            }
        } finally {
            if (testBtn) testBtn.disabled = false;
        }
    }

    async saveServerConfig() {
        const serverUrl = document.getElementById('serverUrl')?.value;
        const quality = document.getElementById('qualitySelect')?.value;

        if (serverUrl) {
            this.settings.serverUrl = serverUrl;
            await window.electronAPI.setSetting('serverUrl', serverUrl);
        }

        if (quality) {
            this.settings.quality = quality;
            await window.electronAPI.setSetting('quality', quality);
        }

        this.showNotification('Configuration saved', 'success');
        document.getElementById('serverConfig').classList.remove('show');
    }

    changeQuality(quality) {
        if (this.socket?.connected && this.currentSessionId && this.isHost) {
            this.socket.emit('change-quality', {
                sessionId: this.currentSessionId,
                quality: quality
            });
        }
        
        this.settings.quality = quality;
        window.electronAPI.setSetting('quality', quality);
    }

    disconnect() {
        if (this.socket?.connected) {
            if (this.currentSessionId) {
                this.socket.emit('disconnect-from-session', {
                    sessionId: this.currentSessionId
                });
            }
            this.socket.disconnect();
        }
        
        this.resetSession();
        this.showScreen('welcomeScreen');
        this.showNotification('Disconnected', 'info');
    }

    endSession() {
        if (this.socket?.connected && this.currentSessionId && this.isHost) {
            this.socket.emit('end-session', {
                sessionId: this.currentSessionId
            });
        }
        
        this.resetSession();
        this.showScreen('welcomeScreen');
    }

    resetSession() {
        this.currentSessionId = null;
        this.currentPassword = null;
        this.isHost = false;
        this.isController = false;
        
        if (this.isHost) {
            this.stopHostScreenCapture();
        }
        
        this.stopLatencyMonitoring();
        this.hideConnectionOverlay();
        
        // Reset UI
        this.showCreationStep(1);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    takeScreenshot() {
        if (!this.canvas) return;
        
        const link = document.createElement('a');
        link.download = `screenshot-${Date.now()}.png`;
        link.href = this.canvas.toDataURL();
        link.click();
        
        this.showNotification('Screenshot saved', 'success');
    }

    updateStatus(status, text) {
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.getElementById('statusText');
        
        if (statusDot) {
            statusDot.className = `status-dot ${status}`;
        }
        
        if (statusText) {
            statusText.textContent = text;
        }
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notificationContainer');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">
                    ${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <span class="notification-message">${message}</span>
                <button class="notification-close">×</button>
            </div>
        `;

        container.appendChild(notification);

        // Auto remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);

        // Manual close
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.remove();
        });
    }
}

// Global utility functions
window.copySessionId = async function() {
    const sessionId = document.getElementById('sessionId')?.textContent;
    if (sessionId) {
        await window.utils.copyToClipboard(sessionId);
        app.showNotification('Session ID copied to clipboard', 'success');
    }
};

window.copyPassword = async function() {
    const password = document.getElementById('sessionPassword')?.textContent;
    if (password) {
        await window.utils.copyToClipboard(password);
        app.showNotification('Password copied to clipboard', 'success');
    }
};

window.sendKeyCombo = function(keys) {
    if (window.app) {
        window.app.sendKeyCombo(keys);
    }
};

// Initialize enhanced application
document.addEventListener('DOMContentLoaded', () => {
    console.log('🌟 Starting Enhanced Remote Desktop with FFmpeg + Binary Frames...');
    window.app = new OptimizedRemoteDesktopApp();
});