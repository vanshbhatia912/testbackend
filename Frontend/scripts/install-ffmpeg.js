const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

class FFmpegInstaller {
    constructor() {
        this.platform = os.platform();
        this.arch = os.arch();
        // Fixed: Correct path to ffmpeg directory
        this.ffmpegDir = path.join(__dirname, '..', 'ffmpeg');
        this.ffmpegPath = this.getFFmpegPath();
    }

    getFFmpegPath() {
        switch (this.platform) {
            case 'win32':
                return path.join(this.ffmpegDir, 'ffmpeg.exe');
            case 'darwin':
            case 'linux':
                return path.join(this.ffmpegDir, 'ffmpeg');
            default:
                return 'ffmpeg';
        }
    }

    async checkFFmpeg() {
        return new Promise((resolve) => {
            // First check if ffmpeg exists in our local directory
            if (fs.existsSync(this.ffmpegPath)) {
                console.log('✅ FFmpeg found in local directory');
                resolve(true);
                return;
            }

            // Check if ffmpeg is available in system PATH
            exec('ffmpeg -version', (error, stdout) => {
                if (!error) {
                    console.log('✅ FFmpeg found in system PATH');
                    console.log('Version info:', stdout.split('\n')[0]);
                    resolve(true);
                } else {
                    console.log('❌ FFmpeg not found');
                    resolve(false);
                }
            });
        });
    }

