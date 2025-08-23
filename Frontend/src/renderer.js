// Ultra Low Latency WebRTC Remote Desktop Client (FIXED) (<50ms target)
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
        this.localStream = null;

        // WebRTC Configuration with optimized settings
        this.rtcConfiguration = {
            iceServers: [], // Will be populated from server
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceCandidatePoolSize: 10,
            // Ultra low-latency optimizations
            sdpSemantics: 'unified-plan'
        };

        // Performance tracking for <50ms target
        this.performance = {
            signaling: 0,
            webrtcConnection: 0,
            endToEndLatency: 0,
            frameLatency: 0,
            inputLatency: 0,
            packetLoss: 0,
            jitter: 0,
            bandwidth: 0,
            framesReceived: 0,
            framesDropped: 0,
            lastFrameTime: 0,
            connectionStartTime: 0
        };

        // Frame skipping for real-time performance
        this.frameSkipping = {
            enabled: true,
            maxBufferTime: 33, // 33ms = ~30 FPS max buffer
            lastProcessedFrame: 0,
            framesSkipped: 0,
            targetLatency: 50 // Target <50ms
        };

        // Input buffering and batching for DataChannel
        this.inputBuffer = {
            mouse: [],
            keyboard: [],
            batchInterval: 8, // 8ms = 125fps max input rate
            lastSend: 0,
            maxBuffer: 5 // Maximum buffered events
        };

        // WebRTC Statistics tracking
        this.webrtcStats = {
            video: {
                bytesReceived: 0,
                packetsReceived: 0,
                packetsLost: 0,
                framesDecoded: 0,
                framesDropped: 0,
                totalDecodeTime: 0
            },
            datachannel: {
                messagesSent: 0,
                messagesReceived: 0,
                bytesSent: 0,
                bytesReceived: 0
            }
        };

        this.init();
    }

    async init() {
        console.log('🚀 Initializing WebRTC Remote Desktop...');

        try {
            await this.loadPlatformInfo();
            await this.loadSettings();
            await this.checkWebRTCSupport();
            this.setupEventListeners();
            this.setupMenuHandlers();
            this.initializeUI();
            this.startPerformanceMonitoring();
            this.setupInputBuffering();

            console.log('✅ WebRTC Remote Desktop initialized');

        } catch (error) {
            console.error('❌ Failed to initialize application:', error);
            this.showNotification('Failed to initialize WebRTC features', 'error');
        }
    }

    async checkWebRTCSupport() {
        try {
            // Check WebRTC API support
            if (!window.RTCPeerConnection) {
                throw new Error('WebRTC not supported in this browser');
            }

            // Test media capabilities
            const capabilities = RTCRtpReceiver.getCapabilities('video');
            const h264Support = capabilities.codecs.some(codec => 
                codec.mimeType.toLowerCase().includes('h264')
            );

            if (!h264Support) {
                console.warn('⚠️ H.264 codec may not be supported');
            }

            console.log('✅ WebRTC support confirmed');
            return {
                supported: true,
                h264: h264Support,
                codecs: capabilities.codecs.map(c => c.mimeType)
            };
        } catch (error) {
            console.error('❌ WebRTC check failed:', error);
            throw error;
        }
    }

    // WebRTC Connection Management
    async connectToSignalingServer(serverUrl) {
        if (!serverUrl) {
            serverUrl = 'https://testbackend-hbo4.onrender.com';
        }

        try {
            console.log('🔗 Connecting to WebRTC signaling server:', serverUrl);
            this.updateStatus('connecting', 'Connecting to signaling server...');

            if (this.socket) {
                this.socket.disconnect();
            }

            this.socket = io(serverUrl, {
                transports: ['websocket'],
                timeout: this.settings.connectionTimeout * 1000,
                forceNew: true,
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });

            this.setupWebRTCSignaling();

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    if (!this.socket?.connected) {
                        reject(new Error('Signaling connection timeout'));
                    }
                }, this.settings.connectionTimeout * 1000);

                this.socket.on('connect', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });

                this.socket.on('connect_error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

        } catch (error) {
            console.error('❌ Signaling connection failed:', error);
            this.updateStatus('offline', 'Signaling connection failed');
            throw error;
        }
    }

    setupWebRTCSignaling() {
        if (!this.socket) return;

        // Connection events
        this.socket.on('connect', () => {
            console.log('✅ Connected to WebRTC signaling server');
            this.updateStatus('online', 'Signaling connected');
            this.showNotification('WebRTC signaling ready', 'success');
            this.startLatencyMonitoring();
        });

        this.socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected from signaling server:', reason);
            this.updateStatus('offline', 'Signaling disconnected');
            this.showNotification('Lost signaling connection', 'warning');
            this.stopLatencyMonitoring();
            
            if (this.peerConnection) {
                this.closePeerConnection();
            }
        });

        // ICE servers configuration
        this.socket.on('ice-servers', (data) => {
            this.rtcConfiguration.iceServers = data.iceServers;
            console.log('🧊 ICE servers configured:', data.iceServers.length);
        });

        // Latency monitoring
        this.socket.on('pong', (data) => {
            this.performance.signaling = data.latency;
            this.updateSignalingLatencyDisplay();
        });

        // Session management
        this.socket.on('session-created', (data) => {
            if (data.success) {
                this.handleSessionCreated(data);
            } else {
                this.showNotification('Failed to create session', 'error');
            }
        });

        this.socket.on('webrtc-host-ready', (data) => {
            if (data.success) {
                this.handleHostReady(data);
            }
        });

        this.socket.on('webrtc-join-ready', (data) => {
            if (data.success) {
                this.handleJoinReady(data);
            } else {
                this.showNotification('Failed to join session', 'error');
            }
        });

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

        // Peer events
        this.socket.on('controller-joined', (data) => {
            if (this.isHost) {
                this.showNotification(`Controller joined (${data.userCount} connected)`, 'info');
                this.initiatePeerConnection(data.userId);
            }
        });

        this.socket.on('peer-connected', (data) => {
            console.log(`✅ Peer WebRTC connected: ${data.peerId}`);
            this.performance.webrtcConnection = Date.now() - this.performance.connectionStartTime;
        });

        this.socket.on('peer-disconnected', (data) => {
            console.log(`👋 Peer disconnected: ${data.peerId}`);
            if (this.isController) {
                this.showNotification('Host disconnected', 'warning');
                this.resetSession();
            }
        });

        // Input events via DataChannel fallback
        this.socket.on('datachannel-input', (data) => {
            if (this.isHost) {
                this.handleRemoteInput(data);
            }
        });

        this.socket.on('session-ended', () => {
            this.handleSessionEnded();
        });
    }

    optimizeSDPForLowLatency(sdp) {
        let optimizedSDP = sdp;
        
        // Force H.264 baseline profile for better compatibility and hardware acceleration
        optimizedSDP = optimizedSDP.replace(
            /a=fmtp:(\d+).*$/gm,
            'a=fmtp:$1 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'
        );
        
        // Add ultra-low latency optimizations
        const lowLatencyParams = [
            'a=x-google-max-bitrate:4000',
            'a=x-google-min-bitrate:1000',
            'a=x-google-start-bitrate:2000',
            'a=x-google-flag:conference-mode',
            'a=x-google-flag:cpu-overuse-detection',
            'a=content:slides' // Optimize for screen content
        ];
        
        // Add parameters after the video media section
        optimizedSDP = optimizedSDP.replace(
            /(m=video.*\r?\n(?:a=.*\r?\n)*)/,
            `$1${lowLatencyParams.join('\r\n')}\r\n`
        );
        
        return optimizedSDP;
    }

    // Stream cleanup method
    cleanupLocalStream() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                console.log('🛑 Stopped video track:', track.kind);
            });
            this.localStream = null;
        }
    }

    // FIXED: WebRTC Peer Connection Management
    async initiatePeerConnection(targetPeerId = null) {
        console.log('🔄 Initiating WebRTC peer connection...');
        
        try {
            this.performance.connectionStartTime = Date.now();
            
            // Create peer connection with optimized configuration
            const rtcConfig = {
                ...this.rtcConfiguration,
                // Additional low-latency optimizations
                iceCandidatePoolSize: 10,
                bundlePolicy: 'max-bundle',
                rtcpMuxPolicy: 'require'
            };
            
            this.peerConnection = new RTCPeerConnection(rtcConfig);
            
            // Set up event handlers
            this.setupPeerConnectionEvents();

            if (this.isHost) {
                console.log('📡 Setting up host peer connection...');
                
                // DataChannel configuration (removed conflicting parameters)
                this.dataChannel = this.peerConnection.createDataChannel('input', {
                    ordered: false,           // Faster delivery
                    maxRetransmits: 0,       // Don't retransmit for real-time input
                    protocol: 'input-events'
                });
                this.setupDataChannelEvents();

                // Host: Add screen capture stream with multiple fallbacks
                try {
                    await this.addScreenCaptureStream();
                } catch (screenError) {
                    console.error('❌ All screen capture methods failed:', screenError.message);
                    this.showNotification('Screen capture unavailable: ' + screenError.message, 'error');
                    // Continue without video - DataChannel will still work
                }
                
                // Create offer with optimized constraints
                const offer = await this.peerConnection.createOffer({
                    offerToReceiveVideo: false,
                    offerToReceiveAudio: false,
                    voiceActivityDetection: false,
                    iceRestart: false
                });

                // Optimize SDP for ultra-low latency
                offer.sdp = this.optimizeSDPForLowLatency(offer.sdp);
                
                await this.peerConnection.setLocalDescription(offer);
                
                // Send offer via signaling
                this.socket.emit('webrtc-offer', {
                    sessionId: this.currentSessionId,
                    offer: offer,
                    targetPeer: targetPeerId
                });

                console.log('📡 WebRTC offer sent');
                
            } else {
                console.log('🎮 Setting up controller peer connection...');
                
                // Controller: Set up to receive video and DataChannel
                this.peerConnection.ondatachannel = (event) => {
                    this.dataChannel = event.channel;
                    this.setupDataChannelEvents();
                    console.log('📨 DataChannel received');
                };
            }

        } catch (error) {
            console.error('❌ Failed to initiate peer connection:', error);
            this.showNotification('WebRTC connection failed: ' + error.message, 'error');
            throw error;
        }
    }

    setupPeerConnectionEvents() {
        if (!this.peerConnection) return;

        // ICE candidate handling
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('webrtc-ice-candidate', {
                    sessionId: this.currentSessionId,
                    candidate: event.candidate,
                    targetPeer: this.getTargetPeerId()
                });
            }
        };

        // Connection state monitoring
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log(`🔗 WebRTC connection state: ${state}`);
            
            if (state === 'connected') {
                this.socket.emit('webrtc-connected', {
                    sessionId: this.currentSessionId
                });
                this.showNotification('WebRTC P2P connected!', 'success');
                this.startWebRTCStatsMonitoring();
            } else if (state === 'disconnected' || state === 'failed') {
                this.showNotification('WebRTC connection lost', 'error');
                this.resetSession();
            }
        };

        // Track handling (for receiving video)
        this.peerConnection.ontrack = (event) => {
            console.log('📹 Received WebRTC video track');
            if (this.videoElement) {
                this.videoElement.srcObject = event.streams[0];
                this.setupVideoOptimizations();
            }
        };
    }

    setupDataChannelEvents() {
        if (!this.dataChannel) return;

        this.dataChannel.onopen = () => {
            console.log('📨 DataChannel open - ultra low-latency input ready');
            this.showNotification('Input channel ready', 'success');
        };

        this.dataChannel.onmessage = (event) => {
            if (this.isHost) {
                try {
                    const inputData = JSON.parse(event.data);
                    this.handleDataChannelInput(inputData);
                    this.webrtcStats.datachannel.messagesReceived++;
                    this.webrtcStats.datachannel.bytesReceived += event.data.length;
                } catch (error) {
                    console.error('❌ DataChannel message parsing error:', error);
                }
            }
        };

        this.dataChannel.onerror = (error) => {
            console.error('❌ DataChannel error:', error);
            this.showNotification('Input channel error', 'error');
        };

        this.dataChannel.onclose = () => {
            console.log('📨 DataChannel closed');
        };
    }

    // WebRTC Signaling Handlers
    async handleWebRTCOffer(data) {
        const { offer, fromPeer } = data;
        
        try {
            if (!this.peerConnection) {
                await this.initiatePeerConnection();
            }

            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('webrtc-answer', {
                sessionId: this.currentSessionId,
                answer: answer,
                targetPeer: fromPeer
            });

            console.log('📡 WebRTC answer sent');

        } catch (error) {
            console.error('❌ Error handling WebRTC offer:', error);
            this.showNotification('WebRTC handshake failed', 'error');
        }
    }

    async handleWebRTCAnswer(data) {
        const { answer } = data;
        
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('✅ WebRTC answer processed');
        } catch (error) {
            console.error('❌ Error handling WebRTC answer:', error);
        }
    }

    async handleICECandidate(data) {
        const { candidate } = data;
        
        try {
            if (this.peerConnection && this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error('❌ Error adding ICE candidate:', error);
        }
    }

    // FIXED: Screen Capture Implementation with multiple fallbacks
    async addScreenCaptureStream() {
        const fallbackMethods = [
            {
                name: 'Electron Desktop Capturer',
                method: () => this.addElectronScreenCapture()
            },
            {
                name: 'WebRTC getDisplayMedia',
                method: () => this.addWebRTCDisplayMedia()
            },
            {
                name: 'Canvas Fallback',
                method: () => this.addCanvasVideoStream()
            }
        ];
        
        for (const fallback of fallbackMethods) {
            try {
                console.log(`🔄 Trying ${fallback.name}...`);
                const stream = await fallback.method();
                console.log(`✅ ${fallback.name} succeeded`);
                return stream;
            } catch (error) {
                console.warn(`⚠️ ${fallback.name} failed:`, error.message);
                if (fallback === fallbackMethods[fallbackMethods.length - 1]) {
                    // Last fallback failed
                    throw new Error(`All screen capture methods failed. Last error: ${error.message}`);
                }
            }
        }
    }

    // FIXED: Electron-specific screen capture method
    async addElectronScreenCapture() {
        console.log('📹 Setting up Electron screen capture...');
        
        // Get available screen sources using the corrected API
        const sourcesResult = await window.electronAPI.getScreenSources();
        
        if (!sourcesResult || !sourcesResult.success || !sourcesResult.sources || sourcesResult.sources.length === 0) {
            throw new Error('No screen sources available: ' + (sourcesResult?.error || 'Unknown error'));
        }
        
        // Use the first screen source (usually the primary display)
        const screenSource = sourcesResult.sources.find(source => 
            source.name.includes('Screen') || source.name.includes('Entire') || source.id.includes('screen')
        ) || sourcesResult.sources[0];
        
        console.log(`📺 Using screen source: ${screenSource.name} (${screenSource.id})`);
        
        // Get screen stream using Electron's desktopCapturer
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: screenSource.id,
                    maxFrameRate: 60,
                    minFrameRate: 15
                },
                optional: [
                    { maxWidth: 1920 },
                    { maxHeight: 1080 },
                    { minWidth: 640 },
                    { minHeight: 480 }
                ]
            }
        });

        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) {
            throw new Error('No video track available in captured stream');
        }

        console.log('🎥 Video track details:', {
            id: videoTrack.id,
            kind: videoTrack.kind,
            enabled: videoTrack.enabled,
            readyState: videoTrack.readyState,
            settings: videoTrack.getSettings()
        });
        
        // Configure track for ultra-low latency
        try {
            const constraints = {
                frameRate: { ideal: 60, min: 15, max: 120 },
                width: { ideal: 1920, min: 640, max: 2560 },
                height: { ideal: 1080, min: 480, max: 1440 }
            };
            
            await videoTrack.applyConstraints(constraints);
            console.log('⚡ Applied low-latency constraints to video track');
        } catch (constraintError) {
            console.warn('⚠️ Could not apply all constraints:', constraintError.message);
        }
        
        // Add track to peer connection
        const sender = this.peerConnection.addTrack(videoTrack, stream);
        await this.optimizeVideoSender(sender);
        
        console.log('✅ Desktop capture stream added to WebRTC');
        this.showNotification('Screen sharing active', 'success');
        
        // Store stream reference for cleanup
        this.localStream = stream;
        return stream;
    }

    // FIXED: WebRTC getDisplayMedia fallback
    async addWebRTCDisplayMedia() {
        console.log('🔄 Attempting WebRTC getDisplayMedia...');
        
        // Check if getDisplayMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            throw new Error('getDisplayMedia not supported in this environment');
        }
        
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: 60, max: 120 },
                width: { ideal: 1920, max: 2560 },
                height: { ideal: 1080, max: 1440 },
                cursor: 'always'
            },
            audio: false
        });
        
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) {
            throw new Error('No video track in display media stream');
        }

        console.log('🎥 Display media track obtained:', videoTrack.getSettings());
        
        const sender = this.peerConnection.addTrack(videoTrack, stream);
        await this.optimizeVideoSender(sender);
        
        console.log('✅ Display media screen capture successful');
        this.localStream = stream;
        return stream;
    }

    // FIXED: Canvas-based fallback
    async addCanvasVideoStream() {
        console.log('🎨 Creating canvas-based video stream...');
        
        // Create a canvas element for screen capture
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        
        // Fill with a test pattern
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#00ff00';
        ctx.font = '48px Arial';
        ctx.fillText('WebRTC Screen Capture Ready', 50, 100);
        ctx.fillStyle = '#ffffff';
        ctx.font = '24px Arial';
        ctx.fillText('Waiting for screen capture...', 50, 150);
        ctx.fillText('This is a fallback canvas stream', 50, 200);
        
        // Get stream from canvas
        const stream = canvas.captureStream(30);
        
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) {
            throw new Error('Failed to create canvas video track');
        }

        const sender = this.peerConnection.addTrack(videoTrack, stream);
        await this.optimizeVideoSender(sender);
        
        console.log('✅ Canvas-based stream created');
        this.localStream = stream;
        this.showNotification('Canvas stream active (fallback mode)', 'info');
        
        return stream;
    }

    async optimizeVideoSender(sender) {
        try {
            const params = sender.getParameters();
            
            if (params.encodings && params.encodings.length > 0) {
                const encoding = params.encodings[0];
                
                // Ultra low-latency encoding parameters
                encoding.maxBitrate = 4000000; // 4 Mbps max
                encoding.maxFramerate = 60;
                encoding.scaleResolutionDownBy = 1.0;
                
                // Priority settings for real-time
                encoding.priority = 'high';
                encoding.networkPriority = 'high';
                
                console.log('⚡ Video encoding params:', encoding);
                await sender.setParameters(params);
            }
            
            // Configure codec preferences for H.264 hardware encoding
            const transceivers = this.peerConnection.getTransceivers();
            const videoTransceiver = transceivers.find(t => 
                t.sender === sender && t.receiver.track && t.receiver.track.kind === 'video'
            );
            
            if (videoTransceiver) {
                const capabilities = RTCRtpReceiver.getCapabilities('video');
                const h264Codecs = capabilities.codecs.filter(codec => 
                    codec.mimeType.toLowerCase().includes('h264')
                );
                
                if (h264Codecs.length > 0) {
                    await videoTransceiver.setCodecPreferences(h264Codecs);
                    console.log('🎯 H.264 codec preferred for hardware acceleration');
                }
            }
            
            console.log('⚡ Video sender optimized for ultra-low latency');
        } catch (error) {
            console.error('❌ Video sender optimization failed:', error);
        }
    }

    // Video Element Optimizations
    setupVideoOptimizations() {
        if (!this.videoElement) return;

        // Ultra low-latency video playback settings
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        this.videoElement.autoplay = true;
        
        // Minimize buffering
        this.videoElement.preload = 'none';
        
        // Frame skipping for real-time performance
        this.videoElement.addEventListener('loadedmetadata', () => {
            console.log('📹 Video metadata loaded');
            this.hideConnectionOverlay();
        });

        this.videoElement.addEventListener('timeupdate', () => {
            if (this.frameSkipping.enabled) {
                this.handleFrameSkipping();
            }
        });

        // Performance monitoring
        this.videoElement.addEventListener('playing', () => {
            console.log('📹 Video playback started');
            this.performance.frameLatency = Date.now() - this.performance.connectionStartTime;
            this.startFrameLatencyMonitoring();
        });
    }

    handleFrameSkipping() {
        if (!this.videoElement) return;

        const currentTime = this.videoElement.currentTime;
        const buffered = this.videoElement.buffered;
        
        if (buffered.length > 0) {
            const bufferEnd = buffered.end(buffered.length - 1);
            const bufferSize = bufferEnd - currentTime;
            
            // Skip frames if buffer is too large
            if (bufferSize > this.frameSkipping.maxBufferTime / 1000) {
                this.videoElement.currentTime = bufferEnd - (this.frameSkipping.targetLatency / 1000);
                this.frameSkipping.framesSkipped++;
                
                console.log(`⏩ Skipped frames, buffer: ${Math.round(bufferSize * 1000)}ms`);
            }
        }
    }

    // Input Event Handling with DataChannel
    setupInputBuffering() {
        // Process input buffer every 8ms for ultra-responsive input
        setInterval(() => {
            this.processInputBuffer();
        }, this.inputBuffer.batchInterval);
    }

    processInputBuffer() {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
        
        const now = performance.now();
        
        // Send mouse events
        if (this.inputBuffer.mouse.length > 0) {
            const mouseEvents = this.inputBuffer.mouse.splice(0, this.inputBuffer.maxBuffer);
            
            for (const event of mouseEvents) {
                this.sendDataChannelInput(event);
            }
        }

        // Send keyboard events (higher priority)
        if (this.inputBuffer.keyboard.length > 0) {
            const keyboardEvents = this.inputBuffer.keyboard.splice(0, this.inputBuffer.maxBuffer);
            
            for (const event of keyboardEvents) {
                this.sendDataChannelInput(event);
            }
        }

        this.inputBuffer.lastSend = now;
    }

    sendDataChannelInput(inputData) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

        try {
            const message = JSON.stringify({
                ...inputData,
                timestamp: performance.now()
            });
            
            this.dataChannel.send(message);
            this.webrtcStats.datachannel.messagesSent++;
            this.webrtcStats.datachannel.bytesSent += message.length;
            
            // Track input latency
            this.performance.inputLatency = performance.now() - inputData.clientTimestamp;

        } catch (error) {
            console.error('❌ DataChannel send error:', error);
        }
    }

    handleDataChannelInput(inputData) {
        // Handle input received via DataChannel (host side)
        const latency = performance.now() - inputData.timestamp;
        
        try {
            switch (inputData.type) {
                case 'mousemove':
                    window.electronAPI.simulateMouseMove(inputData.x, inputData.y, inputData.sensitivity);
                    break;
                case 'mousedown':
                case 'mouseup':
                    window.electronAPI.simulateMouseClick(inputData.x, inputData.y, inputData.button, inputData.type.replace('mouse', ''));
                    break;
                case 'wheel':
                    window.electronAPI.simulateMouseWheel(inputData.deltaY, inputData.deltaX);
                    break;
                case 'keydown':
                case 'keyup':
                    window.electronAPI.simulateKeyPress(inputData);
                    break;
            }
            
            console.log(`⚡ Input processed: ${inputData.type} (${Math.round(latency)}ms latency)`);
        } catch (error) {
            console.error('❌ Input simulation error:', error);
        }
    }

    // Mouse and Keyboard Event Handlers (optimized for DataChannel)
    handleOptimizedMouseMove(e) {
        if (!this.isController || !this.dataChannel) return;

        e.preventDefault();
        const pos = this.getVideoPosition(e);
        const now = performance.now();

        // Add to input buffer instead of immediate send
        this.inputBuffer.mouse.push({
            type: 'mousemove',
            x: pos.x * this.settings.mouseSensitivity,
            y: pos.y * this.settings.mouseSensitivity,
            sensitivity: this.settings.mouseSensitivity,
            clientTimestamp: now
        });

        // Limit buffer size
        if (this.inputBuffer.mouse.length > this.inputBuffer.maxBuffer * 2) {
            this.inputBuffer.mouse = this.inputBuffer.mouse.slice(-this.inputBuffer.maxBuffer);
        }

        this.updateLocalMousePosition(pos);
    }

    handleOptimizedMouseClick(e) {
        if (!this.isController || !this.dataChannel) return;

        e.preventDefault();
        const pos = this.getVideoPosition(e);
        const now = performance.now();

        // High priority - send immediately for clicks
        const inputData = {
            type: e.type,
            x: pos.x,
            y: pos.y,
            button: e.button,
            sensitivity: this.settings.mouseSensitivity,
            clientTimestamp: now
        };

        this.sendDataChannelInput(inputData);
    }

    handleOptimizedMouseWheel(e) {
        if (!this.isController || !this.dataChannel) return;

        e.preventDefault();
        const now = performance.now();

        const inputData = {
            type: 'wheel',
            deltaX: e.deltaX,
            deltaY: e.deltaY,
            clientTimestamp: now
        };

        this.sendDataChannelInput(inputData);
    }

    handleOptimizedKeyDown(e) {
        if (!this.isController || !this.dataChannel) return;
        if (this.shouldAllowBrowserShortcut(e)) return;

        e.preventDefault();
        const now = performance.now();

        // High priority keyboard events
        this.inputBuffer.keyboard.push({
            type: 'keydown',
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            clientTimestamp: now
        });
    }

    handleOptimizedKeyUp(e) {
        if (!this.isController || !this.dataChannel) return;
        if (this.shouldAllowBrowserShortcut(e)) return;

        e.preventDefault();
        const now = performance.now();

        this.inputBuffer.keyboard.push({
            type: 'keyup',
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            clientTimestamp: now
        });
    }

    shouldAllowBrowserShortcut(e) {
        const allowedShortcuts = ['F12', 'F5'];
        if (allowedShortcuts.includes(e.key)) return true;
        if (e.ctrlKey && e.shiftKey && e.key === 'I') return true;
        if (e.ctrlKey && e.key === 'r') return true;
        return false;
    }

    getVideoPosition(e) {
        const rect = this.videoElement.getBoundingClientRect();
        const scaleX = this.videoElement.videoWidth / rect.width;
        const scaleY = this.videoElement.videoHeight / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    updateLocalMousePosition(pos) {
        const localCursor = document.getElementById('localCursor');
        if (localCursor) {
            localCursor.style.left = `${pos.x}px`;
            localCursor.style.top = `${pos.y}px`;
        }
    }

    // Session Management
    async createSession() {
        if (!this.socket?.connected) {
            this.showNotification('Not connected to signaling server', 'error');
            return;
        }

        try {
            const platformInfo = await window.electronAPI.getPlatform();
            
            this.socket.emit('create-session', {
                platform: `${platformInfo.platform}-${platformInfo.arch}`,
                webrtcCapabilities: {
                    h264: true,
                    datachannel: true,
                    ultraLowLatency: true
                }
            });
        } catch (error) {
            console.error('❌ Create session error:', error);
            this.showNotification('Failed to create session', 'error');
        }
    }

    async joinSession(sessionId, password) {
        if (!this.socket?.connected) {
            this.showNotification('Not connected to signaling server', 'error');
            return;
        }

        try {
            const platformInfo = await window.electronAPI.getPlatform();

            this.socket.emit('join-webrtc-session', {
                sessionId,
                password,
                webrtcCapabilities: {
                    h264: true,
                    datachannel: true,
                    frameSkipping: true
                }
            });
        } catch (error) {
            console.error('❌ Join session error:', error);
            this.showNotification('Failed to join session', 'error');
        }
    }

    // Session Event Handlers
    handleSessionCreated(data) {
        this.currentSessionId = data.sessionId;
        this.currentPassword = data.password;
        this.isHost = true;

        // Update UI
        const sessionIdEl = document.getElementById('sessionId');
        const passwordEl = document.getElementById('sessionPassword');
        
        if (sessionIdEl) sessionIdEl.textContent = data.sessionId;
        if (passwordEl) passwordEl.textContent = data.password;
        
        this.showCreationStep(2);
        this.showNotification(`WebRTC session created: ${data.sessionId}`, 'success');
    }

    async handleHostReady(data) {
        this.showCreationStep(3);
        const activeSessionEl = document.getElementById('activeSessionId');
        if (activeSessionEl) {
            activeSessionEl.textContent = this.currentSessionId;
        }
        
        // Start WebRTC screen capture with error handling
        try {
            const result = await window.electronAPI.startWebRTCCapture({
                fps: 60,
                quality: 80,
                bitrate: '4000k',
                rtpDestination: '127.0.0.1'
            });

            if (result.success) {
                this.showNotification('WebRTC capture started', 'success');
            } else {
                this.showNotification('Failed to start capture: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('❌ WebRTC capture error:', error);
            this.showNotification('Screen capture failed', 'error');
        }
    }

    async handleJoinReady(data) {
        this.isController = true;
        this.currentSessionId = data.sessionInfo.id;
        
        // Switch to control screen
        this.showScreen('controlScreen');
        const controlSessionEl = document.getElementById('controlSessionId');
        if (controlSessionEl) {
            controlSessionEl.textContent = this.currentSessionId;
        }
        
        // Setup video element for WebRTC stream
        this.setupVideoElement();
        
        // Initiate WebRTC connection
        try {
            await this.initiatePeerConnection();
            this.showNotification('Joining WebRTC session...', 'info');
        } catch (error) {
            console.error('❌ WebRTC connection failed:', error);
            this.showNotification('Failed to establish WebRTC connection', 'error');
        }
    }

    setupVideoElement() {
        this.videoElement = document.getElementById('remoteVideo');
        if (!this.videoElement) {
            console.error('❌ Video element not found');
            this.showNotification('Video element not found', 'error');
            return;
        }

        // Setup input handlers on video element
        this.setupVideoInputHandlers();
        
        // Show connection overlay
        this.showConnectionOverlay();
    }

    setupVideoInputHandlers() {
        if (!this.videoElement) return;

        // Mouse events
        this.videoElement.addEventListener('mousemove', (e) => this.handleOptimizedMouseMove(e));
        this.videoElement.addEventListener('mousedown', (e) => this.handleOptimizedMouseClick(e));
        this.videoElement.addEventListener('mouseup', (e) => this.handleOptimizedMouseClick(e));
        this.videoElement.addEventListener('wheel', (e) => this.handleOptimizedMouseWheel(e));
        this.videoElement.addEventListener('contextmenu', (e) => e.preventDefault());

        // Keyboard events
        this.videoElement.setAttribute('tabindex', '0');
        this.videoElement.addEventListener('keydown', (e) => this.handleOptimizedKeyDown(e));
        this.videoElement.addEventListener('keyup', (e) => this.handleOptimizedKeyUp(e));

        // Focus for keyboard input
        this.videoElement.focus();
    }

    // Performance Monitoring
    startPerformanceMonitoring() {
        setInterval(() => {
            this.updatePerformanceDisplay();
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

    startFrameLatencyMonitoring() {
        setInterval(() => {
            if (this.videoElement && this.videoElement.currentTime > 0) {
                // Calculate frame latency (simplified)
                const now = Date.now();
                this.performance.frameLatency = now - this.performance.lastFrameTime;
                this.performance.lastFrameTime = now;
            }
        }, 100);
    }

    startWebRTCStatsMonitoring() {
        if (!this.peerConnection) return;

        setInterval(async () => {
            try {
                const stats = await this.peerConnection.getStats();
                this.processWebRTCStats(stats);
            } catch (error) {
                console.error('❌ WebRTC stats error:', error);
            }
        }, 1000);
    }

    processWebRTCStats(stats) {
        stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                const prevStats = this.webrtcStats.video;
                
                // Calculate rates
                const bytesReceived = report.bytesReceived || 0;
                const packetsReceived = report.packetsReceived || 0;
                const packetsLost = report.packetsLost || 0;
                const framesDecoded = report.framesDecoded || 0;
                const framesDropped = report.framesDropped || 0;

                // Update stats
                this.webrtcStats.video = {
                    bytesReceived,
                    packetsReceived,
                    packetsLost,
                    framesDecoded,
                    framesDropped,
                    totalDecodeTime: report.totalDecodeTime || 0
                };

                // Calculate bandwidth (bytes per second)
                if (prevStats.bytesReceived > 0) {
                    this.performance.bandwidth = (bytesReceived - prevStats.bytesReceived) * 8; // bits per second
                }

                // Calculate packet loss percentage
                if (packetsReceived > 0) {
                    this.performance.packetLoss = (packetsLost / (packetsReceived + packetsLost)) * 100;
                }

                // Update UI
                this.updateWebRTCStatsDisplay();
            }
        });
    }

    // UI Management and Display Updates
    updatePerformanceDisplay() {
        // Calculate end-to-end latency
        this.performance.endToEndLatency = this.performance.signaling + 
                                           this.performance.frameLatency + 
                                           this.performance.inputLatency;

        // Update displays
        this.updateLatencyDisplay();
        this.updateFPSDisplay();
        this.updateBandwidthDisplay();
    }

    updateLatencyDisplay() {
        const latencyElements = ['controlLatency', 'perfLatency'];
        latencyElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const latency = Math.round(this.performance.endToEndLatency);
                element.textContent = `${latency} ms`;
                
                // Color coding for <50ms target
                if (latency <= 30) {
                    element.style.color = '#00ff00'; // Green - Excellent
                } else if (latency <= 50) {
                    element.style.color = '#ffaa00'; // Orange - Target achieved
                } else {
                    element.style.color = '#ff0000'; // Red - Above target
                }
            }
        });
    }

    updateSignalingLatencyDisplay() {
        const element = document.getElementById('signalingLatency');
        if (element) {
            element.textContent = `${Math.round(this.performance.signaling)} ms`;
        }
    }

    updateFPSDisplay() {
        const element = document.getElementById('webrtcFps');
        if (element && this.videoElement) {
            // Estimate FPS from video element
            const fps = this.videoElement.getVideoPlaybackQuality?.().totalVideoFrames || 0;
            element.textContent = `${fps} FPS`;
        }
    }

    updateBandwidthDisplay() {
        const element = document.getElementById('webrtcBandwidth');
        if (element) {
            const mbps = (this.performance.bandwidth / 1000000).toFixed(2);
            element.textContent = `${mbps} Mbps`;
        }
    }

    updateWebRTCStatsDisplay() {
        const packetLossElement = document.getElementById('packetLoss');
        if (packetLossElement) {
            packetLossElement.textContent = `${this.performance.packetLoss.toFixed(1)}%`;
        }

        const framesSkippedElement = document.getElementById('framesSkipped');
        if (framesSkippedElement) {
            framesSkippedElement.textContent = this.frameSkipping.framesSkipped.toString();
        }
    }

    // Utility Functions
    getTargetPeerId() {
        // Return the appropriate target peer ID for signaling
        if (this.isHost && this.socket) {
            // For host, target is the first controller
            return this.currentSessionId; // Simplified - should track actual peer IDs
        } else {
            return null; // Controller sends to host
        }
    }

    closePeerConnection() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
    }

    resetSession() {
        this.currentSessionId = null;
        this.currentPassword = null;
        this.isHost = false;
        this.isController = false;
        
        // Cleanup video streams
        this.cleanupLocalStream();
        
        this.closePeerConnection();
        this.stopLatencyMonitoring();
        this.hideConnectionOverlay();
        
        // Reset UI
        this.showCreationStep(1);
        
        // Stop WebRTC capture if host
        if (this.isHost) {
            window.electronAPI.stopWebRTCCapture();
        }
    }

    handleSessionEnded() {
        this.showNotification('WebRTC session ended', 'warning');
        this.resetSession();
        this.showScreen('welcomeScreen');
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
        this.showNotification('Disconnected from WebRTC session', 'info');
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

    // UI Helper Functions
    async loadPlatformInfo() {
        try {
            const platformInfo = await window.electronAPI.getPlatform();
            const version = await window.electronAPI.getAppVersion();

            const platformEl = document.getElementById('platformInfo');
            const versionEl = document.getElementById('versionInfo');

            if (platformEl) {
                platformEl.textContent = `${platformInfo.platform} ${platformInfo.arch}`;
            }
            if (versionEl) {
                versionEl.textContent = `v${version} (WebRTC P2P)`;
            }

            console.log('📋 Platform:', platformInfo);
        } catch (error) {
            console.error('Failed to load platform info:', error);
        }
    }

    async loadSettings() {
        try {
            const defaultSettings = {
                serverUrl: 'https://testbackend-hbo4.onrender.com',
                quality: 'balanced',
                mouseSensitivity: 1.0,
                webrtcEnabled: true,
                frameSkipping: true,
                ultraLowLatency: true,
                targetLatency: 50,
                inputBuffering: 8,
                connectionTimeout: 10
            };

            for (const [key, defaultValue] of Object.entries(defaultSettings)) {
                const value = await window.electronAPI.getSetting(key);
                this.settings[key] = value !== undefined ? value : defaultValue;
            }

            // Apply settings to components
            this.frameSkipping.enabled = this.settings.frameSkipping;
            this.frameSkipping.targetLatency = this.settings.targetLatency;
            this.inputBuffer.batchInterval = this.settings.inputBuffering;

            this.applySettingsToUI();
            console.log('⚙️ WebRTC settings loaded:', this.settings);
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.settings = {
                serverUrl: 'https://testbackend-hbo4.onrender.com',
                mouseSensitivity: 1.0,
                frameSkipping: true,
                targetLatency: 50
            };
        }
    }

    applySettingsToUI() {
        const serverUrlInput = document.getElementById('serverUrl');
        if (serverUrlInput) {
            serverUrlInput.value = this.settings.serverUrl;
        }

        const mouseSensitivitySlider = document.getElementById('mouseSensitivity');
        const sensitivityValue = document.getElementById('sensitivityValue');
        if (mouseSensitivitySlider && sensitivityValue) {
            mouseSensitivitySlider.value = this.settings.mouseSensitivity;
            sensitivityValue.textContent = `${this.settings.mouseSensitivity}x`;
        }
    }

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
                await this.connectToSignalingServer(this.settings.serverUrl);
                await this.createSession();
            } catch (error) {
                console.error('❌ Create session failed:', error);
                this.showNotification('Failed to create WebRTC session: ' + error.message, 'error');
            }
        });

        document.getElementById('startHostingBtn')?.addEventListener('click', () => {
            if (this.socket?.connected && this.currentSessionId) {
                this.socket.emit('start-webrtc-host', {
                    sessionId: this.currentSessionId,
                    password: this.currentPassword,
                    rtpPort: 5004 // From FFmpeg RTP stream
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
            const sessionIdInput = document.getElementById('joinSessionId');
            const passwordInput = document.getElementById('joinPassword');
            
            const sessionId = sessionIdInput?.value;
            const password = passwordInput?.value;

            if (!sessionId || !password) {
                this.showNotification('Please enter session ID and password', 'error');
                return;
            }

            try {
                await this.connectToSignalingServer(this.settings.serverUrl);
                await this.joinSession(sessionId, password);
            } catch (error) {
                console.error('❌ Join session failed:', error);
                this.showNotification('Failed to join WebRTC session: ' + error.message, 'error');
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
            const sensitivityValueEl = document.getElementById('sensitivityValue');
            if (sensitivityValueEl) {
                sensitivityValueEl.textContent = `${e.target.value}x`;
            }
            window.electronAPI.setSetting('mouseSensitivity', this.settings.mouseSensitivity);
        });

        // WebRTC specific settings
        document.getElementById('frameSkippingToggle')?.addEventListener('change', (e) => {
            this.frameSkipping.enabled = e.target.checked;
            window.electronAPI.setSetting('frameSkipping', this.frameSkipping.enabled);
        });

        document.getElementById('targetLatency')?.addEventListener('input', (e) => {
            this.frameSkipping.targetLatency = parseInt(e.target.value);
            const latencyValueEl = document.getElementById('latencyValue');
            if (latencyValueEl) {
                latencyValueEl.textContent = `${e.target.value}ms`;
            }
            window.electronAPI.setSetting('targetLatency', this.frameSkipping.targetLatency);
        });

        // Server configuration
        document.getElementById('serverConfigToggle')?.addEventListener('click', () => {
            const serverConfig = document.getElementById('serverConfig');
            if (serverConfig) {
                serverConfig.classList.toggle('show');
            }
        });

        document.getElementById('closeServerConfig')?.addEventListener('click', () => {
            const serverConfig = document.getElementById('serverConfig');
            if (serverConfig) {
                serverConfig.classList.remove('show');
            }
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
                case 'webrtc-settings':
                    this.showModal('webrtcModal');
                    break;
                case 'webrtc-info':
                    this.showWebRTCInfo();
                    break;
                case 'test-connection':
                    this.testConnection();
                    break;
            }
        });
    }

    initializeUI() {
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

        // WebRTC settings
        const frameSkippingToggle = document.getElementById('frameSkippingToggle');
        if (frameSkippingToggle) {
            frameSkippingToggle.checked = this.frameSkipping.enabled;
        }

        const targetLatencySlider = document.getElementById('targetLatency');
        const latencyValue = document.getElementById('latencyValue');
        if (targetLatencySlider && latencyValue) {
            targetLatencySlider.value = this.frameSkipping.targetLatency;
            latencyValue.textContent = `${this.frameSkipping.targetLatency}ms`;
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
            overlay.innerHTML = `
                <div class="overlay-content">
                    <div class="spinner"></div>
                    <h3>Establishing WebRTC Connection</h3>
                    <p>Setting up peer-to-peer video stream...</p>
                    <div class="connection-steps">
                        <div class="step">✓ Signaling connected</div>
                        <div class="step active">🔄 WebRTC handshake</div>
                        <div class="step">⏳ Video stream</div>
                        <div class="step">⏳ Input channel</div>
                    </div>
                </div>
            `;
        }
    }

    hideConnectionOverlay() {
        const overlay = document.getElementById('connectionOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    showWebRTCInfo() {
        const info = `
WebRTC Ultra Low-Latency Remote Desktop

🎯 Target Latency: <50ms end-to-end
📹 Video: P2P H.264 streaming  
⌨️  Input: DataChannel (no server relay)
🔧 Features: Frame skipping, adaptive quality
📊 Monitoring: Real-time performance stats

Current Performance:
• Signaling: ${Math.round(this.performance.signaling)}ms
• Frame: ${Math.round(this.performance.frameLatency)}ms  
• Input: ${Math.round(this.performance.inputLatency)}ms
• Total: ${Math.round(this.performance.endToEndLatency)}ms

WebRTC Stats:
• Bandwidth: ${(this.performance.bandwidth / 1000000).toFixed(2)} Mbps
• Packet Loss: ${this.performance.packetLoss.toFixed(1)}%
• Frames Skipped: ${this.frameSkipping.framesSkipped}
        `;

        alert(info);
    }

    async testConnection() {
        const serverUrl = document.getElementById('serverUrl')?.value || this.settings.serverUrl;
        const statusEl = document.getElementById('connectionStatus');
        const testBtn = document.getElementById('testConnectionBtn');
        
        if (statusEl) statusEl.textContent = 'Testing...';
        if (testBtn) testBtn.disabled = true;

        try {
            const response = await fetch(serverUrl + '/health', {
                method: 'GET',
                timeout: 5000
            });
            
            if (response.ok) {
                const data = await response.json();
                if (statusEl) {
                    statusEl.textContent = `✅ WebRTC Ready (${data.sessions} sessions)`;
                    statusEl.style.color = '#00ff00';
                }
            } else {
                throw new Error(`Server responded with ${response.status}`);
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
        const serverUrlInput = document.getElementById('serverUrl');
        const serverUrl = serverUrlInput?.value;

        if (serverUrl) {
            this.settings.serverUrl = serverUrl;
            await window.electronAPI.setSetting('serverUrl', serverUrl);
        }

        this.showNotification('WebRTC configuration saved', 'success');
        const serverConfig = document.getElementById('serverConfig');
        if (serverConfig) {
            serverConfig.classList.remove('show');
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    }

    takeScreenshot() {
        if (!this.videoElement) {
            this.showNotification('No video available for screenshot', 'error');
            return;
        }
        
        try {
            // Create canvas to capture video frame
            const canvas = document.createElement('canvas');
            canvas.width = this.videoElement.videoWidth;
            canvas.height = this.videoElement.videoHeight;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(this.videoElement, 0, 0);
            
            const link = document.createElement('a');
            link.download = `webrtc-screenshot-${Date.now()}.png`;
            link.href = canvas.toDataURL();
            link.click();
            
            this.showNotification('Screenshot saved', 'success');
        } catch (error) {
            console.error('❌ Screenshot error:', error);
            this.showNotification('Screenshot failed', 'error');
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
        if (!container) {
            console.log(`Notification: ${message} (${type})`);
            return;
        }

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
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);

        // Manual close
        const closeBtn = notification.querySelector('.notification-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                notification.remove();
            });
        }
    }

    // Key combination sending (for special shortcuts)
    sendKeyCombo(keys) {
        if (!this.isController || !this.dataChannel || this.dataChannel.readyState !== 'open') return;

        const inputData = {
            type: 'key-combination',
            keys: keys,
            clientTimestamp: performance.now()
        };

        this.sendDataChannelInput(inputData);
        this.showNotification(`Sent: ${keys.join('+')}`, 'info');
    }
}

// Global utility functions
window.copySessionId = async function() {
    const sessionIdEl = document.getElementById('sessionId');
    const sessionId = sessionIdEl?.textContent;
    
    if (sessionId && window.app) {
        try {
            await navigator.clipboard.writeText(sessionId);
            window.app.showNotification('Session ID copied to clipboard', 'success');
        } catch (error) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = sessionId;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            window.app.showNotification('Session ID copied to clipboard', 'success');
        }
    }
};

window.copyPassword = async function() {
    const passwordEl = document.getElementById('sessionPassword');
    const password = passwordEl?.textContent;
    
    if (password && window.app) {
        try {
            await navigator.clipboard.writeText(password);
            window.app.showNotification('Password copied to clipboard', 'success');
        } catch (error) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = password;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            window.app.showNotification('Password copied to clipboard', 'success');
        }
    }
};

window.sendKeyCombo = function(keys) {
    if (window.app) {
        window.app.sendKeyCombo(keys);
    }
};

// Initialize WebRTC Remote Desktop Application
document.addEventListener('DOMContentLoaded', () => {
    console.log('🌟 Starting WebRTC Remote Desktop (Ultra Low-Latency)...');
    
    // Add error handler for uncaught errors
    window.addEventListener('error', (event) => {
        console.error('❌ Uncaught error:', event.error);
        if (window.app) {
            window.app.showNotification('Application error occurred', 'error');
        }
    });

    // Add unhandled promise rejection handler
    window.addEventListener('unhandledrejection', (event) => {
        console.error('❌ Unhandled promise rejection:', event.reason);
        if (window.app) {
            window.app.showNotification('Promise rejection occurred', 'error');
        }
        event.preventDefault();
    });

    try {
        window.app = new WebRTCRemoteDesktopApp();
    } catch (error) {
        console.error('❌ Failed to initialize WebRTC app:', error);
        alert('Failed to initialize WebRTC Remote Desktop: ' + error.message);
    }
});