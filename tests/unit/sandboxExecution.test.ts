import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  buildDockerRunArgs,
  getDefaultSandboxExecutionConfig,
  setSandboxExecutionConfig,
} from '../../src/main/sandbox';

describe('sandbox execution', () => {
  it('defaults to local execution with Docker fallback enabled', () => {
    expect(getDefaultSandboxExecutionConfig()).toEqual({
      mode: 'local',
      dockerImage: 'node:20-bookworm',
      network: 'none',
      fallbackToLocal: true,
    });
  });

  it('normalizes persisted sandbox config', () => {
    const config = setSandboxExecutionConfig({
      mode: 'docker',
      dockerImage: 'node:22-alpine',
      network: 'bridge',
      fallbackToLocal: false,
    });

    expect(config).toEqual({
      mode: 'docker',
      dockerImage: 'node:22-alpine',
      network: 'bridge',
      fallbackToLocal: false,
    });

    setSandboxExecutionConfig(getDefaultSandboxExecutionConfig());
  });

  it('builds Docker run args with workspace mount, cwd, and network isolation', () => {
    const root = resolve('C:/workspace/project');
    const cwd = resolve('C:/workspace/project/packages/app');
    const args = buildDockerRunArgs(root, cwd, 'npm test', {
      mode: 'docker',
      dockerImage: 'node:20-bookworm',
      network: 'none',
      fallbackToLocal: true,
    });

    expect(args).toEqual(expect.arrayContaining([
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${root}:/workspace`,
      '-w',
      '/workspace/packages/app',
      'node:20-bookworm',
      'sh',
      '-lc',
      'npm test',
    ]));
  });
});

describe('sandbox integration wiring', () => {
  it('bash_command routes through executeCommandWithSandbox', () => {
    const source = readFileSync(resolve(__dirname, '../../src/main/tools/bashCommand.ts'), 'utf-8');

    expect(source).toContain('executeCommandWithSandbox');
    expect(source).toContain('execution_mode');
    expect(source).toContain('fallback_reason');
  });

  it('run_command routes through executeCommandWithSandbox', () => {
    const source = readFileSync(resolve(__dirname, '../../src/main/tools/index.ts'), 'utf-8');

    expect(source).toContain('executeCommandWithSandbox(ws, cwd, command, 30000)');
    expect(source).toContain('[sandbox: docker]');
    expect(source).toContain('[sandbox fallback:');
  });

  it('IPC and preload expose sandbox config controls', () => {
    const ipcSource = readFileSync(resolve(__dirname, '../../src/main/ipc/index.ts'), 'utf-8');
    const mainSource = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf-8');
    const preloadSource = readFileSync(resolve(__dirname, '../../src/preload/index.ts'), 'utf-8');

    expect(ipcSource).toContain('SANDBOX_GET_CONFIG');
    expect(ipcSource).toContain('SANDBOX_SET_CONFIG');
    expect(ipcSource).toContain('SANDBOX_CHECK_DOCKER');
    expect(mainSource).toContain('setSandboxExecutionConfig');
    expect(mainSource).toContain('isDockerAvailable');
    expect(preloadSource).toContain('getSandboxConfig');
    expect(preloadSource).toContain('setSandboxConfig');
    expect(preloadSource).toContain('checkDockerAvailable');
  });
});
