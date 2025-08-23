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

// WebRTC RTP streaming process for FFmpeg
let rtpStreamProcess = null;
let rtpPort = 5004;

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

  // Load the app
  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  if (fs.existsSync(rendererPath)) {
    mainWindow.loadFile(rendererPath);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Save window bounds on close
  mainWindow.on('close', () => {
    store.set('windowBounds', mainWindow.getBounds());
    
    // Clean up processes
    if (ffmpegProcess) {
      ffmpegProcess.kill('SIGTERM');
    }
    if (rtpStreamProcess) {
      rtpStreamProcess.kill('SIGTERM');
    }
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
      label: 'Connection',
      submenu: [
        {
          label: 'WebRTC Settings',
          click: () => {
            mainWindow.webContents.send('menu-action', 'webrtc-settings');
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
              message: 'Remote Desktop Control v2.0.0 - WebRTC Edition',
              detail: 'Ultra low-latency remote desktop with WebRTC P2P streaming.\n\n• FFmpeg RTP encoding with zerolatency\n• WebRTC DataChannels for input\n• <50ms end-to-end latency\n• Frame skipping for real-time performance',
              buttons: ['OK']
            });
          }
        },
        {
          label: 'WebRTC Info',
          click: () => {
            mainWindow.webContents.send('menu-action', 'webrtc-info');
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

// FFmpeg utilities (enhanced for WebRTC RTP streaming)
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
  
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch (e) {
    // ffmpeg-static not available
  }
  
  return 'ffmpeg';
}

function checkFFmpegAvailability() {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    
    console.log('🔍 Checking FFmpeg availability:', ffmpegPath);
    
    const child = exec(`"${ffmpegPath}" -version`, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ FFmpeg check failed:', error.message);
        resolve({
          available: false,
          path: ffmpegPath,
          error: error.message
        });
      } else {
        const versionMatch = stdout.match(/ffmpeg version (\S+)/);
        const hasH264 = stdout.includes('libx264');
        const hasRTP = stdout.includes('rtp');
        
        console.log('✅ FFmpeg available:', versionMatch ? versionMatch[1] : 'unknown');
        
        resolve({
          available: true,
          path: ffmpegPath,
          version: versionMatch ? versionMatch[1] : 'unknown',
          info: stdout.split('\n')[0],
          webrtcSupport: hasH264 && hasRTP,
          h264Support: hasH264,
          rtpSupport: hasRTP
        });
      }
    });

    // Handle timeout
    child.on('error', (error) => {
      console.error('❌ FFmpeg process error:', error);
      resolve({
        available: false,
        path: ffmpegPath,
        error: error.message
      });
    });
  });
}

