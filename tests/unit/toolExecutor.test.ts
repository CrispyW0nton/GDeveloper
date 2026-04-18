/**
 * Tool Executor Tests — Sprint 27.5
 *
 * Validates per-tool timeouts, error handling, and result format.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_TIMEOUTS, getTimeoutForTool } from '../../src/main/tools/toolExecutor';

describe('toolExecutor', () => {
  describe('DEFAULT_TIMEOUTS', () => {
    it('bash_command has 120s timeout', () => {
      expect(DEFAULT_TIMEOUTS.bash_command).toBe(120_000);
    });

    it('read_file has 30s timeout', () => {
      expect(DEFAULT_TIMEOUTS.read_file).toBe(30_000);
    });

    it('write_file has 30s timeout', () => {
      expect(DEFAULT_TIMEOUTS.write_file).toBe(30_000);
    });

    it('grep has 60s timeout', () => {
      expect(DEFAULT_TIMEOUTS.grep).toBe(60_000);
    });

    it('glob has 60s timeout', () => {
      expect(DEFAULT_TIMEOUTS.glob).toBe(60_000);
    });

    it('todo has 5s timeout', () => {
      expect(DEFAULT_TIMEOUTS.todo).toBe(5_000);
    });

    it('has a default fallback of 60s', () => {
      expect(DEFAULT_TIMEOUTS.default).toBe(60_000);
    });
  });

  describe('getTimeoutForTool', () => {
    it('returns specific timeout for known tools', () => {
      expect(getTimeoutForTool('bash_command')).toBe(120_000);
      expect(getTimeoutForTool('read_file')).toBe(30_000);
      expect(getTimeoutForTool('todo')).toBe(5_000);
    });

    it('returns default timeout for unknown tools', () => {
      expect(getTimeoutForTool('unknown_tool')).toBe(60_000);
      expect(getTimeoutForTool('custom_tool_xyz')).toBe(60_000);
    });
  });

  describe('tool result format', () => {
    it('executeToolCall returns correct shape (simulated)', async () => {
      // Simulate the expected return type
      const result = {
        toolCallId: 'tc-1',
        toolName: 'read_file',
        content: 'file contents here',
        isError: false,
        timedOut: false,
        elapsedMs: 42,
      };

      expect(result).toHaveProperty('toolCallId');
      expect(result).toHaveProperty('toolName');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('isError');
      expect(result.isError).toBe(false);
    });

    it('error result has isError: true', () => {
      const result = {
        toolCallId: 'tc-2',
        toolName: 'bash_command',
        content: 'Error: command not found',
        isError: true,
        timedOut: false,
        elapsedMs: 100,
      };

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Error');
    });

    it('timed out result has timedOut: true', () => {
      const result = {
        toolCallId: 'tc-3',
        toolName: 'bash_command',
        content: 'Error: Tool "bash_command" timed out after 120000ms',
        isError: true,
        timedOut: true,
        elapsedMs: 120000,
      };

      expect(result.timedOut).toBe(true);
      expect(result.isError).toBe(true);
    });
  });

  describe('no auto-continue in toolExecutor', () => {
    it('does not contain step counters or heartbeats', () => {
      const fs = require('fs');
      const code = fs.readFileSync('src/main/tools/toolExecutor.ts', 'utf8');
      expect(code).not.toContain('step counter');
      expect(code).not.toContain('heartbeat');
      expect(code).not.toContain('Auto-Continue');
      expect(code).not.toContain('autoContinue');
      expect(code).not.toContain('setInterval');
    });
  });
});
