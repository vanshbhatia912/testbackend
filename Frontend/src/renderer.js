// Ultra-Low Latency WebRTC Remote Desktop Client with Frame Skipping
class WebRTCRemoteDesktopApp {
    constructor() {
        this.socket = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.currentSessionId = null;
        this.currentPassword = null;
        this.isHost = false;
        this.isController = false;
        this.videoElement = null;
        this.settings = {};
        this.rtpPort = null;

        // Ultra-low latency performance tracking
        this.performance = {
            webrtcLatency: 0,
            renderLatency: 0,
            inputLatency: 0,
            networkLatency: 0,
            frameRate: 0,
            bitrate: 0,
            packetsLost: 0,
            jitter: 0,
            lastFrameTime: 0,
            frameCount: 0,
            // WebRTC specific
            encodeTime: 0,
            decodeTime: 0,
            rtt: 0
        };

        // Frame skipping for real-time experience
        this.frameSkipper = null;
        this.droppedFrames = 0;
        this.renderedFrames = 0;

        // Input event queue with DataChannel prioritization
        this.inputQueue = {
            keyboard: [],
            mouseClick: [],
            mouseMove: [],
            scroll: []
        };

        // WebRTC connection state
        this.webrtcState = {
            connectionState: 'new',
            iceConnectionState: 'new',
            signalingState: 'stable',
            dataChannelState: 'connecting'
        };

        this.init();
    }

    async init() {
        console.log('Starting WebRTC Remote Desktop...');

        try {
            await this.loadPlatformInfo();
            await this.loadSettings();
            await this.checkWebRTCSupport();
            this.setupEventListeners();
            this.setupMenuHandlers();
            this.initializeUI();
            this.startPerformanceMonitoring();
            this.setupInputQueue();

            // Initialize frame skipping
            this.frameSkipper = window.webrtcUtils.createFrameSkipper();

            console.log('WebRTC Remote Desktop initialized successfully');

        } catch (error) {
            console.error('Failed to initialize WebRTC application:', error);
            this.showNotification('Failed to initialize WebRTC application', 'error');
        }
    }

    async checkWebRTCSupport() {
        if (!window.RTCPeerConnection) {
            throw new Error('WebRTC not supported in this browser');
        }

        // Check codec support
        const capabilities = RTCRtpReceiver.getCapabilities('video');
        const h264Supported = capabilities?.codecs?.some(codec => 
            codec.mimeType.toLowerCase().includes('h264')
        );

        if (!h264Supported) {
            console.warn('H.264 codec may not be supported');
        }

        console.log('WebRTC support verified:', {
            peerConnection: !!window.RTCPeerConnection,
            dataChannels: !!RTCPeerConnection.prototype.createDataChannel,
            h264: h264Supported
        });
    }

    // WebRTC Connection Management
    async createWebRTCConnection() {
        if (this.peerConnection) {
            this.peerConnection.close();
        }

        // Create peer connection with optimized settings
        this.peerConnection = window.webrtcUtils.createPeerConnection(this.settings.iceServers);
        
        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            this.webrtcState.connectionState = this.peerConnection.connectionState;
            this.updateConnectionStatus();
            
            if (this.peerConnection.connectionState === 'connected') {
                console.log('WebRTC P2P connection established');
                this.showNotification('Direct P2P connection established', 'success');
                this.startStatsCollection();
            } else if (this.peerConnection.connectionState === 'failed') {
                console.error('WebRTC connection failed');
                this.handleConnectionFailure();
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            this.webrtcState.iceConnectionState = this.peerConnection.iceConnectionState;
            console.log('ICE connection state:', this.peerConnection.iceConnectionState);
        };

        // Handle incoming video stream
        this.peerConnection.ontrack = (event) => {
            console.log('Received remote video stream');
            
            if (event.streams && event.streams[0]) {
                this.handleIncomingVideoStream(event.streams[0]);
            }
        };

        // Handle incoming data channel (for controllers)
        this.peerConnection.ondatachannel = (event) => {
            const channel = event.channel;
            this.setupDataChannelHandlers(channel);
            console.log('Received data channel:', channel.label);
        };

        return this.peerConnection;
    }

