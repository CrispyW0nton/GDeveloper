# Building GDeveloper for Windows

## Quick Start

```bash
git clone https://github.com/CrispyW0nton/GDeveloper.git
cd GDeveloper
npm install
npm run build
build_windows.bat
```

Or step by step:

```bash
npm install                  # Install dependencies
npm run fix-codesign         # Pre-populate electron-builder cache (fixes symlink error)
npx electron-vite build      # Build renderer + main process
npm run package              # Package to .exe (NSIS installer + portable)
```

## Build Targets

| Command | Output | Description |
|---------|--------|-------------|
| `npm run package` | NSIS installer + portable .exe | Full build (default) |
| `npm run package:nsis` | NSIS installer only | Setup wizard installer |
| `npm run package:portable` | Single portable .exe | No installation needed |
| `npm run package:dir` | Unpacked directory | Fastest, no signing at all |

Output is in `dist-package/`.

## The "Cannot Create Symbolic Link" Error

### What Happens

When packaging on Windows, you may see:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
C:\Users\...\electron-builder\Cache\winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
```

### Why It Happens

electron-builder downloads `winCodeSign-2.6.0.7z` which contains macOS symlinks (`libcrypto.dylib` -> `libcrypto.1.1.dylib`). Windows blocks symlink creation unless:
- **Developer Mode** is enabled, OR
- The command runs with **Administrator privileges**

### Solutions (pick one)

#### Solution 1: Enable Developer Mode (Recommended)

1. Open **Settings** > **Privacy & Security** > **For Developers**
2. Turn ON **Developer Mode**
3. Accept the prompt
4. Run `build_windows.bat` again

This permanently fixes the issue for all Electron projects.

#### Solution 2: Run the Fix Script

```bash
npm run fix-codesign
```

This downloads and extracts winCodeSign using Node.js instead of 7zip, skipping the problematic symlinks and creating dummy files in their place. The macOS libraries aren't needed on Windows.

#### Solution 3: Run as Administrator

Right-click `build_windows.bat` > **Run as Administrator**.

#### Solution 4: Build Portable Only

```bash
set CSC_IDENTITY_AUTO_DISCOVERY=false
npx electron-builder --win --x64 --config.win.target=portable
```

The portable target has fewer signing requirements.

#### Solution 5: Build Unpacked Directory

```bash
set CSC_IDENTITY_AUTO_DISCOVERY=false
npx electron-builder --win --x64 --config.win.target=dir
```

This produces `dist-package/win-unpacked/GDeveloper.exe` with no signing step at all.

#### Solution 6: Clear Cache Manually

```cmd
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
```

Then run the build again.

## Development Mode

```bash
npm install
npm run dev        # Launch Electron app in dev mode with hot reload
npm run dev:web    # Web-only preview (no Electron, runs in browser)
```

## Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **npm** (comes with Node.js)
- **~2 GB free disk space** (for Electron binaries and build output)
- **Windows 10/11 x64**

## Project Structure (Build-relevant)

```
GDeveloper/
├── src/
│   ├── main/           # Electron main process (TypeScript)
│   ├── preload/        # Electron preload bridge
│   └── renderer/       # React UI (TypeScript + JSX)
├── resources/          # App resources (icons, video)
├── scripts/
│   └── fix-wincodesign.js   # winCodeSign cache fix
├── dist-electron/      # Built main process output
├── dist-renderer/      # Built renderer output
├── dist-package/       # Final packaged .exe output
├── electron.vite.config.ts  # Build configuration
├── package.json        # Dependencies + electron-builder config
└── build_windows.bat   # Automated Windows build script
```

## Troubleshooting

### "description is missing in the package.json"
This is a warning, not an error. It's safe to ignore.

### npm install fails
Try: `npm install --legacy-peer-deps`

### TypeScript errors during build
Run `npx tsc --noEmit` to see all type errors, then fix them.

### Electron not found
Make sure `electron` is in devDependencies and run `npm install` again.

### Build succeeds but app won't start
Check that `dist-electron/main/index.js` exists. If not, the main process build failed silently.
