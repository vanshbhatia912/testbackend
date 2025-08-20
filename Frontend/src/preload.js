const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
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

  // FFmpeg Screen Capture APIs
  startScreenCapture: (options) => ipcRenderer.invoke('start-screen-capture', options),
  stopScreenCapture: () => ipcRenderer.invoke('stop-screen-capture'),
  onScreenFrame: (callback) => {
    ipcRenderer.on('screen-frame-data', (event, frameData) => callback(frameData));
  },
  onPerformanceStats: (callback) => {
    ipcRenderer.on('capture-performance-stats', (event, stats) => callback(stats));
  },

  // Cross-platform Input Control APIs (replacing Nut.js on server)
  simulateMouseMove: (x, y, sensitivity) => ipcRenderer.invoke('simulate-mouse-move', { x, y, sensitivity }),
  simulateMouseClick: (x, y, button, type) => ipcRenderer.invoke('simulate-mouse-click', { x, y, button, type }),
  simulateMouseWheel: (deltaY, deltaX) => ipcRenderer.invoke('simulate-mouse-wheel', { deltaY, deltaX }),
  simulateKeyPress: (keyData) => ipcRenderer.invoke('simulate-key-press', keyData),
  simulateKeyCombo: (keys) => ipcRenderer.invoke('simulate-key-combo', keys),

  // Screen information
  getScreenInfo: () => ipcRenderer.invoke('get-screen-info'),
  
  // FFmpeg utilities
  checkFFmpegAvailability: () => ipcRenderer.invoke('check-ffmpeg-availability'),
  getFFmpegInfo: () => ipcRenderer.invoke('get-ffmpeg-info'),

  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

// Socket.IO client - we'll load it from CDN in the renderer
contextBridge.exposeInMainWorld('socketIO', {
  // This will be used to pass Socket.IO from the renderer
  connect: null
});

// Utility functions
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
      // Fallback for older browsers
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

  // Debounce function
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

  // Convert ArrayBuffer to Base64 for binary frame transmission
  arrayBufferToBase64: (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  },

  // Convert Base64 to ArrayBuffer for binary frame reception
  base64ToArrayBuffer: (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
});

// Enhanced constants with FFmpeg-specific settings
contextBridge.exposeInMainWorld('constants', {
  QUALITY_OPTIONS: [
    { 
      value: 'low', 
      label: 'Low Quality (15 FPS)', 
      fps: 15, 
      quality: 30,
      ffmpegPreset: 'ultrafast',
      bitrate: '500k'
    },
    { 
      value: 'medium', 
      label: 'Medium Quality (24 FPS)', 
      fps: 24, 
      quality: 50,
      ffmpegPreset: 'veryfast',
      bitrate: '1000k'
    },
    { 
      value: 'high', 
      label: 'High Quality (30 FPS)', 
      fps: 30, 
      quality: 70,
      ffmpegPreset: 'fast',
      bitrate: '2000k'
    },
    { 
      value: 'ultra', 
      label: 'Ultra Quality (60 FPS)', 
      fps: 60, 
      quality: 90,
      ffmpegPreset: 'medium',
      bitrate: '4000k'
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
    // FFmpeg specific settings
    hardwareAcceleration: true,
    useGPUEncoding: false,
    adaptiveQuality: true,
    binaryFrames: true,
    inputPrioritization: true,
    adaptiveFPS: true
  },

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
  },

  // FFmpeg encoding presets for different performance levels
  FFMPEG_PRESETS: {
    ultrafast: { preset: 'ultrafast', tune: 'zerolatency', crf: 28 },
    veryfast: { preset: 'veryfast', tune: 'zerolatency', crf: 25 },
    fast: { preset: 'fast', tune: 'zerolatency', crf: 23 },
    medium: { preset: 'medium', tune: 'zerolatency', crf: 21 }
  },

  // Input event priorities for low-latency processing
  EVENT_PRIORITIES: {
    KEYBOARD: 1,    // Highest priority
    MOUSE_CLICK: 2, // High priority  
    MOUSE_MOVE: 3,  // Medium priority
    SCROLL: 4,      // Lower priority
    FRAME: 5        // Lowest priority
  }
});

// Performance monitoring with more detailed metrics
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

  // Enhanced performance tracking for FFmpeg operations
  trackFFmpegPerformance: {
    captureStart: () => performance.now(),
    captureEnd: (startTime) => ({
      captureLatency: performance.now() - startTime,
      timestamp: performance.now()
    }),
    
    encodeStart: () => performance.now(),
    encodeEnd: (startTime) => ({
      encodeLatency: performance.now() - startTime,
      timestamp: performance.now()
    }),
    
    transmitStart: () => performance.now(),
    transmitEnd: (startTime, bytesSent) => ({
      transmitLatency: performance.now() - startTime,
      bytesPerSecond: bytesSent / ((performance.now() - startTime) / 1000),
      timestamp: performance.now()
    })
  }
});