    handleIncomingVideoStream(stream) {
        if (!this.videoElement) {
            this.videoElement = document.getElementById('remoteVideo');
            if (!this.videoElement) {
                console.error('Video element not found');
                return;
            }
        }

        // Configure video element for minimal latency
        this.videoElement.srcObject = stream;
        this.videoElement.playsInline = true;
        this.videoElement.muted = true; // Avoid audio feedback
        this.videoElement.controls = false;
        
        // Ultra-low latency settings
        if ('requestVideoFrameCallback' in this.videoElement) {
            this.setupFrameCallback();
        }

        this.videoElement.onloadedmetadata = () => {
            console.log('Video stream loaded:', {
                width: this.videoElement.videoWidth,
                height: this.videoElement.videoHeight
            });
            this.hideConnectionOverlay();
        };

        this.videoElement.play().catch(error => {
            console.error('Failed to play video stream:', error);
        });
    }

    setupFrameCallback() {
        const processFrame = (now, metadata) => {
            // Update frame metrics
            this.renderedFrames++;
            
            if (this.performance.lastFrameTime > 0) {
                const frameDelta = now - this.performance.lastFrameTime;
                this.performance.frameRate = 1000 / frameDelta;
            }
            this.performance.lastFrameTime = now;

            // Update frame timing display
            this.updateFrameDisplay();

            // Request next frame
            this.videoElement.requestVideoFrameCallback(processFrame);
        };

        this.videoElement.requestVideoFrameCallback(processFrame);
    }

    // Data Channel Setup for Input Events
    async setupDataChannel() {
        if (!this.peerConnection) {
            throw new Error('Peer connection not established');
        }

        // Create data channel with ultra-low latency settings
        this.dataChannel = window.webrtcUtils.createDataChannel(
            this.peerConnection, 
            'inputs', 
            {
                ordered: false,
                maxRetransmits: 0,
                maxPacketLifeTime: 50 // 50ms max
            }
        );

        this.setupDataChannelHandlers(this.dataChannel);
        return this.dataChannel;
    }

    setupDataChannelHandlers(channel) {
        channel.onopen = () => {
            this.webrtcState.dataChannelState = 'open';
            console.log('Data channel opened:', channel.label);
            
            // Notify server about data channel readiness
            if (this.socket && this.currentSessionId) {
                this.socket.emit('datachannel-ready', {
                    sessionId: this.currentSessionId,
                    channelLabel: channel.label
                });
            }
        };

        channel.onclose = () => {
            this.webrtcState.dataChannelState = 'closed';
            console.log('Data channel closed');
        };

        channel.onerror = (error) => {
            console.error('Data channel error:', error);
        };

        // Handle incoming input events (for hosts)
        channel.onmessage = (event) => {
            if (this.isHost) {
                this.handleRemoteInputEvent(event.data);
            }
        };

        this.dataChannel = channel;
    }

    // Input Event Processing
    setupInputQueue() {
        // Process input events every 8ms (125 FPS max input rate)
        setInterval(() => {
            this.processInputQueue();
        }, 8);
    }

    processInputQueue() {
        if (!this.isController || !this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }

        // Process in priority order
        const priorities = ['keyboard', 'mouseClick', 'mouseMove', 'scroll'];
        
        for (const priority of priorities) {
            while (this.inputQueue[priority].length > 0) {
                const event = this.inputQueue[priority].shift();
                
                try {
                    const serializedEvent = window.utils.serializeInputEvent(event);
                    this.dataChannel.send(serializedEvent);
                    
                    // Track input latency
                    this.performance.inputLatency = performance.now() - event.timestamp;
                    
                } catch (error) {
                    console.error('Failed to send input event:', error);
                }
            }
        }
    }

