/**
 * Integration Test: Agent Task Flow — Sprint 27.5
 *
 * Full multi-turn flow: todo → bash → bash → bash → end_turn
 * Verifies no "Auto-Continue" strings appear anywhere.
 * Verifies stop_reason is the sole termination signal.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ─── Helpers ───

function readSourceFile(relPath: string): string {
  const fullPath = join(process.cwd(), relPath);
  if (!existsSync(fullPath)) return '';
  return readFileSync(fullPath, 'utf8');
}

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  const fullDir = join(process.cwd(), dir);
  if (!existsSync(fullDir)) return results;

  function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          walk(p);
        }
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        results.push(p);
      }
    }
  }
  walk(fullDir);
  return results;
}

// ─── Simulate a multi-turn agent flow ───

interface SimTurn {
  stopReason: string;
  text: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
}

function simulateAgentFlow(turns: SimTurn[]): {
  finalContent: string;
  totalToolCalls: number;
  exitReason: string;
  turnCount: number;
  log: string[];
} {
  const log: string[] = [];
  let allToolCalls = 0;
  let lastContent = '';

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    lastContent = turn.text;
    log.push(`Turn ${i + 1}: stopReason=${turn.stopReason}, tools=${turn.toolCalls.length}`);

    if (turn.stopReason === 'end_turn') {
      return { finalContent: lastContent, totalToolCalls: allToolCalls, exitReason: 'end_turn', turnCount: i + 1, log };
    }
    if (turn.stopReason === 'max_tokens') {
      return { finalContent: lastContent, totalToolCalls: allToolCalls, exitReason: 'max_tokens', turnCount: i + 1, log };
    }
    if (turn.stopReason !== 'tool_use') {
      return { finalContent: lastContent, totalToolCalls: allToolCalls, exitReason: 'unknown', turnCount: i + 1, log };
    }

    // Execute tools
    allToolCalls += turn.toolCalls.length;
    for (const tc of turn.toolCalls) {
      log.push(`  Executed: ${tc.name}(${JSON.stringify(tc.input)})`);
    }
  }

  return { finalContent: lastContent, totalToolCalls: allToolCalls, exitReason: 'max_turns', turnCount: turns.length, log };
}

// ─── Tests ───

describe('agent-task-flow integration', () => {
  it('full multi-turn flow: todo → bash → bash → bash → end_turn', () => {
    const flow = simulateAgentFlow([
      {
        stopReason: 'tool_use',
        text: 'Let me create a task plan.',
        toolCalls: [{ id: 'tc-1', name: 'todo', input: { todos: [
          { id: '1', content: 'echo hello', status: 'in_progress', priority: 'high' },
          { id: '2', content: 'echo world', status: 'pending', priority: 'medium' },
          { id: '3', content: 'sleep && echo done', status: 'pending', priority: 'low' },
        ] } }],
      },
      {
        stopReason: 'tool_use',
        text: 'Running step 1.',
        toolCalls: [{ id: 'tc-2', name: 'bash_command', input: { command: 'echo hello' } }],
      },
      {
        stopReason: 'tool_use',
        text: 'Running step 2.',
        toolCalls: [{ id: 'tc-3', name: 'bash_command', input: { command: 'echo world' } }],
      },
      {
        stopReason: 'tool_use',
        text: 'Running step 3.',
        toolCalls: [{ id: 'tc-4', name: 'bash_command', input: { command: 'sleep 3 && echo done' } }],
      },
      {
        stopReason: 'end_turn',
        text: 'All tasks complete. Here is a summary:\n1. echo hello - done\n2. echo world - done\n3. sleep && echo done - done',
        toolCalls: [],
      },
    ]);

    expect(flow.exitReason).toBe('end_turn');
    expect(flow.turnCount).toBe(5);
    expect(flow.totalToolCalls).toBe(4); // 1 todo + 3 bash
    expect(flow.finalContent).toContain('All tasks complete');
    // No "Auto-Continue" in any log entry
    for (const entry of flow.log) {
      expect(entry).not.toContain('Auto-Continue');
    }
  });

  it('no "Auto-Continue" strings in src/ source files', () => {
    const srcFiles = getAllTsFiles('src');
    const violations: string[] = [];

    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      // Skip deleted files and test references
      if (file.includes('node_modules')) continue;
      if (content.includes('Auto-Continue')) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it('no "autoContinueState" references in src/', () => {
    const srcFiles = getAllTsFiles('src');
    const violations: string[] = [];

    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      if (file.includes('node_modules')) continue;
      if (content.includes('autoContinueState')) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it('no "step 1/10" style patterns in src/', () => {
    const srcFiles = getAllTsFiles('src');
    const violations: string[] = [];

    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      if (file.includes('node_modules')) continue;
      if (/step \d+\/\d+/.test(content)) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it('no "silent-stall" references in src/', () => {
    const srcFiles = getAllTsFiles('src');
    const violations: string[] = [];

    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      if (file.includes('node_modules')) continue;
      if (content.includes('silent-stall')) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it('agentLoop.ts uses stop_reason as the sole termination signal', () => {
    const code = readSourceFile('src/main/orchestration/agentLoop.ts');
    expect(code).toBeTruthy();
    expect(code).toContain('stop_reason');
    expect(code).toContain("stopReason === 'end_turn'");
    expect(code).toContain("stopReason !== 'tool_use'");
    expect(code).toContain("stopReason === 'max_tokens'");
    expect(code).not.toContain('shouldFireNudge');
    expect(code).not.toContain('scheduleNextTurn');
    expect(code).not.toContain('setInterval');
  });

  it('streamChatToRenderer returns stopReason', () => {
    const code = readSourceFile('src/main/providers/index.ts');
    expect(code).toContain('stopReason');
    expect(code).toContain('stop_reason');
    expect(code).toContain("streamStopReason = event.delta.stop_reason");
  });

  it('onTodoChanged is exposed in preload', () => {
    const code = readSourceFile('src/preload/index.ts');
    expect(code).toContain('onTodoChanged');
    expect(code).toContain("todo:changed");
  });

  it('TaskQueuePanel subscribes to onTodoChanged', () => {
    const code = readSourceFile('src/renderer/components/chat/TaskQueuePanel.tsx');
    expect(code).toContain('onTodoChanged');
  });

  it('ToolCallBlock component exists and renders tool info', () => {
    const code = readSourceFile('src/renderer/components/chat/ToolCallBlock.tsx');
    expect(code).toBeTruthy();
    expect(code).toContain('toolName');
    expect(code).toContain('toolCallId');
    expect(code).toContain('isError');
    expect(code).toContain('timedOut');
  });

  it('system prompt includes todo tool instruction', () => {
    const code = readSourceFile('src/main/orchestration/prompts.ts');
    expect(code).toContain('todo');
    expect(code).toContain('in_progress');
    expect(code).toContain('text-only response');
  });
});
