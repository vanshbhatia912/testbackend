const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods for WebRTC Remote Desktop
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Settings management
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),

  // Dialog methods
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),

  // Menu actions
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (event, action) => callback(action));
  },

  // WebRTC Screen Capture APIs (replacing FFmpeg direct capture)
  createRTPServer: () => ipcRenderer.invoke('create-rtp-server'),
  startWebRTCCapture: (options) => ipcRenderer.invoke('start-webrtc-capture', options),
  stopWebRTCCapture: () => ipcRenderer.invoke('stop-webrtc-capture'),
  getWebRTCStats: () => ipcRenderer.invoke('get-webrtc-stats'),

  // WebRTC streaming event handlers
  onRTPPacket: (callback) => {
    ipcRenderer.on('rtp-packet-received', (event, packetData) => callback(packetData));
  },
  onWebRTCPerformanceStats: (callback) => {
    ipcRenderer.on('webrtc-performance-stats', (event, stats) => callback(stats));
  },
  onWebRTCStreamError: (callback) => {
    ipcRenderer.on('webrtc-stream-error', (event, error) => callback(error));
  },

  // Input Control APIs (unchanged - still using Nut.js)
  simulateMouseMove: (x, y, sensitivity) => ipcRenderer.invoke('simulate-mouse-move', { x, y, sensitivity }),
  simulateMouseClick: (x, y, button, type) => ipcRenderer.invoke('simulate-mouse-click', { x, y, button, type }),
  simulateMouseWheel: (deltaY, deltaX) => ipcRenderer.invoke('simulate-mouse-wheel', { deltaY, deltaX }),
  simulateKeyPress: (keyData) => ipcRenderer.invoke('simulate-key-press', keyData),
  simulateKeyCombo: (keys) => ipcRenderer.invoke('simulate-key-combo', keys),

  // Screen information
  getScreenInfo: () => ipcRenderer.invoke('get-screen-info'),
  
  // FFmpeg utilities (for WebRTC compatibility check)
  checkFFmpegAvailability: () => ipcRenderer.invoke('check-ffmpeg-availability'),

  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

// WebRTC utilities for peer connections
contextBridge.exposeInMainWorld('webrtcUtils', {
  // Create RTCPeerConnection with optimal settings for low latency
  createPeerConnection: (iceServers = []) => {
    const defaultConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        ...iceServers
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all'
    };
    
    return new RTCPeerConnection(defaultConfig);
  },

  // Create data channel with optimized settings for input events
  createDataChannel: (peerConnection, label = 'inputs', options = {}) => {
    const defaultOptions = {
      ordered: false, // Allow out-of-order delivery for lower latency
      maxRetransmits: 0, // No retransmissions for real-time data
      maxPacketLifeTime: 100, // 100ms max lifetime
      protocol: 'inputs-v1',
      ...options
    };
    
    return peerConnection.createDataChannel(label, defaultOptions);
  },

  // Get WebRTC statistics
  getConnectionStats: async (peerConnection) => {
    const stats = await peerConnection.getStats();
    const result = {
      video: {},
      audio: {},
      datachannel: {},
      connection: {}
    };

    stats.forEach((report) => {
      switch (report.type) {
        case 'outbound-rtp':
          if (report.mediaType === 'video') {
            result.video.outbound = {
              packetsSent: report.packetsSent,
              bytesSent: report.bytesSent,
              framesEncoded: report.framesEncoded,
              framesSent: report.framesSent,
              keyFramesEncoded: report.keyFramesEncoded,
              totalEncodeTime: report.totalEncodeTime,
              qualityLimitationReason: report.qualityLimitationReason
            };
          }
          break;
        case 'inbound-rtp':
          if (report.mediaType === 'video') {
            result.video.inbound = {
              packetsReceived: report.packetsReceived,
              bytesReceived: report.bytesReceived,
              framesDecoded: report.framesDecoded,
              framesReceived: report.framesReceived,
              keyFramesDecoded: report.keyFramesDecoded,
              totalDecodeTime: report.totalDecodeTime,
              jitter: report.jitter
            };
          }
          break;
        case 'data-channel':
          result.datachannel[report.label] = {
            messagesSent: report.messagesSent,
            messagesReceived: report.messagesReceived,
            bytesSent: report.bytesSent,
            bytesReceived: report.bytesReceived,
            state: report.state
          };
          break;
        case 'candidate-pair':
          if (report.state === 'succeeded') {
            result.connection.rtt = report.currentRoundTripTime * 1000; // Convert to ms
            result.connection.availableOutgoingBitrate = report.availableOutgoingBitrate;
            result.connection.availableIncomingBitrate = report.availableIncomingBitrate;
          }
          break;
      }
    });

    return result;
  },

  // Frame skipping utility - always render latest frame
  createFrameSkipper: () => {
    let latestFrame = null;
    let isProcessing = false;
    let frameQueue = [];
    let droppedFrames = 0;

    return {
      addFrame: (frameData) => {
        // Drop old frames, keep only the latest
        if (frameQueue.length > 2) {
          droppedFrames += frameQueue.length - 1;
          frameQueue = [frameQueue[frameQueue.length - 1]];
        }
        
        frameQueue.push({
          data: frameData,
          timestamp: performance.now()
        });
        
        if (!isProcessing) {
          processNextFrame();
        }
      },
      
      getStats: () => ({
        droppedFrames,
        queueLength: frameQueue.length,
        isProcessing
      })
    };
    
    async function processNextFrame() {
      if (frameQueue.length === 0) {
        isProcessing = false;
        return;
      }
      
      isProcessing = true;
      const frame = frameQueue.shift();
      
      // Process frame (this would be handled by the renderer)
      latestFrame = frame;
      
      // Immediately check for next frame
      setTimeout(processNextFrame, 0);
    }
  }
});

