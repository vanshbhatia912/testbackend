const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

// Check if APIs are already exposed to prevent binding conflicts
if (!window.electronAPI) {
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

    // FIXED: Screen capture API - Use IPC handler from main.js
    getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),

    // WebRTC FFmpeg Screen Capture APIs (Enhanced)
    startWebRTCCapture: (options) => ipcRenderer.invoke('start-webrtc-capture', options),
    stopWebRTCCapture: () => ipcRenderer.invoke('stop-webrtc-capture'),
    
    // WebRTC event listeners
    onWebRTCStats: (callback) => {
      ipcRenderer.on('webrtc-stats', (event, stats) => callback(stats));
    },
    onWebRTCError: (callback) => {
      ipcRenderer.on('webrtc-error', (event, error) => callback(error));
    },
    onWebRTCStopped: (callback) => {
      ipcRenderer.on('webrtc-stopped', (event) => callback());
    },
    onWebRTCReady: (callback) => {
      ipcRenderer.on('webrtc-rtp-ready', (event, data) => callback(data));
    },

    // Cross-platform Input Control APIs (Optimized for WebRTC DataChannels)
    simulateMouseMove: (x, y, sensitivity) => ipcRenderer.invoke('simulate-mouse-move', { x, y, sensitivity }),
    simulateMouseClick: (x, y, button, type) => ipcRenderer.invoke('simulate-mouse-click', { x, y, button, type }),
    simulateMouseWheel: (deltaY, deltaX) => ipcRenderer.invoke('simulate-mouse-wheel', { deltaY, deltaX }),
    simulateKeyPress: (keyData) => ipcRenderer.invoke('simulate-key-press', keyData),
    simulateKeyCombo: (keys) => ipcRenderer.invoke('simulate-key-combo', keys),

    // Screen information
    getScreenInfo: () => ipcRenderer.invoke('get-screen-info'),
    
    // FFmpeg utilities (WebRTC enhanced)
    checkFFmpegAvailability: () => ipcRenderer.invoke('check-ffmpeg-availability'),

    // Remove listeners
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel);
    }
  });
}

// WebRTC utilities - Only expose if not already present
if (!window.webrtcUtils) {
  contextBridge.exposeInMainWorld('webrtcUtils', {
    // Check WebRTC browser support
    checkSupport: () => {
      return {
        webrtc: !!window.RTCPeerConnection,
        datachannel: !!(window.RTCPeerConnection && window.RTCDataChannel),
        mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        getDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
        h264: (() => {
          try {
            const capabilities = RTCRtpReceiver.getCapabilities('video');
            return capabilities.codecs.some(codec => 
              codec.mimeType.toLowerCase().includes('h264')
            );
          } catch {
            return false;
          }
        })()
      };
    },

    // WebRTC connection quality detection
    analyzeConnectionQuality: (stats) => {
      if (!stats) return 'unknown';
      
      const latency = stats.roundTripTime || 0;
      const packetLoss = stats.packetsLost / (stats.packetsReceived + stats.packetsLost) * 100 || 0;
      const jitter = stats.jitter || 0;

      if (latency < 30 && packetLoss < 1 && jitter < 10) return 'excellent';
      if (latency < 50 && packetLoss < 3 && jitter < 20) return 'good';
      if (latency < 100 && packetLoss < 5 && jitter < 40) return 'fair';
      return 'poor';
    },

    // Optimal WebRTC settings calculator
    calculateOptimalSettings: (networkQuality, deviceCapabilities) => {
      const settings = {
        video: {
          frameRate: 30,
          bitrate: 2000000, // 2 Mbps
          width: 1920,
          height: 1080
        },
        audio: false, // Disabled for lower latency
        datachannel: {
          ordered: false,
          maxRetransmits: 0
        }
      };

      // Adjust based on network quality
      switch (networkQuality) {
        case 'poor':
          settings.video.frameRate = 15;
          settings.video.bitrate = 500000;
          settings.video.width = 1280;
          settings.video.height = 720;
          break;
        case 'fair':
          settings.video.frameRate = 24;
          settings.video.bitrate = 1000000;
          break;
        case 'good':
          settings.video.frameRate = 30;
          settings.video.bitrate = 2000000;
          break;
        case 'excellent':
          settings.video.frameRate = 60;
          settings.video.bitrate = 4000000;
          break;
      }

      return settings;
    },

    // Frame skipping algorithm for real-time performance
    shouldSkipFrame: (currentTime, targetTime, bufferHealth) => {
      const timeDiff = currentTime - targetTime;
      const bufferRatio = bufferHealth || 0;
      
      // Skip if we're behind target time or buffer is too full
      return timeDiff > 33 || bufferRatio > 0.8; // 33ms = ~30fps threshold
    },

    // Input event batching for efficiency
    batchInputEvents: (events, maxBatchSize = 5) => {
      if (events.length <= 1) return events;

      const batches = [];
      const mouseEvents = events.filter(e => e.type.startsWith('mouse'));
      const keyboardEvents = events.filter(e => e.type.startsWith('key'));

      // Batch mouse moves, keep clicks separate
      const mouseMoves = mouseEvents.filter(e => e.type === 'mousemove');
      const mouseOthers = mouseEvents.filter(e => e.type !== 'mousemove');

      if (mouseMoves.length > 1) {
        // Keep only the latest mouse move to reduce bandwidth
        batches.push(mouseMoves[mouseMoves.length - 1]);
      } else {
        batches.push(...mouseMoves);
      }

      batches.push(...mouseOthers);
      batches.push(...keyboardEvents);

      return batches.slice(0, maxBatchSize);
    }
  });
}

