import { execFileSync, execSync } from 'child_process';
import { relative, resolve } from 'path';

import { getDatabase } from '../db';

export type SandboxExecutionMode = 'local' | 'docker';
export type SandboxNetworkMode = 'none' | 'bridge';

export interface SandboxExecutionConfig {
  mode: SandboxExecutionMode;
  dockerImage: string;
  network: SandboxNetworkMode;
  fallbackToLocal: boolean;
}

export interface SandboxCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  executionMode: SandboxExecutionMode;
  sandboxed: boolean;
  fallbackReason?: string;
}

const SETTINGS_KEY = 'sandbox.execution.config';
const DEFAULT_SANDBOX_CONFIG: SandboxExecutionConfig = {
  mode: 'local',
  dockerImage: 'node:20-bookworm',
  network: 'none',
  fallbackToLocal: true,
};

let inMemoryConfig: SandboxExecutionConfig = { ...DEFAULT_SANDBOX_CONFIG };

export function getDefaultSandboxExecutionConfig(): SandboxExecutionConfig {
  return { ...DEFAULT_SANDBOX_CONFIG };
}

export function getSandboxExecutionConfig(): SandboxExecutionConfig {
  try {
    const raw = getDatabase().getSetting(SETTINGS_KEY);
    if (raw) {
      inMemoryConfig = normalizeSandboxConfig(JSON.parse(raw));
    }
  } catch {
    // Tests and early startup may not have an Electron app-backed DB yet.
  }
  return { ...inMemoryConfig };
}

export function setSandboxExecutionConfig(partial: Partial<SandboxExecutionConfig>): SandboxExecutionConfig {
  inMemoryConfig = normalizeSandboxConfig({ ...getSandboxExecutionConfig(), ...partial });
  try {
    getDatabase().setSetting(SETTINGS_KEY, JSON.stringify(inMemoryConfig));
  } catch {
    // Keep the in-memory config even when persistence is unavailable.
  }
  return { ...inMemoryConfig };
}

export function isDockerAvailable(): boolean {
  try {
    execFileSync(getDockerCommand(), ['--version'], {
      timeout: 5000,
      stdio: 'pipe',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function executeCommandWithSandbox(
  workspacePath: string,
  effectiveCwd: string,
  command: string,
  timeoutMs: number,
  config: SandboxExecutionConfig = getSandboxExecutionConfig()
): SandboxCommandResult {
  const normalizedConfig = normalizeSandboxConfig(config);
  const start = Date.now();

  if (normalizedConfig.mode === 'docker') {
    if (isDockerAvailable()) {
      return executeDockerCommand(workspacePath, effectiveCwd, command, timeoutMs, normalizedConfig, start);
    }
    if (!normalizedConfig.fallbackToLocal) {
      return {
        stdout: '',
        stderr: 'Docker is not available and fallbackToLocal is disabled.',
        exitCode: 127,
        timedOut: false,
        durationMs: Date.now() - start,
        executionMode: 'docker',
        sandboxed: false,
        fallbackReason: 'docker_unavailable',
      };
    }
    const localResult = executeLocalCommand(effectiveCwd, command, timeoutMs, start);
    return {
      ...localResult,
      executionMode: 'local',
      sandboxed: false,
      fallbackReason: 'docker_unavailable',
    };
  }

  return executeLocalCommand(effectiveCwd, command, timeoutMs, start);
}

export function buildDockerRunArgs(
  workspacePath: string,
  effectiveCwd: string,
  command: string,
  config: SandboxExecutionConfig
): string[] {
  const root = resolve(workspacePath);
  const cwd = resolve(effectiveCwd);
  const relCwd = cwd === root ? '' : relative(root, cwd).replace(/\\/g, '/');
  const dockerCwd = relCwd ? `/workspace/${relCwd}` : '/workspace';
  const volume = `${root}:/workspace`;

  return [
    'run',
    '--rm',
    '--network',
    config.network,
    '-v',
    volume,
    '-w',
    dockerCwd,
    config.dockerImage,
    'sh',
    '-lc',
    command,
  ];
}

function executeDockerCommand(
  workspacePath: string,
  effectiveCwd: string,
  command: string,
  timeoutMs: number,
  config: SandboxExecutionConfig,
  start: number
): SandboxCommandResult {
  const args = buildDockerRunArgs(workspacePath, effectiveCwd, command, config);
  try {
    const stdout = execFileSync(getDockerCommand(), args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf-8',
      windowsHide: true,
      env: { ...process.env, TERM: 'dumb' },
    });
    return {
      stdout: stdout || '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: Date.now() - start,
      executionMode: 'docker',
      sandboxed: true,
    };
  } catch (err: any) {
    return {
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || err.message || '').toString(),
      exitCode: err.status ?? 1,
      timedOut: err.killed || err.signal === 'SIGTERM',
      durationMs: Date.now() - start,
      executionMode: 'docker',
      sandboxed: true,
    };
  }
}

function executeLocalCommand(effectiveCwd: string, command: string, timeoutMs: number, start: number): SandboxCommandResult {
  try {
    const stdout = execSync(command, {
      cwd: effectiveCwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: timeoutMs,
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      env: { ...process.env, TERM: 'dumb' },
    });
    return {
      stdout: stdout || '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: Date.now() - start,
      executionMode: 'local',
      sandboxed: false,
    };
  } catch (err: any) {
    return {
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
      exitCode: err.status ?? 1,
      timedOut: err.killed || err.signal === 'SIGTERM',
      durationMs: Date.now() - start,
      executionMode: 'local',
      sandboxed: false,
    };
  }
}

function normalizeSandboxConfig(config: Partial<SandboxExecutionConfig>): SandboxExecutionConfig {
  const mode = config.mode === 'docker' ? 'docker' : 'local';
  const network = config.network === 'bridge' ? 'bridge' : 'none';
  const dockerImage = typeof config.dockerImage === 'string' && config.dockerImage.trim()
    ? config.dockerImage.trim()
    : DEFAULT_SANDBOX_CONFIG.dockerImage;
  const fallbackToLocal = config.fallbackToLocal !== false;
  return { mode, dockerImage, network, fallbackToLocal };
}

function getDockerCommand(): string {
  return process.platform === 'win32' ? 'docker.exe' : 'docker';
}