    async handleRemoteInputEvent(eventData) {
        try {
            const event = window.utils.deserializeInputEvent(eventData);
            if (!event) return;

            const { type, data } = event;
            
            switch (type) {
                case 'mouse-move':
                    await window.electronAPI.simulateMouseMove(data.x, data.y, data.sensitivity);
                    break;
                case 'mouse-click':
                    await window.electronAPI.simulateMouseClick(data.x, data.y, data.button, data.action);
                    break;
                case 'mouse-wheel':
                    await window.electronAPI.simulateMouseWheel(data.deltaY, data.deltaX);
                    break;
                case 'keyboard':
                    await window.electronAPI.simulateKeyPress(data);
                    break;
                case 'key-combo':
                    await window.electronAPI.simulateKeyCombo(data.keys);
                    break;
            }
        } catch (error) {
            console.error('Failed to handle remote input:', error);
        }
    }

    // WebRTC Signaling
    async connectToServer(serverUrl) {
        if (!serverUrl) {
            serverUrl = this.settings.serverUrl;
        }

        try {
            console.log('Connecting to WebRTC signaling server:', serverUrl);
            this.updateStatus('connecting', 'Connecting...');

            if (this.socket) {
                this.socket.disconnect();
            }

            this.socket = io('https://testbackend-hbo4.onrender.com/', {
                transports: ['websocket'],
                timeout: this.settings.connectionTimeout * 1000,
                forceNew: true
            });

            this.setupWebRTCSignalingEvents();

            return new Promise((resolve, reject) => {
                this.socket.on('connect', () => {
                    resolve(true);
                });

                this.socket.on('connect_error', (error) => {
                    reject(error);
                });

                setTimeout(() => {
                    if (!this.socket?.connected) {
                        reject(new Error('Connection timeout'));
                    }
                }, this.settings.connectionTimeout * 1000);
            });

        } catch (error) {
            console.error('Connection failed:', error);
            this.updateStatus('offline', 'Connection failed');
            throw error;
        }
    }

