/**
 * Workspace Environment Profiles — Sprint 13
 * Detect project stacks, manage Python environments (uv-first).
 */

import { existsSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { getDatabase } from '../db';

export type StackType = 'python' | 'node' | 'rust' | 'dotnet' | 'go' | 'java' | 'polyglot' | 'unknown';

export interface EnvironmentProfile {
  stack: StackType;
  manager: string;       // 'uv', 'pip', 'npm', 'cargo', 'dotnet', etc.
  envPath: string;       // path to venv or environment
  activationHint: string; // command to activate
  detectedAt: string;
  /** Extra details like Python version, Node version, etc. */
  details: Record<string, string>;
}

interface StackIndicator {
  file: string;
  stack: StackType;
  manager: string;
}

const STACK_INDICATORS: StackIndicator[] = [
  { file: 'pyproject.toml', stack: 'python', manager: 'uv' },
  { file: 'requirements.txt', stack: 'python', manager: 'pip' },
  { file: 'setup.py', stack: 'python', manager: 'pip' },
  { file: 'setup.cfg', stack: 'python', manager: 'pip' },
  { file: 'Pipfile', stack: 'python', manager: 'pipenv' },
  { file: 'poetry.lock', stack: 'python', manager: 'poetry' },
  { file: 'package.json', stack: 'node', manager: 'npm' },
  { file: 'pnpm-lock.yaml', stack: 'node', manager: 'pnpm' },
  { file: 'yarn.lock', stack: 'node', manager: 'yarn' },
  { file: 'bun.lockb', stack: 'node', manager: 'bun' },
  { file: 'Cargo.toml', stack: 'rust', manager: 'cargo' },
  { file: 'go.mod', stack: 'go', manager: 'go' },
  { file: 'pom.xml', stack: 'java', manager: 'maven' },
  { file: 'build.gradle', stack: 'java', manager: 'gradle' },
];

/**
 * Detect the technology stack in a workspace directory.
 */
export function detectStack(workspacePath: string): { stack: StackType; manager: string; indicators: string[] } {
  const detectedStacks = new Set<StackType>();
  const indicators: string[] = [];
  let primaryManager = '';

  for (const si of STACK_INDICATORS) {
    if (existsSync(join(workspacePath, si.file))) {
      detectedStacks.add(si.stack);
      indicators.push(si.file);
      if (!primaryManager) primaryManager = si.manager;
    }
  }

  // Check .NET
  try {
    const files = require('fs').readdirSync(workspacePath);
    for (const f of files) {
      if (f.endsWith('.sln') || f.endsWith('.csproj') || f.endsWith('.fsproj')) {
        detectedStacks.add('dotnet');
        indicators.push(f);
        if (!primaryManager) primaryManager = 'dotnet';
        break;
      }
    }
  } catch { /* ignore */ }

  if (detectedStacks.size === 0) return { stack: 'unknown', manager: '', indicators };
  if (detectedStacks.size === 1) return { stack: Array.from(detectedStacks)[0], manager: primaryManager, indicators };
  return { stack: 'polyglot', manager: primaryManager, indicators };
}

/**
 * Check if `uv` is available on the system.
 */
export function isUvAvailable(): boolean {
  try {
    execSync('uv --version', { timeout: 5000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the uv version string.
 */
export function getUvVersion(): string {
  try {
    return execSync('uv --version', { timeout: 5000, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Create a Python virtual environment using uv inside the workspace.
 * Stores it in `.gdeveloper/.venv/` to keep it separate from user's own envs.
 */
export async function createPythonEnv(workspacePath: string): Promise<EnvironmentProfile> {
  if (!isUvAvailable()) {
    throw new Error('uv is not installed. Install it from https://docs.astral.sh/uv/');
  }

  const envDir = join(workspacePath, '.gdeveloper', '.venv');
  const db = getDatabase();

  try {
    // Create venv
    execSync(`uv venv "${envDir}"`, {
      cwd: workspacePath,
      timeout: 60000,
      encoding: 'utf-8',
    });

    // Get Python version
    let pythonVersion = '';
    try {
      const pythonBin = process.platform === 'win32'
        ? join(envDir, 'Scripts', 'python.exe')
        : join(envDir, 'bin', 'python');
      pythonVersion = execSync(`"${pythonBin}" --version`, { timeout: 5000, encoding: 'utf-8' }).trim();
    } catch { /* ignore */ }

    const activationHint = process.platform === 'win32'
      ? `${envDir}\\Scripts\\activate`
      : `source ${envDir}/bin/activate`;

    const profile: EnvironmentProfile = {
      stack: 'python',
      manager: 'uv',
      envPath: envDir,
      activationHint,
      detectedAt: new Date().toISOString(),
      details: {
        pythonVersion,
        uvVersion: getUvVersion(),
      },
    };

    db.logActivity('system', 'env_created', `Python env created: ${basename(workspacePath)}`, envDir, {
      stack: 'python', manager: 'uv', envDir
    });

    return profile;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    db.logActivity('system', 'env_create_failed', `Env creation failed`, errMsg, {}, 'error');
    throw new Error(`Failed to create Python environment: ${errMsg}`);
  }
}

/**
 * Sync dependencies using uv (reads pyproject.toml / requirements.txt).
 */
export async function syncPythonDeps(workspacePath: string, envPath: string): Promise<string> {
  if (!isUvAvailable()) {
    throw new Error('uv is not installed');
  }

  const db = getDatabase();

  try {
    // Try pyproject.toml first
    if (existsSync(join(workspacePath, 'pyproject.toml'))) {
      const output = execSync(`uv pip install -e "." --python "${envPath}"`, {
        cwd: workspacePath,
        timeout: 300000,
        encoding: 'utf-8',
      });
      db.logActivity('system', 'env_sync', 'Dependencies synced (pyproject.toml)', output.substring(0, 200));
      return output;
    }

    // Fallback to requirements.txt
    if (existsSync(join(workspacePath, 'requirements.txt'))) {
      const output = execSync(`uv pip install -r requirements.txt --python "${envPath}"`, {
        cwd: workspacePath,
        timeout: 300000,
        encoding: 'utf-8',
      });
      db.logActivity('system', 'env_sync', 'Dependencies synced (requirements.txt)', output.substring(0, 200));
      return output;
    }

    return 'No pyproject.toml or requirements.txt found.';
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    db.logActivity('system', 'env_sync_failed', 'Sync failed', errMsg, {}, 'error');
    throw new Error(`Dependency sync failed: ${errMsg}`);
  }
}

/**
 * Build the full environment profile for a workspace.
 */
export function getEnvironmentProfile(workspacePath: string): EnvironmentProfile | null {
  const detection = detectStack(workspacePath);
  if (detection.stack === 'unknown') return null;

  // Check for existing GDeveloper-managed env
  const gdEnvDir = join(workspacePath, '.gdeveloper', '.venv');
  const hasGdEnv = existsSync(gdEnvDir);

  // Check for user's own venv
  const userEnvDirs = ['.venv', 'venv', 'env', '.env'];
  let userEnvPath = '';
  for (const d of userEnvDirs) {
    if (existsSync(join(workspacePath, d))) {
      userEnvPath = join(workspacePath, d);
      break;
    }
  }

  const envPath = hasGdEnv ? gdEnvDir : userEnvPath;

  let activationHint = '';
  if (detection.stack === 'python' && envPath) {
    activationHint = process.platform === 'win32'
      ? `${envPath}\\Scripts\\activate`
      : `source ${envPath}/bin/activate`;
  } else if (detection.stack === 'node') {
    activationHint = existsSync(join(workspacePath, 'pnpm-lock.yaml'))
      ? 'pnpm install'
      : existsSync(join(workspacePath, 'yarn.lock'))
        ? 'yarn install'
        : 'npm install';
  }

  return {
    stack: detection.stack,
    manager: detection.manager,
    envPath: envPath || '',
    activationHint,
    detectedAt: new Date().toISOString(),
    details: {
      indicators: detection.indicators.join(', '),
      ...(detection.stack === 'python' && !isUvAvailable() ? { uvMissing: 'true' } : {}),
    },
  };
}