    async installFFmpeg() {
        console.log('🚀 Installing FFmpeg...');

        // Create ffmpeg directory if it doesn't exist
        if (!fs.existsSync(this.ffmpegDir)) {
            fs.mkdirSync(this.ffmpegDir, { recursive: true });
            console.log('📁 Created ffmpeg directory:', this.ffmpegDir);
        }

        try {
            // Try using ffmpeg-static package first
            try {
                const ffmpegStatic = require('ffmpeg-static');
                if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
                    console.log('✅ Using ffmpeg-static package:', ffmpegStatic);
                    // Copy ffmpeg-static binary to our directory
                    fs.copyFileSync(ffmpegStatic, this.ffmpegPath);
                    if (this.platform !== 'win32') {
                        fs.chmodSync(this.ffmpegPath, '755');
                    }
                    console.log('✅ FFmpeg installed successfully via ffmpeg-static');
                    return true;
                }
            } catch (e) {
                console.log('⚠️ ffmpeg-static not available, trying alternative installation');
            }

            // Platform-specific installation
            switch (this.platform) {
                case 'win32':
                    await this.installWindowsFFmpeg();
                    break;
                case 'darwin':
                    await this.installMacFFmpeg();
                    break;
                case 'linux':
                    await this.installLinuxFFmpeg();
                    break;
                default:
                    throw new Error(`Unsupported platform: ${this.platform}`);
            }

            // Verify installation
            if (fs.existsSync(this.ffmpegPath)) {
                console.log('✅ FFmpeg installation completed successfully');
                return true;
            } else {
                throw new Error('FFmpeg binary not found after installation');
            }

        } catch (error) {
            console.error('❌ FFmpeg installation failed:', error.message);
            console.log('💡 Please install FFmpeg manually:');
            this.printManualInstallInstructions();
            return false;
        }
    }

    async installWindowsFFmpeg() {
        console.log('📦 Installing FFmpeg for Windows...');
        
        // For Windows, we recommend manual installation
        console.log('💡 For Windows, please download FFmpeg from:');
        console.log('   https://www.gyan.dev/ffmpeg/builds/');
        console.log('   Extract ffmpeg.exe to:', this.ffmpegDir);
        
        // Try to use winget if available
        return new Promise((resolve) => {
            console.log('🔍 Trying winget installation...');
            exec('winget install --id=Gyan.FFmpeg -e', (error, stdout, stderr) => {
                if (!error) {
                    console.log('✅ FFmpeg installed via winget');
                    // Try to find installed FFmpeg
                    this.findAndCopySystemFFmpeg();
                    resolve(true);
                } else {
                    console.log('❌ winget installation failed:', error.message);
                    console.log('Manual installation required');
                    resolve(false);
                }
            });
        });
    }

    async installMacFFmpeg() {
        console.log('📦 Installing FFmpeg for macOS...');
        
        return new Promise((resolve) => {
            // Try homebrew first
            console.log('🔍 Trying Homebrew installation...');
            exec('brew install ffmpeg', (error, stdout, stderr) => {
                if (!error) {
                    console.log('✅ FFmpeg installed via Homebrew');
                    // Try to find ffmpeg in common homebrew locations
                    const homebrewPaths = [
                        '/opt/homebrew/bin/ffmpeg',  // Apple Silicon
                        '/usr/local/bin/ffmpeg',     // Intel Mac
                        '/opt/local/bin/ffmpeg'      // MacPorts
                    ];
                    
                    for (const brewPath of homebrewPaths) {
                        if (fs.existsSync(brewPath)) {
                            console.log('📋 Copying FFmpeg from:', brewPath);
                            fs.copyFileSync(brewPath, this.ffmpegPath);
                            fs.chmodSync(this.ffmpegPath, '755');
                            console.log('✅ FFmpeg copied to local directory');
                            break;
                        }
                    }
                    resolve(true);
                } else {
                    console.log('❌ Homebrew installation failed:', error.message);
                    console.log('💡 Please install Homebrew first: https://brew.sh');
                    console.log('   Then run: brew install ffmpeg');
                    resolve(false);
                }
            });
        });
    }

    async installLinuxFFmpeg() {
        console.log('📦 Installing FFmpeg for Linux...');
        
        return new Promise((resolve) => {
            // Try different package managers
            const commands = [
                { cmd: 'apt-get update && apt-get install -y ffmpeg', name: 'apt-get (Ubuntu/Debian)' },
                { cmd: 'yum install -y ffmpeg', name: 'yum (CentOS/RHEL)' },
                { cmd: 'dnf install -y ffmpeg', name: 'dnf (Fedora)' },
                { cmd: 'pacman -S ffmpeg --noconfirm', name: 'pacman (Arch)' },
                { cmd: 'zypper install -y ffmpeg', name: 'zypper (openSUSE)' },
                { cmd: 'snap install ffmpeg', name: 'snap (Universal)' }
            ];

            const tryCommand = (index) => {
                if (index >= commands.length) {
                    console.log('❌ All package manager attempts failed');
                    resolve(false);
                    return;
                }

                const { cmd, name } = commands[index];
                console.log(`🔍 Trying ${name}...`);
                
                exec(cmd, (error, stdout, stderr) => {
                    if (!error) {
                        console.log(`✅ FFmpeg installed via ${name}`);
                        // Copy system ffmpeg to our directory
                        this.findAndCopySystemFFmpeg();
                        resolve(true);
                    } else {
                        console.log(`❌ ${name} failed, trying next...`);
                        tryCommand(index + 1);
                    }
                });
            };

            tryCommand(0);
        });
    }

    findAndCopySystemFFmpeg() {
        console.log('🔍 Looking for system FFmpeg...');
        
        exec('which ffmpeg', (err, stdout) => {
            if (!err && stdout.trim()) {
                const systemPath = stdout.trim();
                console.log('📋 Found system FFmpeg at:', systemPath);
                
                try {
                    fs.copyFileSync(systemPath, this.ffmpegPath);
                    if (this.platform !== 'win32') {
                        fs.chmodSync(this.ffmpegPath, '755');
                    }
                    console.log('✅ System FFmpeg copied to local directory');
                } catch (error) {
                    console.log('⚠️ Could not copy system FFmpeg:', error.message);
                }
            }
        });
    }

    printManualInstallInstructions() {
        console.log('\n📋 Manual Installation Instructions:');
        console.log('='.repeat(50));
        
        switch (this.platform) {
            case 'win32':
                console.log('Windows:');
                console.log('1. Download from: https://www.gyan.dev/ffmpeg/builds/');
                console.log('2. Extract ffmpeg.exe from the archive');
                console.log(`3. Place ffmpeg.exe in: ${this.ffmpegPath}`);
                console.log('');
                console.log('Alternative methods:');
                console.log('• Winget: winget install --id=Gyan.FFmpeg');
                console.log('• Chocolatey: choco install ffmpeg');
                console.log('• Scoop: scoop install ffmpeg');
                break;
                
            case 'darwin':
                console.log('macOS:');
                console.log('1. Install Homebrew:');
                console.log('   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
                console.log('2. Install FFmpeg: brew install ffmpeg');
                console.log('');
                console.log('Alternative: MacPorts: sudo port install ffmpeg');
                break;
                
            case 'linux':
                console.log('Linux:');
                console.log('Ubuntu/Debian: sudo apt update && sudo apt install ffmpeg');
                console.log('CentOS/RHEL: sudo yum install epel-release && sudo yum install ffmpeg');
                console.log('Fedora: sudo dnf install ffmpeg');
                console.log('Arch Linux: sudo pacman -S ffmpeg');
                console.log('openSUSE: sudo zypper install ffmpeg');
                console.log('Universal: sudo snap install ffmpeg');
                break;
        }
        
        console.log('='.repeat(50));
        console.log('After manual installation, the app should detect FFmpeg automatically.');
        console.log(`Target location: ${this.ffmpegPath}`);
        console.log('');
    }

    async verifyInstallation() {
        console.log('🔍 Verifying FFmpeg installation...');
        
        return new Promise((resolve) => {
            const testPath = fs.existsSync(this.ffmpegPath) ? this.ffmpegPath : 'ffmpeg';
            
            exec(`"${testPath}" -version`, (error, stdout, stderr) => {
                if (!error && stdout) {
                    const versionMatch = stdout.match(/ffmpeg version (\S+)/);
                    const version = versionMatch ? versionMatch[1] : 'unknown';
                    
                    console.log('✅ FFmpeg verification successful');
                    console.log(`   Version: ${version}`);
                    console.log(`   Path: ${testPath}`);
                    
                    // Test basic functionality
                    console.log('🧪 Testing FFmpeg functionality...');
                    exec(`"${testPath}" -f lavfi -i testsrc=duration=1:size=320x240:rate=1 -f null -`, (testError) => {
                        if (!testError) {
                            console.log('✅ FFmpeg functionality test passed');
                        } else {
                            console.log('⚠️ FFmpeg basic test failed, but binary exists');
                        }
                        resolve(true);
                    });
                } else {
                    console.log('❌ FFmpeg verification failed');
                    if (error) console.log('Error:', error.message);
                    resolve(false);
                }
            });
        });
    }

    async run() {
        console.log('🎬 FFmpeg Setup for Remote Desktop');
        console.log('='.repeat(40));
        console.log(`Platform: ${this.platform} ${this.arch}`);
        console.log(`Target directory: ${this.ffmpegDir}`);
        console.log('='.repeat(40));
        
        const ffmpegExists = await this.checkFFmpeg();
        
        if (!ffmpegExists) {
            console.log('⬇️ FFmpeg not found, attempting installation...');
            const installSuccess = await this.installFFmpeg();
            
            if (!installSuccess) {
                console.log('');
                console.log('⚠️ FFmpeg installation incomplete.');
                console.log('   The application will still function, but screen capture');
                console.log('   capabilities will be limited or unavailable.');
                console.log('');
                console.log('   Please follow the manual installation instructions above');
                console.log('   for the best experience.');
                
                // Don't fail the build - allow app to run with limited functionality
                process.exit(0);
            }
        }

        // Verify the installation
        const verified = await this.verifyInstallation();
        if (verified) {
            console.log('');
            console.log('🎉 FFmpeg setup completed successfully!');
            console.log('   Remote Desktop is ready with full screen capture capabilities.');
        } else {
            console.log('');
            console.log('⚠️ FFmpeg setup completed with warnings.');
            console.log('   Please verify your FFmpeg installation manually.');
        }
        
        console.log('='.repeat(40));
    }
}

// Run the installer
if (require.main === module) {
    const installer = new FFmpegInstaller();
    installer.run().catch(error => {
        console.error('❌ FFmpeg setup failed:', error);
        console.log('');
        console.log('This is not a critical error. The application will still work');
        console.log('but with limited screen capture capabilities.');
        process.exit(0); // Don't fail the build
    });
}

module.exports = FFmpegInstaller;