// Enhanced utility functions for WebRTC - Only if not present
if (!window.utils) {
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

    // Format bitrate
    formatBitrate: (bitsPerSecond, decimals = 2) => {
      if (bitsPerSecond === 0) return '0 bps';
      const k = 1000; // Use 1000 for network speeds
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
      const i = Math.floor(Math.log(bitsPerSecond) / Math.log(k));
      return parseFloat((bitsPerSecond / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    // Get timestamp
    getTimestamp: () => new Date().toLocaleString(),

    // High precision timestamp for latency measurements
    getHighResTimestamp: () => performance.now(),

    // Debounce function (optimized for real-time input)
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
      let inThrottle;
      return function(...args) {
        if (!inThrottle) {
          func.apply(this, args);
          inThrottle = true;
          setTimeout(() => inThrottle = false, limit);
        }
      };
    },

    // Calculate network latency from RTT
    calculateLatency: (rtt, jitter = 0) => {
      // Estimate one-way latency considering jitter
      return (rtt / 2) + (jitter * 0.5);
    },

    // Detect device capabilities for WebRTC optimization
    detectDeviceCapabilities: async () => {
      const capabilities = {
        maxResolution: { width: 1920, height: 1080 },
        maxFrameRate: 30,
        hardwareAcceleration: false,
        batteryLevel: 1,
        connectionType: 'unknown'
      };

      try {
        // Screen resolution
        capabilities.maxResolution.width = screen.width;
        capabilities.maxResolution.height = screen.height;

        // Hardware acceleration detection (rough estimate)
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (gl) {
          const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            capabilities.hardwareAcceleration = !renderer.includes('Software');
          }
        }

        // Battery level (if available)
        if ('getBattery' in navigator) {
          const battery = await navigator.getBattery();
          capabilities.batteryLevel = battery.level;
        }

        // Connection type (if available)
        if ('connection' in navigator) {
          capabilities.connectionType = navigator.connection.effectiveType || 'unknown';
        }

        // Frame rate detection based on display
        capabilities.maxFrameRate = screen.refreshRate || 60;

      } catch (error) {
        console.warn('Could not detect all device capabilities:', error);
      }

      return capabilities;
    },

    // WebRTC SDP utilities
    optimizeSDP: (sdp, options = {}) => {
      let optimizedSDP = sdp;

      // Force H.264 codec if available
      if (options.preferH264) {
        optimizedSDP = optimizedSDP.replace(/a=rtpmap:(\d+) VP8\/90000/g, '');
        optimizedSDP = optimizedSDP.replace(/a=rtpmap:(\d+) VP9\/90000/g, '');
      }

      // Set maximum bitrate
      if (options.maxBitrate) {
        optimizedSDP += `\na=x-google-max-bitrate:${options.maxBitrate}`;
        optimizedSDP += `\na=x-google-start-bitrate:${Math.round(options.maxBitrate * 0.8)}`;
      }

      // Ultra low-latency settings
      if (options.ultraLowLatency) {
        optimizedSDP += '\na=x-google-flag:conference-mode';
        optimizedSDP += '\na=x-google-flag:cpu-overuse-detection';
        optimizedSDP += '\na=fmtp:96 profile-level-id=42e01f;level-asymmetry-allowed=1;packetization-mode=1';
      }

      return optimizedSDP;
    }
  });
}