// FIXED: WebRTC RTP Stream with FFmpeg (Ultra Low Latency) - Single implementation
function startWebRTCScreenCapture(options = {}) {
  if (isCapturing) {
    console.log('⚠️ Screen capture already in progress');
    return { success: false, error: 'Already capturing' };
  }

  const {
    fps = 30,
    quality = 70,
    bitrate = '2000k',
    rtpDestination = '127.0.0.1'
  } = options;

  const ffmpegPath = getFFmpegPath();
  const platform = process.platform;
  
  // Find available RTP port
  rtpPort = 5004;
  
  // Platform-specific input arguments for maximum performance
  let inputArgs = [];
  
  switch (platform) {
    case 'win32':
      // Windows: Use gdigrab with fastest settings
      inputArgs = [
        '-f', 'gdigrab',
        '-framerate', fps.toString(),
        '-offset_x', '0',
        '-offset_y', '0',
        '-video_size', 'desktop',
        '-i', 'desktop'
      ];
      break;
      
    case 'darwin':
      // macOS: Use avfoundation with hardware acceleration
      inputArgs = [
        '-f', 'avfoundation',
        '-framerate', fps.toString(),
        '-video_size', '1920x1080',
        '-i', '1:none'  // Screen 1, explicitly no audio
      ];
      break;
      
    case 'linux':
      // Linux: Use x11grab with fastest settings
      const display = process.env.DISPLAY || ':0';
      inputArgs = [
        '-f', 'x11grab',
        '-framerate', fps.toString(),
        '-video_size', '1920x1080',
        '-i', display
      ];
      break;
      
    default:
      console.error('❌ Unsupported platform for screen capture');
      return { success: false, error: 'Unsupported platform' };
  }

  // WebRTC-optimized H.264 encoding arguments (ULTRA LOW LATENCY)
  const outputArgs = [
    // Video codec settings for WebRTC
    '-c:v', 'libx264',
    '-preset', 'ultrafast',          // Fastest encoding
    '-tune', 'zerolatency',          // No buffering/B-frames
    '-profile:v', 'baseline',        // WebRTC compatible
    '-level', '3.1',                 // WebRTC level
    
    // Keyframe settings (critical for WebRTC)
    '-g', (fps * 2).toString(),      // Keyframe every 2 seconds
    '-keyint_min', fps.toString(),   // Minimum keyframe interval
    '-sc_threshold', '0',            // Disable scene detection
    
    // Rate control for consistent quality
    '-b:v', bitrate,
    '-maxrate', bitrate,
    '-bufsize', bitrate,
    '-crf', '23',                    // Quality setting
    
    // Pixel format (WebRTC standard)
    '-pix_fmt', 'yuv420p',
    
    // Thread settings
    '-threads', '0',                 // Use all available cores
    
    // Error handling
    '-y',                           // Overwrite output files
    '-loglevel', 'warning',         // Reduce verbose output
    
    // RTP output with payload type 96 (H.264)
    '-f', 'rtp',
    '-payload_type', '96',
    `rtp://${rtpDestination}:${rtpPort}`
  ];

  const ffmpegArgs = [
    // Input arguments
    ...inputArgs,
    // Output arguments  
    ...outputArgs
  ];

  console.log('🎬 Starting WebRTC FFmpeg capture');
  console.log(`📡 RTP stream: rtp://${rtpDestination}:${rtpPort}`);

  try {
    rtpStreamProcess = spawn(ffmpegPath, ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    isCapturing = true;

    // Handle RTP stream output with better error checking
    rtpStreamProcess.stderr.on('data', (data) => {
      const output = data.toString();
      
      // Check for fatal errors first
      if (output.includes('Invalid data found') || 
          output.includes('No such file') ||
          output.includes('Permission denied') ||
          output.includes('Cannot grab') ||
          output.includes('Connection refused')) {
        console.error('❌ FFmpeg fatal error:', output.trim());
        isCapturing = false;
        mainWindow?.webContents.send('webrtc-error', output.trim());
        return;
      }
      
      // Parse FFmpeg statistics for performance monitoring
      if (output.includes('frame=')) {
        const frameMatch = output.match(/frame=\s*(\d+)/);
        const fpsMatch = output.match(/fps=\s*([\d.]+)/);
        const bitrateMatch = output.match(/bitrate=\s*([\d.]+)kbits\/s/);
        
        if (frameMatch || fpsMatch || bitrateMatch) {
          mainWindow?.webContents.send('webrtc-stats', {
            frames: frameMatch ? parseInt(frameMatch[1]) : 0,
            fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
            bitrate: bitrateMatch ? parseFloat(bitrateMatch[1]) : 0,
            timestamp: Date.now()
          });
        }
      }
      
      // Only log non-stats output in development
      if (isDev && !output.includes('frame=') && !output.includes('time=')) {
        console.log('FFmpeg:', output.trim());
      }
    });

    // Better error handling
    rtpStreamProcess.on('error', (error) => {
      console.error('❌ WebRTC FFmpeg process error:', error);
      isCapturing = false;
      mainWindow?.webContents.send('webrtc-error', `FFmpeg process error: ${error.message}`);
    });

    rtpStreamProcess.on('close', (code, signal) => {
      console.log(`📹 WebRTC FFmpeg closed: code=${code}, signal=${signal}`);
      isCapturing = false;
      rtpStreamProcess = null;
      
      // Only send error if it was unexpected closure
      if (code !== 0 && code !== null && !signal) {
        mainWindow?.webContents.send('webrtc-error', `FFmpeg exited with code ${code}`);
      }
    });

    // Handle process exit gracefully
    rtpStreamProcess.on('exit', (code, signal) => {
      console.log(`📹 FFmpeg process exited: code=${code}, signal=${signal}`);
      if (isCapturing) {
        isCapturing = false;
        mainWindow?.webContents.send('webrtc-stopped');
      }
    });

    // Send RTP stream info to renderer for WebRTC setup
    setTimeout(() => {
      if (isCapturing && rtpStreamProcess && !rtpStreamProcess.killed) {
        mainWindow?.webContents.send('webrtc-rtp-ready', {
          rtpAddress: rtpDestination,
          rtpPort: rtpPort,
          codec: 'H264',
          payloadType: 96
        });
      }
    }, 1000); // Wait 1 second for FFmpeg to start

    return { 
      success: true, 
      pid: rtpStreamProcess.pid,
      rtpPort: rtpPort,
      rtpAddress: rtpDestination,
      options: { fps, quality, bitrate }
    };

  } catch (error) {
    console.error('❌ Failed to start WebRTC capture:', error);
    isCapturing = false;
    return { success: false, error: error.message };
  }
}

function stopWebRTCScreenCapture() {
  if (!isCapturing || !rtpStreamProcess) {
    return { success: false, error: 'No capture in progress' };
  }

  console.log('🛑 Stopping WebRTC screen capture');
  
  try {
    // Send quit command to FFmpeg first (graceful)
    if (rtpStreamProcess.stdin && !rtpStreamProcess.stdin.destroyed) {
      rtpStreamProcess.stdin.write('q\n');
    }
    
    // Wait for graceful shutdown, then force if needed
    setTimeout(() => {
      if (rtpStreamProcess && !rtpStreamProcess.killed) {
        console.log('⚠️ Force terminating FFmpeg process');
        rtpStreamProcess.kill('SIGTERM');
        
        // Last resort: SIGKILL after 2 more seconds
        setTimeout(() => {
          if (rtpStreamProcess && !rtpStreamProcess.killed) {
            rtpStreamProcess.kill('SIGKILL');
          }
        }, 2000);
      }
    }, 3000);
    
    isCapturing = false;
    mainWindow?.webContents.send('webrtc-stopped');
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error stopping WebRTC capture:', error);
    return { success: false, error: error.message };
  }
}

// Input simulation functions
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
  // Clean up processes
  if (rtpStreamProcess) {
    rtpStreamProcess.kill('SIGTERM');
  }
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
  }
  
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

