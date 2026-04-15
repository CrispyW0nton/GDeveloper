#!/usr/bin/env node
/**
 * fix-wincodesign.js
 * 
 * Fixes the electron-builder winCodeSign symlink error on Windows.
 * 
 * PROBLEM:
 * electron-builder downloads winCodeSign-2.6.0.7z which contains macOS symlinks
 * (darwin/10.12/lib/libcrypto.dylib, libssl.dylib). When 7zip extracts this on
 * Windows without Developer Mode enabled or admin privileges, it fails with:
 *   "ERROR: Cannot create symbolic link : A required privilege is not held by the client."
 * 
 * SOLUTION:
 * This script pre-populates the electron-builder cache by:
 * 1. Downloading the winCodeSign archive
 * 2. Extracting it using Node.js (skipping problematic symlinks)
 * 3. Creating dummy files where symlinks would be (so checksums pass)
 * 4. Placing the result in the expected cache location
 * 
 * Run: node scripts/fix-wincodesign.js
 * Or:  npm run fix-codesign
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

// ─── Configuration ───────────────────────────────────────────────────────────
const WINCODESIGN_VERSION = '2.6.0';
const WINCODESIGN_URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-${WINCODESIGN_VERSION}/winCodeSign-${WINCODESIGN_VERSION}.7z`;

// electron-builder cache location
const CACHE_BASE = process.env.ELECTRON_BUILDER_CACHE 
  || (process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache')
    : path.join(os.homedir(), '.cache', 'electron-builder'));

const WINCODESIGN_CACHE = path.join(CACHE_BASE, 'winCodeSign');

// Known problematic symlinks in the archive
const SYMLINK_FILES = [
  'darwin/10.12/lib/libcrypto.dylib',
  'darwin/10.12/lib/libssl.dylib',
  'darwin/10.12/lib/libcrypto.1.1.dylib',  // may exist in some versions
  'darwin/10.12/lib/libssl.1.1.dylib',       // may exist in some versions
];

// ─── Utilities ───────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[fix-wincodesign] ${msg}`);
}

function warn(msg) {
  console.warn(`[fix-wincodesign] WARNING: ${msg}`);
}

function error(msg) {
  console.error(`[fix-wincodesign] ERROR: ${msg}`);
}

/**
 * Download a file with redirect following
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    log(`Downloading: ${url}`);
    const file = fs.createWriteStream(dest);
    
    function doRequest(url, redirectCount = 0) {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }
      
      https.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          log(`  Following redirect to ${response.headers.location}`);
          doRequest(response.headers.location, redirectCount + 1);
          return;
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        
        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalSize > 0) {
            const pct = ((downloaded / totalSize) * 100).toFixed(1);
            process.stdout.write(`\r[fix-wincodesign]   ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
          }
        });
        
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(''); // newline after progress
          log(`  Downloaded: ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }
    
    doRequest(url);
  });
}

/**
 * Check if 7zip is available (electron-builder bundles it)
 */
function find7zip() {
  // Try electron-builder's bundled 7zip first
  const projectRoot = path.resolve(__dirname, '..');
  const bundled7z = path.join(projectRoot, 'node_modules', '7zip-bin', 
    process.platform === 'win32' ? 'win/x64/7za.exe' : 
    process.platform === 'darwin' ? 'mac/x64/7za' : 'linux/x64/7za');
  
  if (fs.existsSync(bundled7z)) {
    return bundled7z;
  }
  
  // Try system 7zip
  try {
    execSync('7z --help', { stdio: 'ignore' });
    return '7z';
  } catch {}
  
  try {
    execSync('7za --help', { stdio: 'ignore' });
    return '7za';
  } catch {}
  
  return null;
}

/**
 * Extract archive using 7zip, ignoring symlink errors
 */
function extract7z(archivePath, destDir, sevenZipPath) {
  log(`Extracting with 7zip (ignoring symlink errors)...`);
  
  try {
    // Use -aoa to overwrite, -bd to disable progress, -y to auto-yes
    const cmd = `"${sevenZipPath}" x -bd -y -aoa "${archivePath}" -o"${destDir}"`;
    execSync(cmd, { 
      stdio: 'pipe',
      timeout: 60000,
    });
    log('  Extraction completed successfully.');
    return true;
  } catch (err) {
    // 7zip returns exit code 2 for symlink errors but still extracts everything else
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    
    if (stderr.includes('Cannot create symbolic link') || 
        stdout.includes('Sub items Errors: 2') ||
        err.status === 2) {
      log('  Extraction completed with expected symlink warnings (non-critical).');
      return true;
    }
    
    // Unexpected error
    error(`  7zip extraction failed: ${stderr || stdout || err.message}`);
    return false;
  }
}

/**
 * Create dummy files where symlinks should be
 * electron-builder doesn't actually use the darwin libs on Windows
 */
