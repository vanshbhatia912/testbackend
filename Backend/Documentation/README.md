# 🖥️ Modern Remote Desktop Control - Cross Platform

A modern, dark-themed remote desktop application built with Electron for the frontend and Node.js for the backend. Features low latency streaming, dual mouse cursors, multiple quality options, and cross-platform support (Windows, Linux, macOS).

## ✨ Features

- 🌙 **Modern Dark UI** - Beautiful glass morphism design
- 🖱️ **Dual Mouse Cursors** - See both local and remote mouse positions
- ⚡ **Low Latency** - Optimized for real-time control
- 🎚️ **Multiple Quality Options** - 5-30 FPS with adjustable quality
- 🌍 **Cross Platform** - Works on Windows, Linux, and macOS
- 🔧 **Configurable Server** - Deploy backend anywhere
- 📱 **Mobile Support** - Touch controls for mobile devices
- 🔒 **Secure Sessions** - Password-protected connections
- 📊 **Performance Monitoring** - Real-time stats and metrics

## 🚀 Quick Start

### Option 1: Run Everything Locally

```bash
# Clone the repository
git clone <your-repo-url>
cd remote-desktop-app

# Install Electron app dependencies
npm install

# Install backend dependencies
cd backend
npm install
npm run install-optional  # Install screen capture libraries

# Start backend server
npm start

# In another terminal, start Electron app
cd ../
npm start
```

### Option 2: Separate Backend Deployment

#### Deploy Backend Server

```bash
# On your server machine
git clone <your-repo-url>
cd remote-desktop-app/backend

# Install dependencies
npm install

# Install optional dependencies for screen sharing (may require build tools)
npm run install-optional

# Start server
PORT=3000 HOST=0.0.0.0 npm start

# Server will be available at http://your-server-ip:3000
```

#### Run Electron Client

```bash
# On client machines
cd remote-desktop-app
npm install
npm start

# Configure server URL in the app settings
# Go to Settings > Connection > Default Server URL
# Enter: http://your-server-ip:3000
```

## 📋 System Requirements

### For Electron Client (Frontend)
- **Node.js** 14.0.0 or later
- **npm** 6.0.0 or later
- **OS**: Windows 10+, Ubuntu 18.04+, macOS 10.14+
- **RAM**: 512MB minimum, 1GB recommended
- **Disk**: 200MB free space

### For Backend Server
- **Node.js** 14.0.0 or later
- **OS**: Any platform supporting Node.js
- **RAM**: 1GB minimum, 2GB+ for multiple sessions
- **Network**: Stable internet connection
- **Optional**: Build tools for native dependencies

## 🛠️ Installation Guide

### Windows Setup

#### Electron Client
```cmd
# Install Node.js from https://nodejs.org/
# Open Command Prompt as Administrator

cd path\to\remote-desktop-app
npm install

# If you encounter build errors:
npm install --global windows-build-tools
npm install

npm start
```

#### Backend Server
```cmd
cd path\to\remote-desktop-app\backend
npm install

# Install optional screen capture libraries
npm install screenshot-desktop --optional
npm install robotjs --build-from-source --optional

# Start server
npm start
```

### Linux Setup

#### Electron Client
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install dependencies
sudo apt-get install -y build-essential libnss3-dev libatk-bridge2.0-dev libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxss1 libasound2-dev

cd /path/to/remote-desktop-app
npm install
npm start
```

#### Backend Server
```bash
# Install build dependencies
sudo apt-get install -y build-essential libx11-dev libxtst6 libxrandr2 libxi6

cd /path/to/remote-desktop-app/backend
npm install
npm run install-optional

# Start server
npm start
```

### macOS Setup

#### Electron Client
```bash
# Install Node.js from https://nodejs.org/ or use Homebrew
brew install node

cd /path/to/remote-desktop-app
npm install
npm start
```

#### Backend Server
```bash
# Install Xcode command line tools
xcode-select --install

cd /path/to/remote-desktop-app/backend
npm install
npm run install-optional

# Start server
npm start
```

## 🔧 Configuration

### Backend Server Configuration

Create a `.env` file in the backend directory:

```env
# Server Configuration
PORT=3000
HOST=0.0.0.0

# Performance Settings
MAX_SESSIONS=10
MAX_CONTROLLERS_PER_SESSION=3
CLEANUP_INTERVAL=300000

# Security Settings
ENABLE_CORS=true
ALLOWED_ORIGINS=*

