@echo off
setlocal enabledelayedexpansion
REM =========================================================
REM  GDeveloper - Windows Build Script
REM  Builds the Electron + React desktop app to .exe
REM
REM  This script handles the common "Cannot create symbolic
REM  link" error from electron-builder by:
REM    1. Disabling code signing entirely (CSC_IDENTITY_AUTO_DISCOVERY=false)
REM    2. Clearing the corrupted winCodeSign cache
REM    3. Pre-populating the cache with a Node.js script
REM    4. Falling back to portable .exe if NSIS fails
REM    5. Falling back to unpacked dir if portable fails
REM
REM  REQUIREMENTS:
REM    - Node.js 18+ (https://nodejs.org/)
REM    - npm (comes with Node.js)
REM    - ~2 GB free disk space
REM
REM  RECOMMENDED (avoids symlink issues entirely):
REM    - Enable Developer Mode in Windows Settings:
REM      Settings > Privacy & Security > For Developers > Developer Mode ON
REM    - OR run this script as Administrator
REM =========================================================

echo.
echo  ====================================================
echo    GDEVELOPER - Windows Build
echo    Native AI Coding Platform
echo  ====================================================
echo.

REM ─── Disable ALL code signing ──────────────────────────
REM These env vars tell electron-builder to skip code signing
REM entirely, which prevents the winCodeSign download that
REM causes the symlink error.
set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=
set CSC_KEY_PASSWORD=
set WIN_CSC_LINK=
set WIN_CSC_KEY_PASSWORD=
set DEBUG=electron-builder

REM ─── Handle symlinks natively if MSYS/Git Bash ─────────
set MSYS=winsymlinks:nativestrict

REM ─── Check Node.js ─────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo  Please install Node.js 18+ from https://nodejs.org/
    echo.
    goto :fail
)

for /f "tokens=*" %%a in ('node --version') do set NODE_VERSION=%%a
echo  [OK] Node.js version: %NODE_VERSION%

REM ─── Check npm ─────────────────────────────────────────
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] npm is not installed or not in PATH.
    goto :fail
)

for /f "tokens=*" %%a in ('npm --version') do set NPM_VERSION=%%a
echo  [OK] npm version: %NPM_VERSION%

REM ─── Check Developer Mode (informational) ──────────────
echo.
echo  [INFO] Checking Developer Mode status...
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /v AllowDevelopmentWithoutDevLicense 2>nul | find "0x1" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [OK] Developer Mode is ENABLED - symlinks will work natively.
    set DEV_MODE=1
) else (
    echo  [WARN] Developer Mode is NOT enabled.
    echo         This may cause symlink errors during packaging.
    echo         To enable: Settings ^> Privacy ^& Security ^> For Developers ^> Developer Mode ON
    echo         Continuing anyway with workarounds...
    set DEV_MODE=0
)

echo.
echo  ────────────────────────────────────────────────────
echo  Step 1 of 6: Clear electron-builder cache
echo  ────────────────────────────────────────────────────
echo.

REM Clear potentially corrupted winCodeSign cache
set EB_CACHE=%LOCALAPPDATA%\electron-builder\Cache
if exist "%EB_CACHE%\winCodeSign" (
    echo  Removing corrupted winCodeSign cache...
    rmdir /s /q "%EB_CACHE%\winCodeSign" 2>nul
    if exist "%EB_CACHE%\winCodeSign" (
        echo  [WARN] Could not fully remove cache. Continuing anyway...
    ) else (
        echo  [OK] Cleared winCodeSign cache.
    )
) else (
    echo  [OK] No cached winCodeSign to clear.
)

echo.
echo  ────────────────────────────────────────────────────
echo  Step 2 of 6: Install dependencies
echo  ────────────────────────────────────────────────────
echo.

call npm install
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] npm install failed.
    echo  Try: npm install --legacy-peer-deps
    goto :fail
)
echo  [OK] Dependencies installed.

echo.
echo  ────────────────────────────────────────────────────
echo  Step 3 of 6: Pre-populate winCodeSign cache
echo  ────────────────────────────────────────────────────
echo.

REM Run the fix script to pre-extract winCodeSign without symlink issues
echo  Running winCodeSign cache fix...
call node scripts/fix-wincodesign.js
if %ERRORLEVEL% neq 0 (
    echo  [WARN] Cache fix script had issues. Build may still work if:
    echo         - Developer Mode is enabled, OR
    echo         - Running as Administrator
    echo  Continuing...
)