function createDummySymlinks(extractDir) {
  log('Creating dummy files for symlinks (not needed on Windows)...');
  
  for (const relPath of SYMLINK_FILES) {
    const fullPath = path.join(extractDir, relPath);
    const dir = path.dirname(fullPath);
    
    try {
      fs.mkdirSync(dir, { recursive: true });
      
      if (!fs.existsSync(fullPath)) {
        // Write a small dummy file - these are macOS-only libs not used on Windows
        fs.writeFileSync(fullPath, `dummy-placeholder-not-used-on-windows\n`);
        log(`  Created dummy: ${relPath}`);
      }
    } catch (e) {
      // Non-critical, these files aren't needed on Windows
      warn(`  Could not create dummy for ${relPath}: ${e.message}`);
    }
  }
}

/**
 * Find existing cache entries or determine new cache path
 */
function getCacheEntryPath() {
  if (fs.existsSync(WINCODESIGN_CACHE)) {
    // Look for existing extracted directories (they have numeric names)
    const entries = fs.readdirSync(WINCODESIGN_CACHE)
      .filter(e => /^\d+$/.test(e) && fs.statSync(path.join(WINCODESIGN_CACHE, e)).isDirectory());
    
    if (entries.length > 0) {
      // Return the first valid entry
      const entry = path.join(WINCODESIGN_CACHE, entries[0]);
      // Check if it has the windows binary (what electron-builder actually needs)
      if (fs.existsSync(path.join(entry, 'windows-10')) || 
          fs.existsSync(path.join(entry, 'windows')) ||
          fs.existsSync(path.join(entry, 'darwin'))) {
        return { path: entry, exists: true };
      }
    }
  }
  
  // Generate a deterministic cache name
  const hash = crypto.createHash('md5').update(WINCODESIGN_URL).digest('hex');
  const numericHash = parseInt(hash.substring(0, 8), 16).toString().substring(0, 9);
  return { path: path.join(WINCODESIGN_CACHE, numericHash), exists: false };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  log('=== electron-builder winCodeSign Fix ===');
  log(`Platform: ${process.platform} ${process.arch}`);
  log(`Cache location: ${WINCODESIGN_CACHE}`);
  console.log('');
  
  // Step 1: Check if already cached and valid
  const cacheEntry = getCacheEntryPath();
  
  if (cacheEntry.exists) {
    log(`Cache already exists at: ${cacheEntry.path}`);
    
    // Verify and fix symlinks in existing cache
    createDummySymlinks(cacheEntry.path);
    
    log('');
    log('Cache is ready. electron-builder should now skip the download.');
    log('Run your build command:');
    log('  npm run package');
    log('  -- or --');
    log('  build_windows.bat');
    return;
  }
  
  // Step 2: Find 7zip
  const sevenZip = find7zip();
  if (!sevenZip) {
    error('7zip not found. Install it or run "npm install" first (electron-builder bundles 7zip).');
    error('Alternatively, enable Developer Mode in Windows Settings:');
    error('  Settings > Privacy & Security > For Developers > Developer Mode ON');
    process.exit(1);
  }
  log(`Using 7zip: ${sevenZip}`);
  
  // Step 3: Download the archive
  fs.mkdirSync(WINCODESIGN_CACHE, { recursive: true });
  const archivePath = path.join(WINCODESIGN_CACHE, `winCodeSign-${WINCODESIGN_VERSION}.7z`);
  
  if (!fs.existsSync(archivePath)) {
    try {
      await download(WINCODESIGN_URL, archivePath);
    } catch (err) {
      error(`Download failed: ${err.message}`);
      error('Check your internet connection and try again.');
      process.exit(1);
    }
  } else {
    log(`Archive already downloaded: ${archivePath}`);
  }
  
  // Step 4: Extract (allowing symlink failures)
  const extractDir = cacheEntry.path;
  fs.mkdirSync(extractDir, { recursive: true });
  
  const extracted = extract7z(archivePath, extractDir, sevenZip);
  if (!extracted) {
    error('Extraction failed completely.');
    error('Try one of these solutions:');
    error('  1. Enable Developer Mode: Settings > Privacy & Security > For Developers');
    error('  2. Run as Administrator');
    error('  3. Use portable build: npm run package:portable');
    process.exit(1);
  }
  
  // Step 5: Create dummy symlink files
  createDummySymlinks(extractDir);
  
  // Step 6: Clean up archive
  try {
    fs.unlinkSync(archivePath);
    log('Cleaned up archive file.');
  } catch {}
  
  // Done
  console.log('');
  log('=== winCodeSign cache prepared successfully ===');
  log('');
  log('The electron-builder cache is now populated.');
  log('electron-builder will use the cached version and skip the problematic download.');
  log('');
  log('Run your build:');
  log('  npm run package           (NSIS installer + portable)');
  log('  npm run package:nsis      (NSIS installer only)');
  log('  npm run package:portable  (Single .exe, no install needed)');
  log('  npm run package:dir       (Unpacked folder, no signing at all)');
  log('  build_windows.bat         (Full automated build)');
}

main().catch((err) => {
  error(`Unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
