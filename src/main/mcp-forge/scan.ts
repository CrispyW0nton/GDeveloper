/**
 * MCP Forge — App Capability Scanner
 * Sprint 14, Task 1
 *
 * Inspects an executable, install folder, or app root and classifies it
 * into integration categories with confidence values.
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, basename, extname, resolve } from 'path';
import { execSync } from 'child_process';
import { getDatabase } from '../db';
import type { CapabilityReport, CapabilityEntry, CapabilityType } from './types';

// ─── Known CLI signatures ───

const CLI_EXTENSIONS = new Set(['.exe', '.cmd', '.bat', '.ps1', '.sh', '.py', '.rb', '.js']);
const CLI_HELP_FLAGS = ['--help', '-h', '/h', '-?', 'help'];
const MANIFEST_FILES = [
  'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'CMakeLists.txt', 'Makefile',
  'setup.py', 'setup.cfg', 'requirements.txt',
];
const PLUGIN_DIRS = ['plugins', 'extensions', 'addons', 'mods', 'modules'];
const PROJECT_FILE_PATTERNS = [
  /\.sln$/i, /\.csproj$/i, /\.fsproj$/i, /\.proj$/i,
  /\.xcworkspace$/i, /\.xcodeproj$/i,
  /\.uproject$/i, /\.uplugin$/i,
  /\.blend$/i, /\.3ds$/i, /\.fbx$/i,
];

// PowerShell cmdlet patterns
const POWERSHELL_INDICATORS = [
  'Modules', 'Cmdlets', 'manifest.psd1', 'psm1',
];

/**
 * Scan an app path and produce a structured capability report.
 */
export async function scanAppCapabilities(appPath: string): Promise<CapabilityReport> {
  const db = getDatabase();
  const absPath = resolve(appPath);

  if (!existsSync(absPath)) {
    throw new Error(`Path does not exist: ${appPath}`);
  }

  db.logActivity('system', 'forge_scan_start', `Scanning: ${absPath}`, '', { appPath: absPath });

  const report: CapabilityReport = {
    appName: basename(absPath, extname(absPath)),
    appPath: absPath,
    scanTimestamp: new Date().toISOString(),
    capabilities: [],
    recommendedStrategy: null,
    overallConfidence: 0,
    discoveredArtifacts: [],
    cliHelpOutput: '',
    warnings: [],
  };

  const stat = statSync(absPath);
  const isFile = stat.isFile();
  const isDir = stat.isDirectory();

  // Determine the directory to scan
  const scanDir = isFile ? join(absPath, '..') : absPath;
  const execPath = isFile ? absPath : null;

  // Gather sibling / child files
  let entries: string[] = [];
  try {
    entries = readdirSync(scanDir);
    report.discoveredArtifacts = entries.slice(0, 50);
  } catch (err) {
    report.warnings.push(`Cannot read directory: ${scanDir}`);
  }

  // ─── 1. CLI Capability ───
  const cliResult = await detectCLI(absPath, execPath, entries, scanDir, report);
  if (cliResult) report.capabilities.push(cliResult);

  // ─── 2. PowerShell Capability ───
  const psResult = detectPowerShell(entries, scanDir);
  if (psResult) report.capabilities.push(psResult);

  // ─── 3. Plugin/Extension Capability ───
  const pluginResult = detectPlugins(entries, scanDir);
  if (pluginResult) report.capabilities.push(pluginResult);

  // ─── 4. File/Project-Based Capability ───
  const fileResult = detectFileProject(entries, scanDir);
  if (fileResult) report.capabilities.push(fileResult);

  // ─── 5. COM Capability (Windows-only indicator) ───
  const comResult = detectCOM(entries, scanDir);
  if (comResult) report.capabilities.push(comResult);

  // ─── 6. If nothing confident, mark GUI-only ───
  if (report.capabilities.length === 0 || report.capabilities.every(c => c.confidence < 0.2)) {
    report.capabilities.push({
      type: 'gui-only',
      confidence: 0.4,
      evidence: ['No CLI, plugin, or project indicators found'],
      details: { note: 'App appears to be GUI-only. Adapter generation may be limited.' },
    });
  }

  // ─── Pick recommended strategy ───
  const sorted = [...report.capabilities].sort((a, b) => b.confidence - a.confidence);
  report.recommendedStrategy = sorted[0]?.type || null;
  report.overallConfidence = sorted[0]?.confidence || 0;

  db.logActivity('system', 'forge_scan_done', `Scan complete: ${report.appName}`,
    `Strategy: ${report.recommendedStrategy} (${(report.overallConfidence * 100).toFixed(0)}%)`, {
      appPath: absPath,
      capabilities: report.capabilities.map(c => `${c.type}:${c.confidence}`),
    });

  return report;
}