# Quality Settings
DEFAULT_QUALITY=medium
MAX_QUALITY=ultra
```

### Electron App Configuration

The app stores settings in the user's data directory. You can also configure via the Settings UI:

- **Server URL**: Default backend server address
- **Quality**: Default streaming quality (low/medium/high/ultra)
- **Auto Connect**: Automatically connect to server on startup
- **Mouse Sensitivity**: Adjust mouse movement sensitivity
- **Keyboard Layout**: Configure keyboard mapping

## 🌐 Deployment Options

### Docker Deployment (Backend)

Create `Dockerfile` in backend directory:
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY server.js ./
EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:
```bash
cd backend
docker build -t remote-desktop-server .
docker run -p 3000:3000 remote-desktop-server
```

### Cloud Deployment

#### Heroku
```bash
cd backend
heroku create your-app-name
git push heroku main
```

#### DigitalOcean/AWS/GCP
- Deploy using Docker or Node.js runtime
- Configure firewall to allow port 3000
- Set up reverse proxy (nginx) for HTTPS
- Configure environment variables

### Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 📱 Usage Guide

### Hosting a Session

1. **Start the Application**
   - Open the Electron app
   - Ensure backend server is running

2. **Create Session**
   - Click "Share Your Screen" card
   - Click "Generate Session"
   - Copy Session ID and Password

3. **Start Hosting**
   - Click "Start Hosting"
   - Grant screen recording permissions when prompted
   - Session is now active and ready for connections

4. **Share Session**
   - Share Session ID and Password with controllers
   - Or use "Generate Share URL" for easy sharing
   - Or show QR code for mobile users

### Joining a Session

1. **Connect as Controller**
   - Click "Control Remote PC" card
   - Enter Session ID (6 digits) and Password
   - Choose Full Control or View Only mode

2. **Control Options**
   - **Full Control**: Mouse and keyboard control
   - **View Only**: Watch screen without control

3. **Using Controls**
   - Click on remote screen to focus
   - Use mouse normally for control
   - All keyboard shortcuts work (Ctrl+C, Alt+Tab, etc.)
   - Use Quick Actions panel for common shortcuts

### Quality Settings

- **Low (5 FPS)**: Best for slow connections, minimal bandwidth
- **Medium (10 FPS)**: Balanced performance and quality
- **High (15 FPS)**: Good for fast connections, smooth experience  
- **Ultra (30 FPS)**: Best quality, requires excellent connection

## 🛠️ Troubleshooting

### Common Issues

#### "Screen capture not working"
```bash
# Linux: Install required packages
sudo apt-get install libx11-dev libxtst6

# macOS: Grant accessibility permissions
System Preferences > Security & Privacy > Accessibility
```

#### "Robot control not working"  
```bash
# Try rebuilding native dependencies
npm rebuild robotjs

# Or install from source
npm install robotjs --build-from-source
```

#### "Connection failed"
- Check if backend server is running
- Verify server URL in app settings
- Check firewall settings
- Ensure port 3000 is open

#### "Permission denied" errors
```bash
# Linux: Run with proper permissions
sudo npm start

# Or fix npm permissions
sudo chown -R $(whoami) ~/.npm
```

#### Build errors on Windows
```cmd
# Install build tools
npm install --global windows-build-tools

# Install Visual Studio Build Tools
# Download from Microsoft Visual Studio website
```

### Performance Issues

#### Improve Frame Rate
- Lower screen resolution on host
- Close unnecessary applications
- Use wired internet connection
- Choose appropriate quality setting

#### Reduce Latency
- Deploy backend server geographically closer
- Use dedicated server instead of shared hosting
- Optimize network settings
- Use WebSocket transport only

#### Memory Issues
- Restart application periodically
- Monitor session count on server
- Clean up inactive sessions
- Use process managers like PM2

### Debug Mode

Enable debug logging:
```bash
# Backend server
DEBUG=* npm start

# Or specific modules
DEBUG=socket.io* npm start
```

Electron app debug:
- Open Developer Tools (Ctrl+Shift+I)
- Check Console for errors
- Monitor Network tab for connection issues

## 📁 File Structure

```
remote-desktop-app/
├── 📦 Frontend (Electron App)
│   ├── package.json                 # Electron app dependencies
│   ├── src/
│   │   ├── main.js                  # Main Electron process
│   │   ├── preload.js               # Preload script (security bridge)
│   │   └── renderer/
│   │       ├── index.html           # Main UI HTML
│   │       ├── styles.css           # Modern dark theme styles
│   │       └── renderer.js          # Frontend logic & Socket.IO client
│   ├── assets/
│   │   ├── icon.png                 # App icon (Linux)
│   │   ├── icon.ico                 # App icon (Windows)
│   │   └── icon.icns                # App icon (macOS)
│   └── dist/                        # Built app files (after npm run build)
│
├── 📡 Backend (Separate Server)
│   ├── server.js                    # Main server file
│   ├── package.json                 # Server dependencies
│   ├── .env                         # Environment variables (optional)
│   ├── public/                      # Static web files (optional)
│   │   └── index.html               # Web interface (optional)
│   ├── test/
│   │   └── test-server.js           # Server tests
│   ├── docker/
│   │   ├── Dockerfile               # Docker container setup
│   │   └── docker-compose.yml       # Multi-container setup
│   └── scripts/
│       ├── install-deps.sh          # Platform-specific installs
│       └── deploy.sh                # Deployment script
│
├── 📚 Documentation
│   ├── README.md                    # This file
│   ├── API.md                       # Backend API documentation
│   ├── CONTRIBUTING.md              # Contribution guidelines
│   └── CHANGELOG.md                 # Version history
│
├── 🔧 Configuration
│   ├── .gitignore                   # Git ignore rules
│   ├── .eslintrc.js                 # Code linting rules
│   ├── .prettierrc                  # Code formatting rules
│   └── tsconfig.json                # TypeScript config (if using TS)
│
└── 🚀 Deployment
    ├── nginx/
    │   └── remote-desktop.conf       # Reverse proxy config
    ├── systemd/
    │   └── remote-desktop.service    # Linux service file
    └── pm2/
        └── ecosystem.config.js       # Process manager config
