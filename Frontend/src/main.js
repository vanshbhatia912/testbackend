const { app, BrowserWindow, Menu, ipcMain, dialog, shell, screen, desktopCapturer } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');

// Cross-platform input control library (Nut.js only)
let nutjs;

// Try to load Nut.js input control library
try {
  nutjs = require('@nut-tree-fork/nut-js');
  
  // Configure Nut.js for low latency
  nutjs.screen.config.autoDelayMs = 0;
  nutjs.mouse.config.autoDelayMs = 0;
  nutjs.mouse.config.mouseSpeed = 0;
  nutjs.keyboard.config.autoDelayMs = 0;
  
  console.log('✅ Nut.js loaded successfully');
} catch (error) {
  console.error('❌ Nut.js not available:', error.message);
  console.error('Please install Nut.js: npm install @nut-tree-fork/nut-js');
}

// Initialize store for settings
const store = new Store();

let mainWindow;
let isDev = process.argv.includes('--dev');
let ffmpegProcess = null;
let isCapturing = false;
let captureStats = {
  framesGenerated: 0,
  lastFrameTime: 0,
  averageFPS: 0,
  totalCaptureTime: 0
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
  // Get saved window bounds or use defaults
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

  // Load the app (fix path issue)
  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  if (fs.existsSync(rendererPath)) {
    mainWindow.loadFile(rendererPath);
  } else {
    // Fallback to current directory if renderer subfolder doesn't exist
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Focus on the window
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Save window bounds on close
  mainWindow.on('close', () => {
    store.set('windowBounds', mainWindow.getBounds());
    
    // Clean up FFmpeg process
    if (ffmpegProcess) {
      ffmpegProcess.kill('SIGTERM');
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Set up menu
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
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            mainWindow.webContents.setZoomLevel(0);
          }
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom + 0.5);
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom - 0.5);
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
      label: 'Connection',
      submenu: [
        {
          label: 'Server Settings',
          click: () => {
            mainWindow.webContents.send('menu-action', 'server-settings');
          }
        },
        {
          label: 'Quality Settings',
          click: () => {
            mainWindow.webContents.send('menu-action', 'quality-settings');
          }
        },
        { type: 'separator' },
        {
          label: 'Test Connection',
          click: () => {
            mainWindow.webContents.send('menu-action', 'test-connection');
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Remote Desktop Control',
              message: 'Remote Desktop Control v1.0.0 - FFmpeg Edition',
              detail: 'A modern cross-platform remote desktop application built with Electron and FFmpeg.\n\nSupports Windows, Linux, and macOS with low-latency screen capture.\nInput simulation powered by Nut.js.',
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Keyboard Shortcuts',
          click: () => {
            mainWindow.webContents.send('menu-action', 'show-shortcuts');
          }
        },
        { type: 'separator' },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal('https://github.com/your-repo/issues');
          }
        }
      ]
    }
  ];

  // macOS specific menu adjustments
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
          label: 'Services',
          role: 'services',
          submenu: []
        },
        { type: 'separator' },
        {
          label: 'Hide ' + app.getName(),
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          role: 'hideothers'
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

// FFmpeg utilities (unchanged, good implementation)
function getFFmpegPath() {
  const platform = process.platform;
  const ffmpegDir = path.join(__dirname, '..', 'ffmpeg');
  
  // Try local FFmpeg first
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
          info: stdout.split('\n')[0]
        });
      }
    });
  });
}