// ─── Detectors ───

async function detectCLI(
  absPath: string,
  execPath: string | null,
  entries: string[],
  scanDir: string,
  report: CapabilityReport
): Promise<CapabilityEntry | null> {
  const evidence: string[] = [];
  const details: Record<string, string> = {};
  let confidence = 0;

  // Check if the path itself is an executable
  if (execPath) {
    const ext = extname(execPath).toLowerCase();
    if (CLI_EXTENSIONS.has(ext) || ext === '') {
      evidence.push(`Executable file: ${basename(execPath)}`);
      confidence += 0.3;
    }
  }

  // Look for CLI-like executables in directory
  const cliFiles = entries.filter(e => {
    const ext = extname(e).toLowerCase();
    return CLI_EXTENSIONS.has(ext) || e === 'cli' || e.endsWith('-cli');
  });
  if (cliFiles.length > 0) {
    evidence.push(`CLI executables found: ${cliFiles.slice(0, 5).join(', ')}`);
    confidence += 0.2;
  }

  // Check for manifest files suggesting a CLI tool
  for (const mf of MANIFEST_FILES) {
    if (entries.includes(mf)) {
      evidence.push(`Manifest: ${mf}`);
      details[mf] = 'present';
      confidence += 0.1;

      // Parse package.json for bin entries
      if (mf === 'package.json') {
        try {
          const pkg = JSON.parse(readFileSync(join(scanDir, mf), 'utf-8'));
          if (pkg.bin) {
            const bins = typeof pkg.bin === 'string' ? [pkg.name] : Object.keys(pkg.bin);
            evidence.push(`package.json bin entries: ${bins.join(', ')}`);
            details.bins = bins.join(', ');
            confidence += 0.2;
          }
        } catch { /* ignore parse errors */ }
      }
    }
  }

  // Try --help if we have an executable
  const targetExec = execPath || (cliFiles.length > 0 ? join(scanDir, cliFiles[0]) : null);
  if (targetExec) {
    for (const flag of CLI_HELP_FLAGS) {
      try {
        const output = execSync(`"${targetExec}" ${flag}`, {
          timeout: 5000,
          encoding: 'utf-8',
          maxBuffer: 64 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (output && output.length > 20) {
          report.cliHelpOutput = output.substring(0, 8000);
          evidence.push(`CLI help output captured (${output.length} chars) via ${flag}`);
          details.helpFlag = flag;
          confidence += 0.3;
          break;
        }
      } catch (err: any) {
        // Some CLIs output help to stderr
        const stderr = err?.stderr || '';
        const stdout = err?.stdout || '';
        const combined = stdout + stderr;
        if (combined.length > 20) {
          report.cliHelpOutput = combined.substring(0, 8000);
          evidence.push(`CLI help output captured from ${flag} (exit non-zero but produced output)`);
          confidence += 0.2;
          break;
        }
      }
    }
  }

  if (evidence.length === 0) return null;

  return {
    type: 'cli',
    confidence: Math.min(confidence, 1),
    evidence,
    details,
  };
}

function detectPowerShell(entries: string[], scanDir: string): CapabilityEntry | null {
  const evidence: string[] = [];
  let confidence = 0;

  for (const ind of POWERSHELL_INDICATORS) {
    const matches = entries.filter(e => e.toLowerCase().includes(ind.toLowerCase()));
    if (matches.length > 0) {
      evidence.push(`PowerShell indicator: ${matches[0]}`);
      confidence += 0.2;
    }
  }

  const ps1Files = entries.filter(e => e.endsWith('.ps1') || e.endsWith('.psm1') || e.endsWith('.psd1'));
  if (ps1Files.length > 0) {
    evidence.push(`PowerShell scripts: ${ps1Files.slice(0, 5).join(', ')}`);
    confidence += 0.3;
  }

  if (evidence.length === 0) return null;
  return { type: 'powershell', confidence: Math.min(confidence, 1), evidence, details: {} };
}

function detectPlugins(entries: string[], scanDir: string): CapabilityEntry | null {
  const evidence: string[] = [];
  let confidence = 0;

  for (const pd of PLUGIN_DIRS) {
    if (entries.includes(pd) || entries.includes(pd.charAt(0).toUpperCase() + pd.slice(1))) {
      const plugDir = join(scanDir, pd);
      try {
        if (statSync(plugDir).isDirectory()) {
          const plugContents = readdirSync(plugDir);
          evidence.push(`Plugin directory: ${pd}/ (${plugContents.length} entries)`);
          confidence += 0.3;
        }
      } catch { /* ignore */ }
    }
  }

  // Check for extension manifests
  const extManifests = entries.filter(e =>
    e.includes('extension') || e.includes('plugin') || e.includes('addon')
  );
  if (extManifests.length > 0) {
    evidence.push(`Extension-related files: ${extManifests.slice(0, 5).join(', ')}`);
    confidence += 0.1;
  }

  if (evidence.length === 0) return null;
  return { type: 'plugin', confidence: Math.min(confidence, 1), evidence, details: {} };
}

function detectFileProject(entries: string[], scanDir: string): CapabilityEntry | null {
  const evidence: string[] = [];
  let confidence = 0;
  const details: Record<string, string> = {};

  for (const entry of entries) {
    for (const pattern of PROJECT_FILE_PATTERNS) {
      if (pattern.test(entry)) {
        evidence.push(`Project file: ${entry}`);
        details.projectFile = entry;
        confidence += 0.3;
        break;
      }
    }
  }

  // Check for common config file patterns
  const configFiles = entries.filter(e =>
    e.endsWith('.config') || e.endsWith('.ini') || e.endsWith('.cfg') ||
    e.endsWith('.yaml') || e.endsWith('.yml') || e.endsWith('.toml') ||
    e.endsWith('.json') && !e.startsWith('package')
  );
  if (configFiles.length > 3) {
    evidence.push(`Multiple config files: ${configFiles.length} found`);
    confidence += 0.1;
  }

  if (evidence.length === 0) return null;
  return { type: 'file-project', confidence: Math.min(confidence, 1), evidence, details };
}

function detectCOM(entries: string[], scanDir: string): CapabilityEntry | null {
  const evidence: string[] = [];
  let confidence = 0;

  // COM indicators: .dll, .tlb, .ocx, regsvr32 references
  const comFiles = entries.filter(e =>
    e.endsWith('.dll') || e.endsWith('.tlb') || e.endsWith('.ocx') || e.endsWith('.idl')
  );
  if (comFiles.length > 0) {
    evidence.push(`COM-capable binaries: ${comFiles.slice(0, 5).join(', ')}`);
    confidence += 0.2;
  }

  // Type libraries
  const typeLibs = entries.filter(e => e.endsWith('.tlb') || e.endsWith('.olb'));
  if (typeLibs.length > 0) {
    evidence.push(`Type libraries: ${typeLibs.join(', ')}`);
    confidence += 0.2;
  }

  if (evidence.length === 0) return null;
  return { type: 'com', confidence: Math.min(confidence, 1), evidence, details: {} };
}