// Utility functions (enhanced for WebRTC)
contextBridge.exposeInMainWorld('utils', {
  // Generate session ID
  generateSessionId: () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },

  // Generate password
  generatePassword: (length = 8) => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  },

  // Copy to clipboard
  copyToClipboard: async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    }
  },

  // Format bytes
  formatBytes: (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  },

  // Get timestamp
  getTimestamp: () => new Date().toLocaleString(),

  // Debounce function for input throttling
  debounce: (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Throttle function for high-frequency events
  throttle: (func, limit) => {
    let lastFunc;
    let lastRan;
    return function() {
      const context = this;
      const args = arguments;
      if (!lastRan) {
        func.apply(context, args);
        lastRan = Date.now();
      } else {
        clearTimeout(lastFunc);
        lastFunc = setTimeout(function() {
          if ((Date.now() - lastRan) >= limit) {
            func.apply(context, args);
            lastRan = Date.now();
          }
        }, limit - (Date.now() - lastRan));
      }
    }
  },

  // WebRTC-specific utilities
  arrayBufferToBase64: (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  },

  base64ToArrayBuffer: (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  },

  // Input event serialization for DataChannel
  serializeInputEvent: (event) => {
    return JSON.stringify({
      type: event.type,
      data: event.data,
      timestamp: performance.now(),
      priority: event.priority || 5
    });
  },

  deserializeInputEvent: (serializedEvent) => {
    try {
      return JSON.parse(serializedEvent);
    } catch (error) {
      console.error('Failed to deserialize input event:', error);
      return null;
    }
  }
});

// Enhanced constants with WebRTC settings
contextBridge.exposeInMainWorld('constants', {
  QUALITY_OPTIONS: [
    { 
      value: 'low', 
      label: 'Low Quality (15 FPS)', 
      fps: 15, 
      crf: 28,
      preset: 'ultrafast',
      bitrate: '500k',
      resolution: '1280x720'
    },
    { 
      value: 'medium', 
      label: 'Medium Quality (30 FPS)', 
      fps: 30, 
      crf: 23,
      preset: 'ultrafast',
      bitrate: '1500k',
      resolution: '1920x1080'
    },
    { 
      value: 'high', 
      label: 'High Quality (45 FPS)', 
      fps: 45, 
      crf: 20,
      preset: 'veryfast',
      bitrate: '3000k',
      resolution: '1920x1080'
    },
    { 
      value: 'ultra', 
      label: 'Ultra Quality (60 FPS)', 
      fps: 60, 
      crf: 18,
      preset: 'fast',
      bitrate: '5000k',
      resolution: '2560x1440'
    }
  ],

  DEFAULT_SETTINGS: {
    serverUrl: 'https://testbackend-hbo4.onrender.com',
    quality: 'medium',
    autoConnect: true,
    notifications: true,
    connectionTimeout: 10,
    darkMode: true,
    mouseSensitivity: 1.0,
    keyboardLayout: 'auto',
    // WebRTC specific settings
    useWebRTC: true,
    preferH264Hardware: true,
    enableDataChannels: true,
    frameSkipping: true,
    udpOnly: true,
    iceServers: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ]
  },

  // WebRTC configuration presets
  WEBRTC_PRESETS: {
    ultraLowLatency: {
      video: {
        codec: 'H264',
        profile: 'baseline',
        level: '3.0',
        maxBitrate: 2000000,
        maxFramerate: 30,
        scaleResolutionDownBy: 1
      },
      dataChannel: {
        ordered: false,
        maxRetransmits: 0,
        maxPacketLifeTime: 50
      }
    },
    balanced: {
      video: {
        codec: 'H264',
        profile: 'main',
        level: '3.1',
        maxBitrate: 3000000,
        maxFramerate: 45,
        scaleResolutionDownBy: 1
      },
      dataChannel: {
        ordered: false,
        maxRetransmits: 1,
        maxPacketLifeTime: 100
      }
    },
    quality: {
      video: {
        codec: 'H264',
        profile: 'high',
        level: '4.0',
        maxBitrate: 5000000,
        maxFramerate: 60,
        scaleResolutionDownBy: 1
      },
      dataChannel: {
        ordered: true,
        maxRetransmits: 3,
        maxPacketLifeTime: 200
      }
    }
  },

  // Input event priorities (lower number = higher priority)
  INPUT_PRIORITIES: {
    KEYBOARD: 1,
    MOUSE_CLICK: 2,
    MOUSE_MOVE: 3,
    SCROLL: 4,
    GESTURE: 5
  },

  // Platform-specific shortcuts
  PLATFORM_SHORTCUTS: {
    win32: {
      copy: 'Ctrl+C',
      paste: 'Ctrl+V',
      selectAll: 'Ctrl+A',
      undo: 'Ctrl+Z',
      redo: 'Ctrl+Y',
      altTab: 'Alt+Tab',
      taskManager: 'Ctrl+Shift+Esc'
    },
    darwin: {
      copy: 'Cmd+C',
      paste: 'Cmd+V',
      selectAll: 'Cmd+A',
      undo: 'Cmd+Z',
      redo: 'Cmd+Shift+Z',
      altTab: 'Cmd+Tab',
      forceQuit: 'Cmd+Option+Esc'
    },
    linux: {
      copy: 'Ctrl+C',
      paste: 'Ctrl+V',
      selectAll: 'Ctrl+A',
      undo: 'Ctrl+Z',
      redo: 'Ctrl+Shift+Z',
      altTab: 'Alt+Tab',
      systemMonitor: 'Ctrl+Alt+Del'
    }
  }
});