```

### Detailed File Descriptions

#### Frontend Files (Electron App)

**`src/main.js`** - Main Electron process
- Creates application window
- Handles system integration (menus, tray, etc.)
- Manages window state and settings
- Implements security policies

**`src/preload.js`** - Security bridge
- Exposes safe APIs to renderer process
- Handles IPC communication
- Provides utility functions
- Manages platform-specific features

**`src/renderer/index.html`** - Main UI
- Modern dark theme interface
- Responsive design for all screen sizes
- Glass morphism effects
- Comprehensive control panels

**`src/renderer/styles.css`** - CSS styles
- Dark theme with blue accents
- Smooth animations and transitions
- Cross-platform consistent design
- Responsive grid layouts

**`src/renderer/renderer.js`** - Frontend logic
- Socket.IO client implementation
- UI event handlers
- Screen rendering and mouse/keyboard handling
- Settings management and persistence

#### Backend Files (Server)

**`server.js`** - Main server application
- Express.js web server
- Socket.IO real-time communication
- Cross-platform screen capture
- Mouse and keyboard control
- Session management
- Performance monitoring

**`package.json`** - Dependencies and scripts
- Production and development dependencies
- Optional native dependencies
- Cross-platform build scripts
- Docker and deployment commands

#### Configuration Files

**`.env`** - Environment variables
```env
PORT=3000
HOST=0.0.0.0
MAX_SESSIONS=10
ENABLE_CORS=true
DEBUG=false
```

**`ecosystem.config.js`** - PM2 process manager
```javascript
module.exports = {
  apps: [{
    name: 'remote-desktop-server',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
```

#### Deployment Files

**`Dockerfile`** - Container setup
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY server.js ./
EXPOSE 3000
CMD ["npm", "start"]
```

**`nginx/remote-desktop.conf`** - Reverse proxy
```nginx
upstream remote_desktop {
    server localhost:3000;
}

server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://remote_desktop;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```

**`systemd/remote-desktop.service`** - Linux service
```ini
[Unit]
Description=Remote Desktop Server
After=network.target

[Service]
Type=simple
User=nodejs
WorkingDirectory=/opt/remote-desktop
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## 🎯 Development Workflow

### For Frontend Development
```bash
# Start in development mode
npm run dev

# Build for production
npm run build

# Package for distribution
npm run dist
```

### For Backend Development
```bash
# Start with auto-reload
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

### Full Stack Development
```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start frontend  
cd ..
npm run dev

# Both will auto-reload on file changes
```

## 📊 Monitoring & Analytics

### Server Monitoring
- Health check endpoint: `GET /health`
- Session statistics: `GET /api/sessions`
- Real-time performance metrics via Socket.IO
- Memory and CPU usage tracking

### Client Monitoring
- Connection status indicators
- Frame rate and bandwidth monitoring  
- Latency measurements
- Error reporting and logging

### Performance Metrics
- **Latency**: Round-trip time for commands
- **Frame Rate**: Actual FPS vs target FPS
- **Bandwidth**: Data transfer rates
- **Quality**: Compression ratio and image quality
- **Session Count**: Active concurrent sessions

## 🔐 Security Considerations

### Network Security
- Use HTTPS/WSS in production
- Implement rate limiting
- Configure CORS properly
- Use reverse proxy for additional security

### Session Security
- Random session ID generation
- Strong password requirements
- Session timeout and cleanup
- User authentication (optional)

### System Security
- Screen recording permissions
- Keyboard/mouse control permissions
- Sandboxed Electron renderer
- Input validation and sanitization

This comprehensive file structure and setup guide provides everything needed to deploy and run the modern remote desktop application across different platforms and deployment scenarios.