// WebRTC constants - Only if not present
if (!window.constants) {
  contextBridge.exposeInMainWorld('constants', {
    // WebRTC optimized quality options
    WEBRTC_QUALITY_OPTIONS: [
      { 
        value: 'mobile', 
        label: 'Mobile (Low Latency)', 
        fps: 15, 
        bitrate: 500000,
        resolution: { width: 1280, height: 720 },
        targetLatency: 80
      },
      { 
        value: 'balanced', 
        label: 'Balanced Quality', 
        fps: 30, 
        bitrate: 1500000,
        resolution: { width: 1920, height: 1080 },
        targetLatency: 50
      },
      { 
        value: 'performance', 
        label: 'High Performance', 
        fps: 60, 
        bitrate: 4000000,
        resolution: { width: 1920, height: 1080 },
        targetLatency: 30
      },
      { 
        value: 'ultra', 
        label: 'Ultra Low-Latency', 
        fps: 120, 
        bitrate: 8000000,
        resolution: { width: 2560, height: 1440 },
        targetLatency: 20
      }
    ],

    // WebRTC default settings optimized for <50ms latency
    DEFAULT_WEBRTC_SETTINGS: {
      serverUrl: 'http://localhost:3000',
      quality: 'balanced',
      autoConnect: true,
      notifications: true,
      connectionTimeout: 10,
      darkMode: true,
      mouseSensitivity: 1.0,
      
      // WebRTC specific settings
      frameSkipping: true,
      ultraLowLatency: true,
      targetLatency: 50,
      maxBufferTime: 33, // 33ms = ~30fps buffer
      inputBuffering: 8, // 8ms batching
      adaptiveBitrate: true,
      preferH264: true,
      hardwareAcceleration: true,
      
      // DataChannel settings
      inputChannelOrdered: false,
      inputChannelReliable: false,
      inputChannelMaxRetransmits: 0,
      
      // Performance monitoring
      enableStatsReporting: true,
      statsInterval: 1000,
      performanceTarget: 50 // <50ms target
    },

    // WebRTC ICE server configurations
    ICE_SERVERS: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ],

    // Platform-specific optimizations
    PLATFORM_OPTIMIZATIONS: {
      win32: {
        preferredCodec: 'H264',
        hardwareAcceleration: true,
        maxFrameRate: 60,
        inputMethod: 'nut-js'
      },
      darwin: {
        preferredCodec: 'H264',
        hardwareAcceleration: true,
        maxFrameRate: 120, // Mac displays often support higher refresh
        inputMethod: 'nut-js'
      },
      linux: {
        preferredCodec: 'H264',
        hardwareAcceleration: false, // Often more limited on Linux
        maxFrameRate: 60,
        inputMethod: 'nut-js'
      }
    }
  });
}

// Performance tracking - Only if not present
if (!window.performance?.webrtcPerformance) {
  contextBridge.exposeInMainWorld('webrtcPerformance', {
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
    }
  });
}