echo.
echo  ────────────────────────────────────────────────────
echo  Step 4 of 6: Build renderer + main process
echo  ────────────────────────────────────────────────────
echo.

call npx electron-vite build
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] electron-vite build failed.
    echo  Check for TypeScript errors above.
    goto :fail
)

REM Verify build outputs
if not exist "dist-electron\main\index.js" (
    echo  [ERROR] Main process build output missing: dist-electron\main\index.js
    goto :fail
)
if not exist "dist-renderer\index.html" (
    echo  [WARN] Renderer output may be in a different location...
)

echo  [OK] Build complete.

echo.
echo  ────────────────────────────────────────────────────
echo  Step 5 of 6: Package with electron-builder
echo  ────────────────────────────────────────────────────
echo.

REM ─── Attempt 1: Full build (NSIS installer + portable) ─
echo  [Attempt 1] Building NSIS installer + portable...
call npx electron-builder --win --x64 --config.forceCodeSigning=false
if %ERRORLEVEL% equ 0 (
    echo  [OK] Full package created successfully.
    goto :verify
)

echo.
echo  [WARN] Full build failed. Trying portable-only...
echo.

REM ─── Attempt 2: Portable only (simpler, fewer signing issues) ─
echo  [Attempt 2] Building portable .exe only...
call npx electron-builder --win --x64 --config.win.target=portable --config.forceCodeSigning=false
if %ERRORLEVEL% equ 0 (
    echo  [OK] Portable .exe created successfully.
    goto :verify
)

echo.
echo  [WARN] Portable build also failed. Trying unpacked directory...
echo.

REM ─── Attempt 3: Unpacked directory (no signing at all) ─
echo  [Attempt 3] Building unpacked app directory...
call npx electron-builder --win --x64 --config.win.target=dir --config.forceCodeSigning=false
if %ERRORLEVEL% equ 0 (
    echo  [OK] Unpacked app created in dist-package\win-unpacked\
    echo  You can run GDeveloper.exe directly from that folder.
    goto :verify
)

echo.
echo  ====================================================
echo  [ERROR] All packaging attempts failed.
echo  ====================================================
echo.
echo  TROUBLESHOOTING:
echo.
echo  Solution 1 - Enable Developer Mode (RECOMMENDED):
echo    Settings ^> Privacy ^& Security ^> For Developers
echo    Turn ON "Developer Mode"
echo    Then run this script again.
echo.
echo  Solution 2 - Run as Administrator:
echo    Right-click build_windows.bat ^> "Run as Administrator"
echo.
echo  Solution 3 - Manual build:
echo    1. Delete: %LOCALAPPDATA%\electron-builder\Cache\winCodeSign
echo    2. Run: set CSC_IDENTITY_AUTO_DISCOVERY=false
echo    3. Run: npx electron-builder --win --x64 --config.win.target=dir
echo.
echo  Solution 4 - Use WSL or Docker:
echo    wsl -d Ubuntu
echo    cd /mnt/c/path/to/GDeveloper
echo    npx electron-builder --win --x64
echo.
goto :fail

:verify
echo.
echo  ────────────────────────────────────────────────────
echo  Step 6 of 6: Verify output
echo  ────────────────────────────────────────────────────
echo.

set FOUND_EXE=0

REM Check for installer
for /f "delims=" %%f in ('dir /s /b "dist-package\*.exe" 2^>nul') do (
    echo  [FOUND] %%f
    set FOUND_EXE=1
)

REM Check for unpacked
if exist "dist-package\win-unpacked\GDeveloper.exe" (
    echo  [FOUND] dist-package\win-unpacked\GDeveloper.exe (unpacked)
    set FOUND_EXE=1
)

if %FOUND_EXE% equ 0 (
    echo  [WARN] No .exe found. Check the dist-package\ folder manually.
) else (
    echo.
    echo  ====================================================
    echo    BUILD COMPLETE!
    echo  ====================================================
    echo.
    echo  Output directory: dist-package\
    echo.
    echo  To run the app:
    echo    - Double-click the installer .exe, OR
    echo    - Run dist-package\win-unpacked\GDeveloper.exe directly
    echo.
)

goto :end

:fail
echo.
echo  Build failed. See errors above.
echo.

:end
endlocal
pause