    setupWebRTCSignalingEvents() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('Connected to WebRTC signaling server');
            this.updateStatus('online', 'Connected - WebRTC ready');
        });

        this.socket.on('disconnect', (reason) => {
            console.log('Disconnected from signaling server:', reason);
            this.updateStatus('offline', 'Disconnected');
            this.cleanup();
        });

        // Session management
        this.socket.on('session-created', (data) => this.handleSessionCreated(data));
        this.socket.on('host-connected', (data) => this.handleHostConnected(data));
        this.socket.on('controller-connected', (data) => this.handleControllerConnected(data));
        this.socket.on('controller-joined', (data) => this.handleControllerJoined(data));

        // WebRTC signaling events
        this.socket.on('webrtc-offer', async (data) => {
            await this.handleWebRTCOffer(data);
        });

        this.socket.on('webrtc-answer', async (data) => {
            await this.handleWebRTCAnswer(data);
        });

        this.socket.on('webrtc-ice-candidate', async (data) => {
            await this.handleICECandidate(data);
        });

        // Connection events
        this.socket.on('peer-connected', (data) => {
            console.log('Peer connected:', data);
        });

        this.socket.on('peer-disconnected', (data) => {
            console.log('Peer disconnected:', data);
        });

        this.socket.on('session-ended', () => this.handleSessionEnded());
        this.socket.on('user-disconnected', (data) => this.handleUserDisconnected(data));
    }

    // WebRTC Signaling Handlers
    async handleWebRTCOffer(data) {
        const { fromSocketId, offer, candidates } = data;
        
        if (!this.peerConnection) {
            await this.createWebRTCConnection();
        }

        try {
            await this.peerConnection.setRemoteDescription(offer);
            
            // Add ICE candidates
            for (const candidate of candidates || []) {
                await this.peerConnection.addIceCandidate(candidate);
            }

            // Create answer
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            // Send answer back
            this.socket.emit('webrtc-answer', {
                sessionId: this.currentSessionId,
                targetSocketId: fromSocketId,
                answer: answer
            });

            console.log('WebRTC answer sent');

        } catch (error) {
            console.error('Failed to handle WebRTC offer:', error);
        }
    }

    async handleWebRTCAnswer(data) {
        const { answer } = data;
        
        try {
            await this.peerConnection.setRemoteDescription(answer);
            console.log('WebRTC answer received and set');
        } catch (error) {
            console.error('Failed to handle WebRTC answer:', error);
        }
    }

    async handleICECandidate(data) {
        const { candidate } = data;
        
        try {
            if (this.peerConnection && candidate) {
                await this.peerConnection.addIceCandidate(candidate);
            }
        } catch (error) {
            console.error('Failed to add ICE candidate:', error);
        }
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
            webrtcCapabilities: {
                h264Hardware: true,
                dataChannels: true,
                frameSkipping: true
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

    // Host-specific functions
    async handleSessionCreated(data) {
        if (data.success) {
            this.currentSessionId = data.sessionId;
            this.currentPassword = data.password;
            this.isHost = true;

            document.getElementById('sessionId').textContent = data.sessionId;
            document.getElementById('sessionPassword').textContent = data.password;
            
            this.showCreationStep(2);
            this.showNotification(`WebRTC session created: ${data.sessionId}`, 'success');
        }
    }

    async handleHostConnected(data) {
        if (data.success) {
            this.showCreationStep(3);
            document.getElementById('activeSessionId').textContent = this.currentSessionId;
            
            // Start WebRTC stream
            await this.startWebRTCHost();
        }
    }

    async startWebRTCHost() {
        try {
            // Create RTP server for FFmpeg stream
            const rtpResult = await window.electronAPI.createRTPServer();
            if (!rtpResult.success) {
                throw new Error(rtpResult.error);
            }
            this.rtpPort = rtpResult.port;

            // Start WebRTC peer connection
            await this.createWebRTCConnection();

            // Set up data channel for input
            await this.setupDataChannel();

            // Start screen capture to RTP
            const qualitySettings = this.getQualitySettings();
            const captureResult = await window.electronAPI.startWebRTCCapture({
                fps: qualitySettings.fps,
                quality: qualitySettings.crf,
                preset: qualitySettings.preset,
                bitrate: qualitySettings.bitrate,
                useGPU: this.settings.preferH264Hardware
            });

            if (captureResult.success) {
                console.log('WebRTC host started successfully');
                this.showNotification('WebRTC streaming active', 'success');
            } else {
                throw new Error(captureResult.error);
            }

        } catch (error) {
            console.error('Failed to start WebRTC host:', error);
            this.showNotification('Failed to start WebRTC host: ' + error.message, 'error');
        }
    }

    // Controller-specific functions
    async handleControllerConnected(data) {
        if (data.success) {
            this.isController = true;
            this.currentSessionId = data.sessionInfo.id;
            
            this.showScreen('controlScreen');
            document.getElementById('controlSessionId').textContent = this.currentSessionId;
            
            // Set up video element and input handlers
            this.setupVideoElement();
            this.setupInputHandlers();
            
            // Create WebRTC connection as controller
            await this.createWebRTCConnection();
            
            this.showNotification('Connected as WebRTC controller', 'success');
        }
    }

    setupVideoElement() {
        this.videoElement = document.getElementById('remoteVideo');
        if (!this.videoElement) {
            console.error('Remote video element not found');
            return;
        }

        // Show connection overlay until video starts
        this.showConnectionOverlay();
    }

    setupInputHandlers() {
        if (!this.videoElement) return;

        // Mouse events with throttling for performance
        const throttledMouseMove = window.utils.throttle((e) => {
            this.handleMouseMove(e);
        }, 8); // 125 FPS max

        this.videoElement.addEventListener('mousemove', throttledMouseMove);
        this.videoElement.addEventListener('mousedown', (e) => this.handleMouseClick(e));
        this.videoElement.addEventListener('mouseup', (e) => this.handleMouseClick(e));
        this.videoElement.addEventListener('wheel', (e) => this.handleMouseWheel(e));
        this.videoElement.addEventListener('contextmenu', (e) => e.preventDefault());

        // Keyboard events
        this.videoElement.setAttribute('tabindex', '0');
        this.videoElement.addEventListener('keydown', (e) => this.handleKeyDown(e));
        this.videoElement.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // Focus video element for keyboard input
        this.videoElement.focus();
    }

    // Input Event Handlers
    handleMouseMove(e) {
        if (!this.isController || !this.dataChannel) return;

        e.preventDefault();
        const rect = this.videoElement.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        // Add to input queue with priority 3
        this.inputQueue.mouseMove.push({
            type: 'mouse-move',
            data: {
                x: x * this.videoElement.videoWidth,
                y: y * this.videoElement.videoHeight,
                sensitivity: this.settings.mouseSensitivity
            },
            timestamp: performance.now(),
            priority: 3
        });

        // Limit queue size to prevent memory buildup
        if (this.inputQueue.mouseMove.length > 5) {
            this.inputQueue.mouseMove = this.inputQueue.mouseMove.slice(-3);
        }
    }

    handleMouseClick(e) {
        if (!this.isController || !this.dataChannel) return;

        e.preventDefault();
        const rect = this.videoElement.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        // High priority for clicks
        this.inputQueue.mouseClick.push({
            type: 'mouse-click',
            data: {
                x: x * this.videoElement.videoWidth,
                y: y * this.videoElement.videoHeight,
                button: e.button,
                action: e.type // mousedown/mouseup
            },
            timestamp: performance.now(),
            priority: 2
        });
    }

    handleMouseWheel(e) {
        if (!this.isController || !this.dataChannel) return;

        e.preventDefault();

        this.inputQueue.scroll.push({
            type: 'mouse-wheel',
            data: {
                deltaX: e.deltaX,
                deltaY: e.deltaY
            },
            timestamp: performance.now(),
            priority: 4
        });
    }

    handleKeyDown(e) {
        if (!this.isController || !this.dataChannel) return;
        if (this.shouldAllowBrowserShortcut(e)) return;

        e.preventDefault();

        // Highest priority for keyboard
        this.inputQueue.keyboard.push({
            type: 'keyboard',
            data: {
                type: 'keydown',
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
                metaKey: e.metaKey
            },
            timestamp: performance.now(),
            priority: 1
        });
    }

    handleKeyUp(e) {
        if (!this.isController || !this.dataChannel) return;
        if (this.shouldAllowBrowserShortcut(e)) return;

        e.preventDefault();

        this.inputQueue.keyboard.push({
            type: 'keyboard',
            data: {
                type: 'keyup',
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
                metaKey: e.metaKey
            },
            timestamp: performance.now(),
            priority: 1
        });
    }

    shouldAllowBrowserShortcut(e) {
        const allowedShortcuts = ['F12', 'F5'];
        if (allowedShortcuts.includes(e.key)) return true;
        if (e.ctrlKey && e.shiftKey && e.key === 'I') return true;
        if (e.ctrlKey && e.key === 'r') return true;
        return false;
    }

    // Key combination sending
    sendKeyCombo(keys) {
        if (!this.isController || !this.dataChannel) return;

        this.inputQueue.keyboard.push({
            type: 'key-combo',
            data: { keys },
            timestamp: performance.now(),
            priority: 1
        });

        this.showNotification(`Sent: ${keys.join('+')}`, 'info');
    }

    // Performance Monitoring
    startPerformanceMonitoring() {
        setInterval(() => {
            this.updatePerformanceStats();
        }, 1000);
    }

    async startStatsCollection() {
        if (!this.peerConnection) return;

        setInterval(async () => {
            try {
                const stats = await window.webrtcUtils.getConnectionStats(this.peerConnection);
                this.updateWebRTCStats(stats);
                
                // Send stats to signaling server
                if (this.socket && this.currentSessionId) {
                    this.socket.emit('webrtc-stats', {
                        sessionId: this.currentSessionId,
                        stats: {
                            rtt: stats.connection.rtt,
                            bitrate: stats.video.outbound?.bitrate || 0,
                            packetsLost: stats.video.inbound?.packetsLost || 0,
                            framesDecoded: stats.video.inbound?.framesDecoded || 0
                        }
                    });
                }
            } catch (error) {
                console.error('Failed to collect WebRTC stats:', error);
            }
        }, 2000);
    }

    updateWebRTCStats(stats) {
        // Update performance metrics
        this.performance.rtt = stats.connection.rtt || 0;
        this.performance.bitrate = stats.video.outbound?.bitrate || stats.video.inbound?.bitrate || 0;
        this.performance.packetsLost = stats.video.inbound?.packetsLost || 0;
        this.performance.jitter = stats.video.inbound?.jitter || 0;

        // Update display
        this.updateStatsDisplay();
    }

    updatePerformanceStats() {
        this.updateFrameDisplay();
        this.updateLatencyDisplay();
        this.updateBandwidthDisplay();
    }

    updateFrameDisplay() {
        const fpsElements = ['controlFps', 'perfFrameRate'];
        fpsElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const fps = Math.round(this.performance.frameRate);
                element.textContent = `${fps} FPS`;
                
                if (fps >= 25) {
                    element.style.color = '#00ff00';
                } else if (fps >= 15) {
                    element.style.color = '#ffaa00';
                } else {
                    element.style.color = '#ff0000';
                }
            }
        });
    }

    updateLatencyDisplay() {
        const latencyElements = ['controlLatency', 'perfLatency'];
        latencyElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const latency = Math.round(this.performance.rtt);
                element.textContent = `${latency} ms`;
                
                if (latency <= 50) {
                    element.style.color = '#00ff00';
                } else if (latency <= 100) {
                    element.style.color = '#ffaa00';
                } else {
                    element.style.color = '#ff0000';
                }
            }
        });
    }

    updateBandwidthDisplay() {
        const bandwidthElements = ['controlBandwidth', 'perfBandwidth'];
        bandwidthElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const mbps = (this.performance.bitrate / 1000000).toFixed(1);
                element.textContent = `${mbps} Mbps`;
            }
        });
    }

    updateStatsDisplay() {
        // Update connection quality indicator
        const qualityAnalysis = window.performance.analyzeConnectionQuality({
            video: { inbound: { jitter: this.performance.jitter }},
            connection: { rtt: this.performance.rtt }
        });

        const qualityElement = document.getElementById('connectionQuality');
        if (qualityElement) {
            qualityElement.textContent = qualityAnalysis.overall;
            qualityElement.className = `quality-${qualityAnalysis.overall}`;
        }
    }

    updateConnectionStatus() {
        const statusMap = {
            'new': 'Initializing WebRTC...',
            'connecting': 'Establishing P2P connection...',
            'connected': 'Direct P2P connection active',
            'disconnected': 'Connection lost',
            'failed': 'Connection failed',
            'closed': 'Connection closed'
        };

        const status = statusMap[this.webrtcState.connectionState] || 'Unknown';
        this.updateStatus('webrtc', status);
    }

    // Session management handlers
    handleControllerJoined(data) {
        if (this.isHost) {
            const userCountEl = document.getElementById('connectedUsers');
            if (userCountEl) {
                userCountEl.textContent = data.userCount;
            }
            
            this.showNotification(`Controller joined (${data.userCount} connected)`, 'info');
            
            // Initiate WebRTC offer to new controller
            this.initiateWebRTCConnection(data.userId);
        }
    }

    async initiateWebRTCConnection(targetSocketId) {
        if (!this.peerConnection) {
            await this.createWebRTCConnection();
        }

        try {
            // Create offer
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            // Send offer to controller
            this.socket.emit('webrtc-offer', {
                sessionId: this.currentSessionId,
                targetSocketId: targetSocketId,
                offer: offer
            });

            console.log('WebRTC offer sent to controller:', targetSocketId);

        } catch (error) {
            console.error('Failed to create WebRTC offer:', error);
        }
    }

    handleSessionEnded() {
        this.showNotification('Session ended', 'warning');
        this.cleanup();
        this.showScreen('welcomeScreen');
    }

    handleUserDisconnected(data) {
        if (this.isHost) {
            const userCountEl = document.getElementById('connectedUsers');
            if (userCountEl) {
                userCountEl.textContent = data.userCount;
            }
            
            this.showNotification(`Controller disconnected (${data.userCount} remaining)`, 'info');
        }
    }

    handleConnectionFailure() {
        this.showNotification('WebRTC connection failed - trying to reconnect...', 'error');
        
        // Attempt reconnection
        setTimeout(() => {
            if (this.isController) {
                this.createWebRTCConnection();
            }
        }, 3000);
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

        // Settings handlers
        document.getElementById('mouseSensitivity')?.addEventListener('input', (e) => {
            this.settings.mouseSensitivity = parseFloat(e.target.value);
            document.getElementById('sensitivityValue').textContent = `${e.target.value}x`;
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
                case 'webrtc-stats':
                    this.showWebRTCStats();
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

    // Utility functions
    async loadPlatformInfo() {
        try {
            const platformInfo = await window.electronAPI.getPlatform();
            const version = await window.electronAPI.getAppVersion();

            document.getElementById('platformInfo').textContent = 
                `${platformInfo.platform} ${platformInfo.arch}`;
            document.getElementById('versionInfo').textContent = `v${version} (WebRTC P2P)`;

            console.log('Platform:', platformInfo);
        } catch (error) {
            console.error('Failed to load platform info:', error);
        }
    }

    async loadSettings() {
        try {
            const defaultSettings = {
                ...window.constants.DEFAULT_SETTINGS,
                mouseSensitivity: 1.0,
                useWebRTC: true,
                preferH264Hardware: true,
                enableDataChannels: true,
                frameSkipping: true
            };

            for (const [key, defaultValue] of Object.entries(defaultSettings)) {
                const value = await window.electronAPI.getSetting(key);
                this.settings[key] = value !== undefined ? value : defaultValue;
            }

            console.log('Settings loaded for WebRTC:', this.settings);
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.settings = window.constants.DEFAULT_SETTINGS;
        }
    }

    getQualitySettings() {
        const qualityOptions = window.constants.QUALITY_OPTIONS;
        return qualityOptions.find(opt => opt.value === this.settings.quality) || qualityOptions[1];
    }

    // Connection management
    disconnect() {
        this.cleanup();
        this.showScreen('welcomeScreen');
        this.showNotification('Disconnected', 'info');
    }

    endSession() {
        if (this.socket?.connected && this.currentSessionId && this.isHost) {
            this.socket.emit('end-session', {
                sessionId: this.currentSessionId
            });
        }
        
        this.cleanup();
        this.showScreen('welcomeScreen');
    }

    cleanup() {
        // Close WebRTC connections
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        // Disconnect socket
        if (this.socket?.connected) {
            this.socket.disconnect();
        }

        // Stop screen capture if host
        if (this.isHost) {
            window.electronAPI.stopWebRTCCapture();
        }

        // Reset state
        this.currentSessionId = null;
        this.currentPassword = null;
        this.isHost = false;
        this.isController = false;
        
        this.hideConnectionOverlay();
        this.showCreationStep(1);
    }

    // UI helper methods
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
        }
    }

    showCreationStep(step) {
        document.querySelectorAll('.creation-step').forEach(stepEl => {
            stepEl.classList.remove('active');
        });

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

        setTimeout(() => {
            notification.remove();
        }, 5000);

        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.remove();
        });
    }

    showWebRTCStats() {
        if (this.peerConnection) {
            window.webrtcUtils.getConnectionStats(this.peerConnection)
                .then(stats => {
                    const analysis = window.performance.analyzeConnectionQuality(stats);
                    this.showNotification(
                        `Connection: ${analysis.overall} | RTT: ${this.performance.rtt}ms | Bitrate: ${(this.performance.bitrate/1000000).toFixed(1)}Mbps`, 
                        'info'
                    );
                });
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
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

// Initialize WebRTC Remote Desktop Application
document.addEventListener('DOMContentLoaded', () => {
    console.log('Starting Ultra-Low Latency WebRTC Remote Desktop...');
    window.app = new WebRTCRemoteDesktopApp();
});