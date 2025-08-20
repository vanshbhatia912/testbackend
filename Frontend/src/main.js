const { app, BrowserWindow, Menu, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const dgram = require('dgram');

// Cross-platform input control library
let nutjs;

try {
  nutjs = require('@nut-tree-fork/nut-js');
  
  // Configure Nut.js for ultra-low latency
  nutjs.screen.config.autoDelayMs = 0;
  nutjs.mouse.config.autoDelayMs = 0;
  nutjs.mouse.config.mouseSpeed = 0;
  nutjs.keyboard.config.autoDelayMs = 0;
  
  console.log('✅ Nut.js loaded for input simulation');
} catch (error) {
  console.error('❌ Nut.js not available:', error.message);
}

// Initialize store for settings
const store = new Store();

let mainWindow;
let isDev = process.argv.includes('--dev');
let ffmpegProcess = null;
let isCapturing = false;
let rtpServer = null;
let rtpPort = 5004; // Default RTP port

// WebRTC and RTP streaming stats
let streamingStats = {
  framesEncoded: 0,
  packetsGenerated: 0,
  avgBitrate: 0,
  lastFrameTime: 0,
  encodingLatency: 0,
  udpPacketsSent: 0
};

// Enable live reload for development
if (isDev) {
  try {
    require('electron-reload')(__dirname, {
      electron: path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),
      hardResetMethod: 'exit'
    });
  } catch (e) {
    console.log('⚠️ Live reload not available');
  }
}