// Enhanced screen capture with FFmpeg (good implementation)
function startFFmpegScreenCapture(options = {}) {
  if (isCapturing) {
    console.log('⚠️ Screen capture already in progress');
    return { success: false, error: 'Already capturing' };
  }

  const {
    fps = 30,
    quality = 70,
    preset = 'veryfast',
    bitrate = '2000k',
    useGPU = false
  } = options;

  const ffmpegPath = getFFmpegPath();
  const platform = process.platform;
  
  // Platform-specific input arguments
  let inputArgs = [];
  
  switch (platform) {
    case 'win32':
      // Windows: Use gdigrab for desktop capture
      inputArgs = [
        '-f', 'gdigrab',
        '-framerate', fps.toString(),
        '-i', 'desktop'
      ];
      break;
      
    case 'darwin':
      // macOS: Use avfoundation
      inputArgs = [
        '-f', 'avfoundation',
        '-framerate', fps.toString(),
        '-i', '1:0'  // Capture screen 1 with no audio
      ];
      break;
      
    case 'linux':
      // Linux: Use x11grab
      const display = process.env.DISPLAY || ':0';
      inputArgs = [
        '-f', 'x11grab',
        '-framerate', fps.toString(),
        '-i', display
      ];
      break;
      
    default:
      console.error('❌ Unsupported platform for screen capture');
      return { success: false, error: 'Unsupported platform' };
  }

  // Output arguments for low-latency streaming
  const outputArgs = [
    '-c:v', useGPU ? getGPUEncoder() : 'libx264',
    '-preset', preset,
    '-tune', 'zerolatency',
    '-crf', Math.round((100 - quality) * 51 / 100).toString(),
    '-maxrate', bitrate,
    '-bufsize', bitrate,
    '-pix_fmt', 'yuv420p',
    '-g', (fps * 2).toString(), // Keyframe every 2 seconds
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', Math.round((100 - quality) * 31 / 100).toString(),
    'pipe:1'
  ];

  const ffmpegArgs = [
    ...inputArgs,
    ...outputArgs
  ];

  console.log('🎬 Starting FFmpeg screen capture:', ffmpegArgs.join(' '));

  try {
    ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
    isCapturing = true;
    captureStats.framesGenerated = 0;
    captureStats.lastFrameTime = Date.now();

    // Handle FFmpeg output (JPEG frames)
    let frameBuffer = Buffer.alloc(0);
    
    ffmpegProcess.stdout.on('data', (data) => {
      frameBuffer = Buffer.concat([frameBuffer, data]);
      
      // Look for JPEG markers to extract complete frames
      let start = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8])); // JPEG start
      let end = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start + 2); // JPEG end
      
      while (start !== -1 && end !== -1) {
        const frameData = frameBuffer.slice(start, end + 2);
        processFrame(frameData);
        
        frameBuffer = frameBuffer.slice(end + 2);
        start = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
        end = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start + 2);
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      // Parse FFmpeg statistics
      const output = data.toString();
      if (output.includes('frame=')) {
        const frameMatch = output.match(/frame=\s*(\d+)/);
        if (frameMatch) {
          captureStats.framesGenerated = parseInt(frameMatch[1]);
          updateCaptureStats();
        }
      }
      
      if (isDev) {
        console.log('FFmpeg:', output);
      }
    });

    ffmpegProcess.on('error', (error) => {
      console.error('❌ FFmpeg process error:', error);
      isCapturing = false;
      mainWindow?.webContents.send('capture-error', error.message);
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`📹 FFmpeg process closed with code: ${code}`);
      isCapturing = false;
      ffmpegProcess = null;
    });

    return { 
      success: true, 
      pid: ffmpegProcess.pid,
      options: { fps, quality, preset, bitrate }
    };

  } catch (error) {
    console.error('❌ Failed to start FFmpeg:', error);
    isCapturing = false;
    return { success: false, error: error.message };
  }
}

function processFrame(frameData) {
  const now = Date.now();
  const frameNumber = ++captureStats.framesGenerated;
  
  // Get screen dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;
  
  // Convert binary frame to base64 for transmission
  const base64Frame = frameData.toString('base64');
  
  // Send frame to renderer
  mainWindow?.webContents.send('screen-frame-data', {
    image: `data:image/jpeg;base64,${base64Frame}`,
    width: width,
    height: height,
    timestamp: now,
    frameNumber: frameNumber,
    format: 'jpeg',
    size: frameData.length
  });
  
  // Update performance stats
  updateCaptureStats();
}

