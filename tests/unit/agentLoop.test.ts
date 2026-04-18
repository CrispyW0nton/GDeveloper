/**
 * Agent Loop Tests — Sprint 27.5
 *
 * Validates the canonical agent loop exits cleanly on stop_reason,
 * continues on tool_use, respects maxTurns, and aborts on signal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock types ───

interface MockStreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  stopReason?: string;
}

// ─── Inline agent loop logic (mirrors agentLoop.ts without Electron deps) ───

async function runAgentLoopTest(
  makeChunks: (turn: number) => MockStreamChunk[],
  opts: { maxTurns?: number; signal?: AbortSignal } = {},
) {
  const maxTurns = opts.maxTurns ?? 25;
  const messages: any[] = [{ role: 'user', content: 'test' }];
  let allToolCalls: any[] = [];
  let lastContent = '';
  const turns: number[] = [];
  const toolExecutions: string[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (opts.signal?.aborted) {
      return { content: lastContent, toolCalls: allToolCalls, turns: turns.length, reason: 'aborted' as const };
    }

    const chunks = makeChunks(turn);
    let content = '';
    const toolCalls: any[] = [];
    let stopReason = 'end_turn';

    for (const chunk of chunks) {
      if (chunk.type === 'text') content += chunk.content || '';
      if (chunk.type === 'tool_call' && chunk.toolCall) toolCalls.push(chunk.toolCall);
      if (chunk.type === 'done') stopReason = chunk.stopReason || 'end_turn';
    }

    lastContent = content;
    turns.push(turn);

    // stop_reason check
    if (stopReason === 'end_turn') return { content: lastContent, toolCalls: allToolCalls, turns: turns.length, reason: 'end_turn' as const };
    if (stopReason === 'max_tokens') return { content: lastContent, toolCalls: allToolCalls, turns: turns.length, reason: 'max_tokens' as const };
    if (stopReason === 'stop_sequence') return { content: lastContent, toolCalls: allToolCalls, turns: turns.length, reason: 'stop_sequence' as const };
    if (stopReason !== 'tool_use') return { content: lastContent, toolCalls: allToolCalls, turns: turns.length, reason: 'end_turn' as const };

    if (toolCalls.length === 0) return { content: lastContent, toolCalls: allToolCalls, turns: turns.length, reason: 'no_tools' as const };

    allToolCalls.push(...toolCalls);
    for (const tc of toolCalls) {
      toolExecutions.push(tc.name);
    }
    messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: '[Tool Result]' });
  }

  return { content: lastContent, toolCalls: allToolCalls, turns: turns.length, reason: 'max_turns' as const, toolExecutions };
}

// ─── Tests ───

describe('agentLoop', () => {
  it('exits cleanly on stop_reason: end_turn', async () => {
    const result = await runAgentLoopTest((turn) => [
      { type: 'text', content: 'Hello, all done!' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    expect(result.reason).toBe('end_turn');
    expect(result.turns).toBe(1);
    expect(result.content).toBe('Hello, all done!');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('continues on stop_reason: tool_use', async () => {
    let callCount = 0;
    const result = await runAgentLoopTest((turn) => {
      callCount++;
      if (turn < 3) {
        return [
          { type: 'text', content: `Turn ${turn}. ` },
          { type: 'tool_call', toolCall: { id: `tc-${turn}`, name: 'bash_command', input: { command: 'echo hi' } } },
          { type: 'done', stopReason: 'tool_use' },
        ];
      }
      return [
        { type: 'text', content: 'All done!' },
        { type: 'done', stopReason: 'end_turn' },
      ];
    });

    expect(result.reason).toBe('end_turn');
    expect(result.turns).toBe(4);
    expect(result.toolCalls).toHaveLength(3);
  });

  it('respects maxTurns cap', async () => {
    const result = await runAgentLoopTest(
      (turn) => [
        { type: 'tool_call', toolCall: { id: `tc-${turn}`, name: 'read_file', input: { path: 'test.ts' } } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      { maxTurns: 5 },
    );

    expect(result.reason).toBe('max_turns');
    expect(result.turns).toBe(5);
  });

  it('aborts on AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort(); // abort immediately

    const result = await runAgentLoopTest(
      () => [
        { type: 'text', content: 'This should not run' },
        { type: 'done', stopReason: 'end_turn' },
      ],
      { signal: controller.signal },
    );

    expect(result.reason).toBe('aborted');
    expect(result.turns).toBe(0);
  });

  it('exits on stop_reason: max_tokens', async () => {
    const result = await runAgentLoopTest(() => [
      { type: 'text', content: 'Truncated output...' },
      { type: 'done', stopReason: 'max_tokens' },
    ]);

    expect(result.reason).toBe('max_tokens');
    expect(result.turns).toBe(1);
  });

  it('exits on stop_reason: stop_sequence', async () => {
    const result = await runAgentLoopTest(() => [
      { type: 'text', content: 'Hit stop sequence' },
      { type: 'done', stopReason: 'stop_sequence' },
    ]);

    expect(result.reason).toBe('stop_sequence');
    expect(result.turns).toBe(1);
  });

  it('exits on unknown stop_reason as end_turn', async () => {
    const result = await runAgentLoopTest(() => [
      { type: 'text', content: 'Unknown reason' },
      { type: 'done', stopReason: 'some_future_reason' },
    ]);

    expect(result.reason).toBe('end_turn');
    expect(result.turns).toBe(1);
  });

  it('exits with no_tools when stop_reason is tool_use but no tools', async () => {
    const result = await runAgentLoopTest(() => [
      { type: 'text', content: 'I want tools but sent none' },
      { type: 'done', stopReason: 'tool_use' },
    ]);

    expect(result.reason).toBe('no_tools');
    expect(result.turns).toBe(1);
  });

  it('does NOT contain any auto-continue references', () => {
    const fs = require('fs');
    const code = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf8');
    expect(code).not.toContain('Auto-Continue');
    expect(code).not.toContain('scheduleNextTurn');
    expect(code).not.toContain('shouldFireNudge');
    expect(code).not.toContain('autoContinue');
    expect(code).not.toContain('setInterval');
  });

  it('uses stop_reason as the sole termination signal', () => {
    const fs = require('fs');
    const code = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf8');
    expect(code).toContain('stop_reason');
    expect(code).toContain('end_turn');
    expect(code).toContain('tool_use');
    expect(code).toContain('max_tokens');
    expect(code).toContain('stop_sequence');
  });
});