function createWindow() {
  const windowBounds = store.get('windowBounds', {
    width: 1400,
    height: 900,
    x: undefined,
    y: undefined
  });

  mainWindow = new BrowserWindow({
    ...windowBounds,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: !isDev
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0d1117',
    darkTheme: true
  });

  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  if (fs.existsSync(rendererPath)) {
    mainWindow.loadFile(rendererPath);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.on('close', () => {
    store.set('windowBounds', mainWindow.getBounds());
    cleanupWebRTCResources();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('menu-action', 'new-session');
          }
        },
        {
          label: 'Join Session',
          accelerator: 'CmdOrCtrl+J',
          click: () => {
            mainWindow.webContents.send('menu-action', 'join-session');
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow.webContents.send('menu-action', 'settings');
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow.webContents.reload();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Fullscreen',
          accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11',
          click: () => {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        }
      ]
    },
    {
      label: 'WebRTC',
      submenu: [
        {
          label: 'Start RTP Stream',
          click: () => {
            mainWindow.webContents.send('menu-action', 'start-rtp-stream');
          }
        },
        {
          label: 'Stop RTP Stream',
          click: () => {
            mainWindow.webContents.send('menu-action', 'stop-rtp-stream');
          }
        },
        { type: 'separator' },
        {
          label: 'WebRTC Statistics',
          click: () => {
            mainWindow.webContents.send('menu-action', 'webrtc-stats');
          }
        }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        {
          label: 'About ' + app.getName(),
          role: 'about'
        },
        { type: 'separator' },
        {
          label: 'Hide ' + app.getName(),
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: 'Show All',
          role: 'unhide'
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// FFmpeg utilities for WebRTC/RTP streaming
function getFFmpegPath() {
  const platform = process.platform;
  const ffmpegDir = path.join(__dirname, '..', 'ffmpeg');
  
  const localPaths = {
    'win32': path.join(ffmpegDir, 'ffmpeg.exe'),
    'darwin': path.join(ffmpegDir, 'ffmpeg'),
    'linux': path.join(ffmpegDir, 'ffmpeg')
  };
  
  const localPath = localPaths[platform];
  if (localPath && fs.existsSync(localPath)) {
    return localPath;
  }
  
  // Try ffmpeg-static if available
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch (e) {
    // ffmpeg-static not available
  }
  
  // Fallback to system PATH
  return 'ffmpeg';
}

function checkFFmpegAvailability() {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    
    exec(`"${ffmpegPath}" -version`, (error, stdout, stderr) => {
      if (error) {
        resolve({
          available: false,
          path: ffmpegPath,
          error: error.message
        });
      } else {
        const versionMatch = stdout.match(/ffmpeg version (\S+)/);
        resolve({
          available: true,
          path: ffmpegPath,
          version: versionMatch ? versionMatch[1] : 'unknown',
          info: stdout.split('\n')[0],
          webrtcSupport: stdout.includes('libx264') && stdout.includes('rtp')
        });
      }
    });
  });
}

// RTP Server for WebRTC streaming
function createRTPServer() {
  return new Promise((resolve, reject) => {
    rtpServer = dgram.createSocket('udp4');
    
    rtpServer.bind(rtpPort, 'localhost', () => {
      console.log(`RTP server listening on localhost:${rtpPort}`);
      resolve(rtpPort);
    });
    
    rtpServer.on('error', (err) => {
      console.error('RTP server error:', err);
      reject(err);
    });
    
    rtpServer.on('message', (msg, rinfo) => {
      // Forward RTP packets to WebRTC peer connections
      streamingStats.udpPacketsSent++;
      
      // Send RTP packet info to renderer for WebRTC forwarding
      mainWindow?.webContents.send('rtp-packet-received', {
        size: msg.length,
        timestamp: Date.now(),
        source: `${rinfo.address}:${rinfo.port}`
      });
    });
  });
}

// Ultra-low latency FFmpeg screen capture to RTP
function startWebRTCScreenCapture(options = {}) {
  if (isCapturing) {
    console.log('Screen capture already in progress');
    return { success: false, error: 'Already capturing' };
  }

  const {
    fps = 30,
    quality = 23, // CRF value (lower = better quality)
    preset = 'ultrafast',
    bitrate = '2000k',
    useGPU = false,
    resolution = null
  } = options;

  const ffmpegPath = getFFmpegPath();
  const platform = process.platform;
  
  // Platform-specific input arguments
  let inputArgs = [];
  
  switch (platform) {
    case 'win32':
      inputArgs = [
        '-f', 'gdigrab',
        '-framerate', fps.toString(),
        '-i', 'desktop'
      ];
      break;
      
    case 'darwin':
      inputArgs = [
        '-f', 'avfoundation',
        '-framerate', fps.toString(),
        '-capture_cursor', '1',
        '-i', '1:none'  // Screen 1, no audio
      ];
      break;
      
    case 'linux':
      const display = process.env.DISPLAY || ':0';
      inputArgs = [
        '-f', 'x11grab',
        '-framerate', fps.toString(),
        '-show_region', '1',
        '-i', display
      ];
      break;
      
    default:
      console.error('Unsupported platform for screen capture');
      return { success: false, error: 'Unsupported platform' };
  }

  // Resolution scaling if specified
  let scaleFilter = '';
  if (resolution) {
    scaleFilter = `-vf scale=${resolution}`;
  }

  // Ultra-low latency H.264 encoding for WebRTC
  const outputArgs = [
    // Video codec settings for WebRTC
    '-c:v', useGPU ? getGPUEncoder() : 'libx264',
    '-preset', preset,
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level:v', '3.0',
    
    // Ultra-low latency settings
    '-crf', quality.toString(),
    '-maxrate', bitrate,
    '-bufsize', Math.round(parseInt(bitrate) * 0.5) + 'k', // Smaller buffer
    '-g', (fps * 2).toString(), // GOP size = 2 seconds
    '-keyint_min', fps.toString(), // Min keyframe interval
    '-sc_threshold', '0', // Disable scene change detection
    
    // Pixel format and frame settings
    '-pix_fmt', 'yuv420p',
    '-r', fps.toString(),
    
    // RTP output settings
    '-f', 'rtp',
    '-payload_type', '96',
    `rtp://127.0.0.1:${rtpPort}`
  ];

  // Combine all arguments
  const ffmpegArgs = [
    ...inputArgs,
    ...(scaleFilter ? scaleFilter.split(' ') : []),
    ...outputArgs
  ];

  console.log('Starting WebRTC FFmpeg capture:', ffmpegArgs.join(' '));

  try {
    ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
    isCapturing = true;
    streamingStats.framesEncoded = 0;
    streamingStats.lastFrameTime = Date.now();

    // Handle FFmpeg output and errors
    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      
      // Parse FFmpeg statistics
      if (output.includes('frame=')) {
        const frameMatch = output.match(/frame=\s*(\d+)/);
        const bitrateMatch = output.match(/bitrate=\s*([\d.]+)kbits\/s/);
        
        if (frameMatch) {
          streamingStats.framesEncoded = parseInt(frameMatch[1]);
        }
        if (bitrateMatch) {
          streamingStats.avgBitrate = parseFloat(bitrateMatch[1]);
        }
        
        updateWebRTCStreamingStats();
      }
      
      if (isDev && output.includes('error')) {
        console.error('FFmpeg error:', output);
      }
    });

    ffmpegProcess.on('error', (error) => {
      console.error('FFmpeg process error:', error);
      isCapturing = false;
      mainWindow?.webContents.send('webrtc-stream-error', error.message);
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg process closed with code: ${code}`);
      isCapturing = false;
      ffmpegProcess = null;
    });

    return { 
      success: true, 
      pid: ffmpegProcess.pid,
      rtpPort: rtpPort,
      options: { fps, quality, preset, bitrate, useGPU }
    };

  } catch (error) {
    console.error('Failed to start WebRTC screen capture:', error);
    isCapturing = false;
    return { success: false, error: error.message };
  }
}

function updateWebRTCStreamingStats() {
  const now = Date.now();
  const timeDiff = now - streamingStats.lastFrameTime;
  
  if (timeDiff > 0) {
    streamingStats.encodingLatency = timeDiff;
  }
  
  streamingStats.lastFrameTime = now;
  
  // Send performance stats every 30 frames
  if (streamingStats.framesEncoded % 30 === 0) {
    mainWindow?.webContents.send('webrtc-performance-stats', {
      framesEncoded: streamingStats.framesEncoded,
      avgBitrate: streamingStats.avgBitrate,
      encodingLatency: streamingStats.encodingLatency,
      udpPacketsSent: streamingStats.udpPacketsSent,
      rtpPort: rtpPort,
      memoryUsage: process.memoryUsage()
    });
  }
}

function getGPUEncoder() {
  const platform = process.platform;
  
  switch (platform) {
    case 'win32':
      return 'h264_nvenc'; // NVIDIA GPU encoding
    case 'darwin':
      return 'h264_videotoolbox'; // Apple VideoToolbox
    case 'linux':
      return 'h264_vaapi'; // VA-API on Linux
    default:
      return 'libx264'; // Software fallback
  }
}

function stopWebRTCScreenCapture() {
  if (!isCapturing || !ffmpegProcess) {
    return { success: false, error: 'No capture in progress' };
  }

  console.log('Stopping WebRTC screen capture');
  
  try {
    // Gracefully terminate FFmpeg
    ffmpegProcess.stdin.write('q');
    ffmpegProcess.kill('SIGTERM');
    
    // Force kill after 3 seconds if still running
    setTimeout(() => {
      if (ffmpegProcess && !ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGKILL');
      }
    }, 3000);
    
    isCapturing = false;
    
    return { 
      success: true, 
      finalStats: {
        ...streamingStats,
        duration: Date.now() - streamingStats.lastFrameTime
      }
    };
  } catch (error) {
    console.error('Error stopping WebRTC capture:', error);
    return { success: false, error: error.message };
  }
}

// Input simulation functions (unchanged from original)
async function simulateMouseMove(data) {
  const { x, y, sensitivity = 1 } = data;
  
  try {
    if (!nutjs) {
      throw new Error('Nut.js not available');
    }

    const adjustedX = Math.round(x * sensitivity);
    const adjustedY = Math.round(y * sensitivity);
    
    await nutjs.mouse.setPosition(new nutjs.Point(adjustedX, adjustedY));
    
    return { success: true };
  } catch (error) {
    console.error('Mouse move error:', error);
    return { success: false, error: error.message };
  }
}

async function simulateMouseClick(data) {
  const { x, y, button = 0, type = 'click' } = data;
  
  try {
    if (!nutjs) {
      throw new Error('Nut.js not available');
    }

    await simulateMouseMove({ x, y });
    
    const nutButton = button === 0 ? nutjs.Button.LEFT : 
                     button === 2 ? nutjs.Button.RIGHT : nutjs.Button.MIDDLE;
    
    if (type === 'down' || type === 'click') {
      await nutjs.mouse.pressButton(nutButton);
    }
    if (type === 'up' || type === 'click') {
      await nutjs.mouse.releaseButton(nutButton);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Mouse click error:', error);
    return { success: false, error: error.message };
  }
}

async function simulateMouseWheel(data) {
  const { deltaY, deltaX } = data;
  
  try {
    if (!nutjs) {
      throw new Error('Nut.js not available');
    }

    const scrollAmount = Math.abs(deltaY || deltaX || 1);
    
    if (deltaY > 0) {
      for (let i = 0; i < scrollAmount; i++) {
        await nutjs.mouse.scrollDown(1);
      }
    } else {
      for (let i = 0; i < scrollAmount; i++) {
        await nutjs.mouse.scrollUp(1);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Mouse wheel error:', error);
    return { success: false, error: error.message };
  }
}

async function simulateKeyPress(keyData) {
  const { type, key, code, ctrlKey, altKey, shiftKey, metaKey } = keyData;
  
  try {
    if (!nutjs) {
      throw new Error('Nut.js not available');
    }

    const { Key } = nutjs;
    let nutKey = key;
    
    const keyMap = {
      'ArrowUp': Key.Up, 'ArrowDown': Key.Down, 
      'ArrowLeft': Key.Left, 'ArrowRight': Key.Right,
      'Enter': Key.Return, 'Escape': Key.Escape,
      'Backspace': Key.Backspace, 'Delete': Key.Delete,
      'Tab': Key.Tab, ' ': Key.Space,
      'Control': Key.LeftControl, 'Alt': Key.LeftAlt,
      'Shift': Key.LeftShift, 'Meta': Key.LeftSuper
    };
    
    if (keyMap[key]) {
      nutKey = keyMap[key];
    }
    
    const modifiers = [];
    if (ctrlKey) modifiers.push(Key.LeftControl);
    if (altKey) modifiers.push(Key.LeftAlt);
    if (shiftKey) modifiers.push(Key.LeftShift);
    if (metaKey) modifiers.push(Key.LeftSuper);
    
    if (type === 'keydown') {
      if (modifiers.length > 0) {
        await nutjs.keyboard.pressKey(...modifiers, nutKey);
        await nutjs.keyboard.releaseKey(...modifiers, nutKey);
      } else {
        await nutjs.keyboard.pressKey(nutKey);
      }
    } else if (type === 'keyup') {
      await nutjs.keyboard.releaseKey(nutKey);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Key press error:', error);
    return { success: false, error: error.message };
  }
}

async function simulateKeyCombo(keys) {
  try {
    if (!nutjs) {
      throw new Error('Nut.js not available');
    }

    const { Key } = nutjs;
    const nutKeys = keys.map(key => {
      const keyMap = {
        'ctrl': Key.LeftControl, 'control': Key.LeftControl,
        'alt': Key.LeftAlt, 'shift': Key.LeftShift,
        'meta': Key.LeftSuper, 'cmd': Key.LeftSuper, 'super': Key.LeftSuper,
        'tab': Key.Tab, 'enter': Key.Return, 'escape': Key.Escape, 'space': Key.Space
      };
      return keyMap[key.toLowerCase()] || key.toLowerCase();
    });
    
    await nutjs.keyboard.pressKey(...nutKeys);
    await nutjs.keyboard.releaseKey(...nutKeys);
    
    return { success: true };
  } catch (error) {
    console.error('Key combination error:', error);
    return { success: false, error: error.message };
  }
}

// Cleanup WebRTC resources
function cleanupWebRTCResources() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
    ffmpegProcess = null;
  }
  
  if (rtpServer) {
    rtpServer.close();
    rtpServer = null;
  }
  
  isCapturing = false;
}

// App event handlers
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupWebRTCResources();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('get-platform', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: process.version
  };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-setting', (event, key) => {
  return store.get(key);
});

ipcMain.handle('set-setting', (event, key, value) => {
  store.set(key, value);
  return true;
});

// WebRTC/FFmpeg related IPC handlers
ipcMain.handle('check-ffmpeg-availability', async () => {
  return await checkFFmpegAvailability();
});

ipcMain.handle('create-rtp-server', async () => {
  try {
    const port = await createRTPServer();
    return { success: true, port };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-webrtc-capture', (event, options) => {
  return startWebRTCScreenCapture(options);
});

ipcMain.handle('stop-webrtc-capture', () => {
  return stopWebRTCScreenCapture();
});

ipcMain.handle('get-webrtc-stats', () => {
  return {
    success: true,
    stats: streamingStats,
    rtpPort: rtpPort,
    isCapturing: isCapturing
  };
});

// Input simulation IPC handlers (unchanged)
ipcMain.handle('simulate-mouse-move', (event, data) => {
  return simulateMouseMove(data);
});

ipcMain.handle('simulate-mouse-click', (event, data) => {
  return simulateMouseClick(data);
});

ipcMain.handle('simulate-mouse-wheel', (event, data) => {
  return simulateMouseWheel(data);
});

ipcMain.handle('simulate-key-press', (event, keyData) => {
  return simulateKeyPress(keyData);
});

ipcMain.handle('simulate-key-combo', (event, keys) => {
  return simulateKeyCombo(keys);
});

ipcMain.handle('get-screen-info', () => {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  
  return {
    primary: {
      id: primaryDisplay.id,
      bounds: primaryDisplay.bounds,
      workArea: primaryDisplay.workArea,
      scaleFactor: primaryDisplay.scaleFactor
    },
    all: displays.map(display => ({
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      isPrimary: display.id === primaryDisplay.id
    }))
  };
});

// Dialog handlers
ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-message-box', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down WebRTC host...');
  cleanupWebRTCResources();
  app.quit();
});

process.on('SIGTERM', () => {
  cleanupWebRTCResources();
  app.quit();
});