// Performance monitoring for WebRTC
contextBridge.exposeInMainWorld('performance', {
  now: () => performance.now(),
  
  measureLatency: (startTime) => {
    return performance.now() - startTime;
  },

  getMemoryUsage: () => {
    if (performance.memory) {
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      };
    }
    return null;
  },

  // WebRTC specific performance tracking
  trackWebRTCPerformance: {
    // Video encoding/decoding metrics
    encodeStart: () => performance.now(),
    encodeEnd: (startTime, frameSize) => ({
      encodeLatency: performance.now() - startTime,
      frameSize,
      timestamp: performance.now()
    }),
    
    decodeStart: () => performance.now(),
    decodeEnd: (startTime) => ({
      decodeLatency: performance.now() - startTime,
      timestamp: performance.now()
    }),

    // Network transmission metrics
    sendStart: () => performance.now(),
    sendEnd: (startTime, bytesSent) => ({
      sendLatency: performance.now() - startTime,
      bytesSent,
      bytesPerSecond: bytesSent / ((performance.now() - startTime) / 1000),
      timestamp: performance.now()
    }),

    // Round-trip time measurement
    pingStart: () => performance.now(),
    pingEnd: (startTime) => ({
      rtt: performance.now() - startTime,
      timestamp: performance.now()
    }),

    // Frame timing
    frameReceiveStart: () => performance.now(),
    frameReceiveEnd: (startTime) => ({
      frameLatency: performance.now() - startTime,
      timestamp: performance.now()
    }),

    // Input event latency
    inputSendStart: () => performance.now(),
    inputSendEnd: (startTime, inputType) => ({
      inputLatency: performance.now() - startTime,
      inputType,
      timestamp: performance.now()
    })
  },

  // Connection quality analyzer
  analyzeConnectionQuality: (stats) => {
    const { video, connection } = stats;
    let quality = 'good';
    let issues = [];

    // Check RTT
    if (connection.rtt > 100) {
      quality = 'poor';
      issues.push('High latency');
    } else if (connection.rtt > 50) {
      quality = 'fair';
      issues.push('Moderate latency');
    }

    // Check packet loss
    if (video.inbound && video.outbound) {
      const packetLoss = 1 - (video.inbound.packetsReceived / video.outbound.packetsSent);
      if (packetLoss > 0.05) { // 5% loss
        quality = 'poor';
        issues.push('Packet loss detected');
      } else if (packetLoss > 0.01) { // 1% loss
        quality = quality === 'good' ? 'fair' : quality;
        issues.push('Minor packet loss');
      }
    }

    // Check jitter
    if (video.inbound && video.inbound.jitter > 0.1) { // 100ms jitter
      quality = quality === 'good' ? 'fair' : quality;
      issues.push('Network jitter');
    }

    return {
      overall: quality,
      issues,
      recommendations: generateRecommendations(quality, issues)
    };
  }
});

// Generate recommendations based on connection quality
function generateRecommendations(quality, issues) {
  const recommendations = [];
  
  if (issues.includes('High latency')) {
    recommendations.push('Consider switching to a wired connection');
    recommendations.push('Close other network-intensive applications');
  }
  
  if (issues.includes('Packet loss detected')) {
    recommendations.push('Check network stability');
    recommendations.push('Consider reducing video quality');
  }
  
  if (issues.includes('Network jitter')) {
    recommendations.push('Enable Quality of Service (QoS) on your router');
    recommendations.push('Consider using a different network');
  }
  
  if (quality === 'poor') {
    recommendations.push('Switch to lower quality settings');
    recommendations.push('Try connecting at a different time');
  }
  
  return recommendations;
}