function updateCaptureStats() {
  const now = Date.now();
  const timeDiff = now - captureStats.lastFrameTime;
  
  if (timeDiff > 0) {
    const currentFPS = 1000 / timeDiff;
    captureStats.averageFPS = (captureStats.averageFPS + currentFPS) / 2;
  }
  
  captureStats.lastFrameTime = now;
  
  // Send performance stats every 30 frames
  if (captureStats.framesGenerated % 30 === 0) {
    mainWindow?.webContents.send('capture-performance-stats', {
      framesGenerated: captureStats.framesGenerated,
      averageFPS: Math.round(captureStats.averageFPS),
      captureLatency: timeDiff,
      memoryUsage: process.memoryUsage()
    });
  }
}

function getGPUEncoder() {
  const platform = process.platform;
  
  // Platform-specific GPU encoders
  switch (platform) {
    case 'win32':
      return 'h264_nvenc'; // NVIDIA GPU encoding on Windows
    case 'darwin':
      return 'h264_videotoolbox'; // Apple VideoToolbox
    case 'linux':
      return 'h264_vaapi'; // VA-API on Linux
    default:
      return 'libx264'; // Software fallback
  }
}

function stopFFmpegScreenCapture() {
  if (!isCapturing || !ffmpegProcess) {
    return { success: false, error: 'No capture in progress' };
  }

  console.log('🛑 Stopping FFmpeg screen capture');
  
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
        ...captureStats,
        duration: Date.now() - captureStats.lastFrameTime
      }
    };
  } catch (error) {
    console.error('❌ Error stopping FFmpeg:', error);
    return { success: false, error: error.message };
  }
}

// Cross-platform input simulation with Nut.js only
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
    console.error('❌ Mouse move error:', error);
    return { success: false, error: error.message };
  }
}

async function simulateMouseClick(data) {
  const { x, y, button = 0, type = 'click' } = data;
  
  try {
    if (!nutjs) {
      throw new Error('Nut.js not available');
    }

    // Move to position first
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
    console.error('❌ Mouse click error:', error);
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
    console.error('❌ Mouse wheel error:', error);
    return { success: false, error: error.message };
  }
}

async function simulateKeyPress(keyData) {
  const { type, key, code, ctrlKey, altKey, shiftKey, metaKey } = keyData;
  
  try {
    if (!nutjs) {
      throw new Error('Nut.js not available');
    }

    // Map keys for Nut.js
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
    console.error('❌ Key press error:', error);
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
    console.error('❌ Key combination error:', error);
    return { success: false, error: error.message };
  }
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
  // Clean up FFmpeg process
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Enhanced IPC handlers
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

// FFmpeg-related IPC handlers
ipcMain.handle('check-ffmpeg-availability', async () => {
  return await checkFFmpegAvailability();
});

ipcMain.handle('get-ffmpeg-info', async () => {
  const availability = await checkFFmpegAvailability();
  return {
    ...availability,
    supportedEncoders: ['libx264', 'h264_nvenc', 'h264_videotoolbox', 'h264_vaapi'],
    platform: process.platform,
    inputMethods: {
      'win32': 'gdigrab',
      'darwin': 'avfoundation', 
      'linux': 'x11grab'
    },
    inputLibrary: nutjs ? '@nut-tree-fork/nut-js' : 'none'
  };
});

ipcMain.handle('start-screen-capture', (event, options) => {
  return startFFmpegScreenCapture(options);
});

ipcMain.handle('stop-screen-capture', () => {
  return stopFFmpegScreenCapture();
});

// Input simulation IPC handlers
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

// Handle app updates (for production)
if (!isDev) {
  console.log('Production mode - auto-updater disabled for this example');
}

// Handle certificate errors (for development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Security: prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (navigationEvent, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

// Handle protocol for deep links (optional)
if (process.platform === 'win32') {
  app.setAsDefaultProtocolClient('remote-desktop');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  
  if (ffmpegProcess) {
    console.log('📹 Terminating FFmpeg process...');
    ffmpegProcess.kill('SIGTERM');
  }
  
  app.quit();
});

process.on('SIGTERM', () => {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
  }
  app.quit();
});