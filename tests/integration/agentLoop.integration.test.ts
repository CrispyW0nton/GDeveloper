/**
 * Integration Test — Sprint 28
 * Simulates a 5-turn todo → edit → verify → attempt_completion flow.
 *
 * Expects exactly 5 API calls and no "Run again" button.
 * Validates the full lifecycle: tool calls → results → loop exit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock streamChatToRenderer ───
const mockStreamChat = vi.fn();
vi.mock('../../src/main/providers', () => ({
  streamChatToRenderer: (...args: any[]) => mockStreamChat(...args),
}));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

import { runAgentLoop, AgentLoopOptions } from '../../src/main/orchestration/agentLoop';

function makeOptions(overrides: Partial<AgentLoopOptions> = {}): AgentLoopOptions {
  return {
    provider: { name: 'mock', sendMessage: vi.fn(), streamMessage: vi.fn(), countTokens: vi.fn() } as any,
    win: null,
    sessionId: 'integration-test',
    systemPrompt: 'You are a test assistant.',
    tools: [
      { name: 'read_file', description: 'read', inputSchema: {} },
      { name: 'write_file', description: 'write', inputSchema: {} },
      { name: 'run_command', description: 'run', inputSchema: {} },
      { name: 'attempt_completion', description: 'complete', inputSchema: {} },
    ],
    messages: [{ role: 'user', content: 'Create a hello world file, verify it, commit it.' }],
    maxTurns: 25,
    maxConsecutiveMistakes: 3,
    executeTool: vi.fn(),
    persistMessage: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Integration — 5-Turn Todo Flow', () => {

  it('completes a 5-turn todo→edit→verify→commit→completion flow with exactly 5 API calls', async () => {
    // Turn 1: Create task plan + write hello.ts
    mockStreamChat.mockResolvedValueOnce({
      content: 'I will create a hello world file.',
      toolCalls: [
        { id: 'tc-1', name: 'write_file', input: { path: 'hello.ts', content: 'console.log("Hello!")' } },
      ],
      stopReason: 'tool_use',
    });

    // Turn 2: Read the file to verify
    mockStreamChat.mockResolvedValueOnce({
      content: 'Let me verify the file was created correctly.',
      toolCalls: [
        { id: 'tc-2', name: 'read_file', input: { path: 'hello.ts' } },
      ],
      stopReason: 'tool_use',
    });

    // Turn 3: Run the file to test
    mockStreamChat.mockResolvedValueOnce({
      content: 'Let me run the file to verify output.',
      toolCalls: [
        { id: 'tc-3', name: 'run_command', input: { command: 'npx ts-node hello.ts' } },
      ],
      stopReason: 'tool_use',
    });

    // Turn 4: Commit the file
    mockStreamChat.mockResolvedValueOnce({
      content: 'Output is correct. Let me commit.',
      toolCalls: [
        { id: 'tc-4', name: 'run_command', input: { command: 'git add . && git commit -m "add hello world"' } },
      ],
      stopReason: 'tool_use',
    });

    // Turn 5: attempt_completion
    mockStreamChat.mockResolvedValueOnce({
      content: 'All done. Here is the summary.',
      toolCalls: [
        { id: 'tc-5', name: 'attempt_completion', input: { result: 'Created hello.ts, verified output, committed.' } },
      ],
      stopReason: 'tool_use',
    });

    const executeTool = vi.fn()
      .mockResolvedValueOnce({ content: 'Created hello.ts (40 bytes)', isError: false })
      .mockResolvedValueOnce({ content: 'console.log("Hello!")', isError: false })
      .mockResolvedValueOnce({ content: 'Hello!\n', isError: false })
      .mockResolvedValueOnce({ content: 'Committed: abc1234\nBranch: main\nSummary: 1 changed, 1 insertions, 0 deletions', isError: false })
      .mockResolvedValueOnce({ content: JSON.stringify({ success: true, result: 'Created hello.ts, verified output, committed.' }), isError: false });

    const persistMessage = vi.fn();

    const result = await runAgentLoop(makeOptions({ executeTool, persistMessage }));

    // ─── Assertions ───

    // Exactly 5 API calls
    expect(mockStreamChat).toHaveBeenCalledTimes(5);

    // Loop exited via attempt_completion
    expect(result.reason).toBe('attempt_completion');

    // 5 turns
    expect(result.turns).toBe(5);

    // 5 total tool calls
    expect(result.toolCalls).toHaveLength(5);

    // Completion result is captured
    expect(result.completionResult).toBe('Created hello.ts, verified output, committed.');

    // All 5 tools were executed
    expect(executeTool).toHaveBeenCalledTimes(5);

    // Tool call names in order
    const toolNames = executeTool.mock.calls.map((c: any) => c[0].name);
    expect(toolNames).toEqual([
      'write_file',
      'read_file',
      'run_command',
      'run_command',
      'attempt_completion',
    ]);
  });

  it('no "Run again" button — loop exits cleanly without external intervention', async () => {
    // Simple 1-turn completion
    mockStreamChat.mockResolvedValueOnce({
      content: 'Done.',
      toolCalls: [
        { id: 'tc-1', name: 'attempt_completion', input: { result: 'Task complete.' } },
      ],
      stopReason: 'tool_use',
    });

    const executeTool = vi.fn().mockResolvedValue({
      content: JSON.stringify({ success: true, result: 'Task complete.' }),
      isError: false,
    });

    const result = await runAgentLoop(makeOptions({ executeTool }));

    // Loop exited naturally — no need for "Run again"
    expect(result.reason).toBe('attempt_completion');
    expect(result.turns).toBe(1);
    // The reason is not 'max_turns' or 'error' — these would indicate a need for "Run again"
    expect(result.reason).not.toBe('max_turns');
    expect(result.reason).not.toBe('error');
  });

  it('handles error recovery mid-flow', async () => {
    // Turn 1: write file succeeds
    mockStreamChat.mockResolvedValueOnce({
      content: 'Writing file.',
      toolCalls: [{ id: 'tc-1', name: 'write_file', input: { path: 'test.ts', content: 'hello' } }],
      stopReason: 'tool_use',
    });

    // Turn 2: verify fails
    mockStreamChat.mockResolvedValueOnce({
      content: 'Verifying.',
      toolCalls: [{ id: 'tc-2', name: 'run_command', input: { command: 'npx tsc --noEmit' } }],
      stopReason: 'tool_use',
    });

    // Turn 3: fix the error
    mockStreamChat.mockResolvedValueOnce({
      content: 'Fixing TypeScript error.',
      toolCalls: [{ id: 'tc-3', name: 'write_file', input: { path: 'test.ts', content: 'const hello: string = "hello";' } }],
      stopReason: 'tool_use',
    });

    // Turn 4: re-verify succeeds + completion
    mockStreamChat.mockResolvedValueOnce({
      content: 'All good now.',
      toolCalls: [{ id: 'tc-4', name: 'attempt_completion', input: { result: 'Fixed and verified.' } }],
      stopReason: 'tool_use',
    });

    const executeTool = vi.fn()
      .mockResolvedValueOnce({ content: 'Created test.ts', isError: false })
      .mockResolvedValueOnce({ content: 'Error: Type error in test.ts', isError: true }) // error
      .mockResolvedValueOnce({ content: 'Updated test.ts', isError: false })
      .mockResolvedValueOnce({ content: JSON.stringify({ success: true, result: 'Fixed and verified.' }), isError: false });

    const result = await runAgentLoop(makeOptions({ executeTool }));

    expect(result.reason).toBe('attempt_completion');
    expect(result.turns).toBe(4);
    expect(result.completionResult).toBe('Fixed and verified.');
  });
});