// WebRTC FFmpeg handlers
ipcMain.handle('check-ffmpeg-availability', async () => {
  return await checkFFmpegAvailability();
});

ipcMain.handle('start-webrtc-capture', (event, options) => {
  return startWebRTCScreenCapture(options);
});

ipcMain.handle('stop-webrtc-capture', () => {
  return stopWebRTCScreenCapture();
});

// Input simulation handlers
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

// FIXED: Screen sources handler - Single implementation with better error handling
ipcMain.handle('get-screen-sources', async () => {
  try {
    console.log('📺 Getting screen sources for WebRTC...');
    
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: {
        width: 150,
        height: 150
      },
      fetchWindowIcons: true
    });
    
    const formattedSources = sources.map(source => {
      let thumbnail = null;
      let appIcon = null;
      
      try {
        thumbnail = source.thumbnail ? source.thumbnail.toDataURL() : null;
      } catch (thumbError) {
        console.warn(`⚠️ Failed to get thumbnail for ${source.name}:`, thumbError.message);
      }
      
      try {
        appIcon = source.appIcon ? source.appIcon.toDataURL() : null;
      } catch (iconError) {
        console.warn(`⚠️ Failed to get icon for ${source.name}:`, iconError.message);
      }
      
      return {
        id: source.id,
        name: source.name,
        thumbnail: thumbnail,
        display_id: source.display_id,
        appIcon: appIcon
      };
    });
    
    console.log(`📺 Found ${formattedSources.length} screen sources`);
    
    return {
      success: true,
      sources: formattedSources
    };
    
  } catch (error) {
    console.error('❌ Failed to get screen sources:', error);
    return {
      success: false,
      error: error.message,
      sources: []
    };
  }
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

// Additional handler for getting primary display info
ipcMain.handle('get-primary-display', () => {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    return {
      success: true,
      display: {
        id: primaryDisplay.id,
        bounds: primaryDisplay.bounds,
        workArea: primaryDisplay.workArea,
        scaleFactor: primaryDisplay.scaleFactor,
        size: primaryDisplay.size
      }
    };
  } catch (error) {
    console.error('❌ Failed to get primary display:', error);
    return {
      success: false,
      error: error.message
    };
  }
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

// Security
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (navigationEvent, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  
  if (rtpStreamProcess) {
    console.log('📹 Terminating WebRTC stream...');
    rtpStreamProcess.kill('SIGTERM');
  }
  
  if (ffmpegProcess) {
    console.log('🎬 Terminating FFmpeg...');
    ffmpegProcess.kill('SIGTERM');
  }
  
  app.quit();
});

process.on('SIGTERM', () => {
  if (rtpStreamProcess) {
    rtpStreamProcess.kill('SIGTERM');
  }
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
  }
  app.quit();
});