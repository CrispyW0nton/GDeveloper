/**
 * Agent Loop Tests — Sprint 28 (Cline-style semantic tool-use loop)
 *
 * 12 test cases covering:
 *  1. Normal completion (attempt_completion short-circuits loop)
 *  2. ask_followup_question pauses loop
 *  3. No-tool-used nudge injection (end_turn + no tools)
 *  4. Consecutive no-tool-use cap (maxConsecutiveMistakes)
 *  5. maxTurns safety cap
 *  6. Abort signal
 *  7. max_tokens stop reason
 *  8. stop_sequence stop reason
 *  9. Rate-limit pre-flight rejection
 *  10. Tool result appended with user role
 *  11. Multiple tool calls in single turn
 *  12. Source file static analysis (no legacy patterns)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Mock streamChatToRenderer ───
// We mock the entire providers module so runAgentLoop can import it
const mockStreamChat = vi.fn();
vi.mock('../../src/main/providers', () => ({
  streamChatToRenderer: (...args: any[]) => mockStreamChat(...args),
}));

// Mock electron BrowserWindow
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

// Import after mocks are set up
import { runAgentLoop, AgentLoopOptions, AgentLoopResult } from '../../src/main/orchestration/agentLoop';

// ─── Helpers ───

function makeOptions(overrides: Partial<AgentLoopOptions> = {}): AgentLoopOptions {
  return {
    provider: { name: 'mock', sendMessage: vi.fn(), streamMessage: vi.fn(), countTokens: vi.fn() } as any,
    win: null,
    sessionId: 'test-session',
    systemPrompt: 'You are a test assistant.',
    tools: [{ name: 'read_file', description: 'read', inputSchema: {} }],
    messages: [{ role: 'user', content: 'Hello' }],
    maxTurns: 10,
    maxConsecutiveMistakes: 3,
    executeTool: vi.fn().mockResolvedValue({ content: 'tool result', isError: false }),
    persistMessage: vi.fn(),
    ...overrides,
  };
}

/** Helper to make streamChatToRenderer return a text-only response (no tools) */
function mockTextResponse(content: string, stopReason = 'end_turn') {
  return { content, toolCalls: undefined, stopReason };
}

/** Helper to make streamChatToRenderer return a tool-use response */
function mockToolResponse(content: string, toolCalls: any[], stopReason = 'tool_use') {
  return { content, toolCalls, stopReason };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Static Source Analysis ───

describe('Agent Loop — Static Analysis', () => {
  const agentLoopCode = readFileSync(resolve(__dirname, '../../src/main/orchestration/agentLoop.ts'), 'utf-8');
  const formatResponseCode = readFileSync(resolve(__dirname, '../../src/main/orchestration/formatResponse.ts'), 'utf-8');
  const promptsCode = readFileSync(resolve(__dirname, '../../src/main/orchestration/prompts.ts'), 'utf-8');

  it('agentLoop.ts does not contain COMPLETION_PATTERNS', () => {
    expect(agentLoopCode).not.toContain('COMPLETION_PATTERNS');
  });

  it('agentLoop.ts does not contain scheduleNextTurn', () => {
    expect(agentLoopCode).not.toContain('scheduleNextTurn');
  });

  it('agentLoop.ts uses stopReason as termination signal', () => {
    expect(agentLoopCode).toContain('stopReason');
    expect(agentLoopCode).toContain('end_turn');
    expect(agentLoopCode).toContain('tool_use');
    expect(agentLoopCode).toContain('max_tokens');
    expect(agentLoopCode).toContain('stop_sequence');
  });

  it('agentLoop.ts references terminal tools', () => {
    expect(agentLoopCode).toContain('attempt_completion');
    expect(agentLoopCode).toContain('ask_followup_question');
    expect(agentLoopCode).toContain('TERMINAL_TOOLS');
  });

  it('formatResponse.ts contains noToolsUsed + toolDenied + toolError', () => {
    expect(formatResponseCode).toContain('noToolsUsed');
    expect(formatResponseCode).toContain('toolDenied');
    expect(formatResponseCode).toContain('toolError');
  });

  it('SYSTEM_PROMPT contains tool use rules', () => {
    expect(promptsCode).toContain('TOOL USE RULES');
    expect(promptsCode).toContain('you MUST use at least one tool');
    expect(promptsCode).toContain('attempt_completion tool is FINAL');
  });
});

// ─── Behavioral Tests ───

describe('Agent Loop — Behavioral', () => {

  // 1. Normal completion via attempt_completion
  it('exits on attempt_completion with reason and result', async () => {
    mockStreamChat.mockResolvedValueOnce(mockToolResponse('Let me complete', [
      { id: 'tc-1', name: 'attempt_completion', input: { result: 'Done!' } },
    ]));

    const executeTool = vi.fn().mockResolvedValue({
      content: JSON.stringify({ success: true, result: 'Done!' }),
      isError: false,
    });

    const result = await runAgentLoop(makeOptions({ executeTool }));

    expect(result.reason).toBe('attempt_completion');
    expect(result.completionResult).toBe('Done!');
    expect(result.turns).toBe(1);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  // 2. ask_followup_question pauses loop
  it('exits on ask_followup_question', async () => {
    mockStreamChat.mockResolvedValueOnce(mockToolResponse('Need info', [
      { id: 'tc-1', name: 'ask_followup_question', input: { question: 'What framework?' } },
    ]));

    const executeTool = vi.fn().mockResolvedValue({
      content: JSON.stringify({ success: true, question: 'What framework?' }),
      isError: false,
    });

    const result = await runAgentLoop(makeOptions({ executeTool }));

    expect(result.reason).toBe('ask_followup_question');
    expect(result.followupQuestion).toBe('What framework?');
    expect(result.turns).toBe(1);
  });

  // 3. No-tool-used nudge injection
  it('injects noToolsUsed nudge when end_turn with no tools', async () => {
    // First response: text only (should trigger nudge)
    // Second response: attempt_completion (should exit)
    mockStreamChat
      .mockResolvedValueOnce(mockTextResponse('I think the task is done'))
      .mockResolvedValueOnce(mockToolResponse('Completing', [
        { id: 'tc-1', name: 'attempt_completion', input: { result: 'All done' } },
      ]));

    const executeTool = vi.fn().mockResolvedValue({
      content: JSON.stringify({ success: true, result: 'All done' }),
      isError: false,
    });

    const persistMessage = vi.fn();

    const result = await runAgentLoop(makeOptions({ executeTool, persistMessage }));

    expect(result.reason).toBe('attempt_completion');
    expect(result.turns).toBe(2);
    // Sprint 35: Nudge is NO LONGER persisted to DB (ephemeral in-loop only).
    // The assistant response IS persisted, but the nudge user message is not.
    const nudgeCalls = persistMessage.mock.calls.filter(
      (c: any) => c[0] === 'user' && typeof c[1] === 'string' && c[1].includes('did not use a tool')
    );
    expect(nudgeCalls.length).toBe(0);
  });

  // 4. Consecutive no-tool-use cap (maxConsecutiveMistakes)
  it('gives up after maxConsecutiveMistakes no-tool responses', async () => {
    mockStreamChat
      .mockResolvedValue(mockTextResponse('Still thinking...'));

    const result = await runAgentLoop(makeOptions({ maxConsecutiveMistakes: 3 }));

    expect(result.reason).toBe('no_tools');
    expect(result.turns).toBe(3);
  });

  // 5. maxTurns safety cap
  it('exits with max_turns after hitting safety cap', async () => {
    // Every turn returns a tool call that isn't terminal
    mockStreamChat.mockResolvedValue(mockToolResponse('Reading', [
      { id: 'tc-1', name: 'read_file', input: { path: 'a.ts' } },
    ]));

    const result = await runAgentLoop(makeOptions({ maxTurns: 3 }));

    expect(result.reason).toBe('max_turns');
    expect(result.turns).toBe(3);
  });

  // 6. Abort signal
  it('respects abort signal', async () => {
    const ac = new AbortController();
    ac.abort(); // pre-abort

    const result = await runAgentLoop(makeOptions({ abortSignal: ac.signal }));

    expect(result.reason).toBe('aborted');
    expect(result.turns).toBe(0);
    expect(mockStreamChat).not.toHaveBeenCalled();
  });

  // 7. max_tokens stop reason
  it('exits on max_tokens stop reason', async () => {
    mockStreamChat.mockResolvedValueOnce(mockTextResponse('Truncated response...', 'max_tokens'));

    const result = await runAgentLoop(makeOptions());

    expect(result.reason).toBe('max_tokens');
    expect(result.turns).toBe(1);
  });

  // 8. stop_sequence stop reason
  it('exits on stop_sequence stop reason', async () => {
    mockStreamChat.mockResolvedValueOnce(mockTextResponse('Stopped at sequence', 'stop_sequence'));

    const result = await runAgentLoop(makeOptions());

    expect(result.reason).toBe('stop_sequence');
    expect(result.turns).toBe(1);
  });

  // 9. Rate-limit pre-flight rejection
  it('exits with error when rate limit check fails', async () => {
    const result = await runAgentLoop(makeOptions({
      rateLimitCheck: () => ({ ok: false, reason: 'Rate limited', delayMs: 0 }),
    }));

    expect(result.reason).toBe('error');
    expect(mockStreamChat).not.toHaveBeenCalled();
  });

  // 10. Tool results appended as user-role message
  it('appends tool results in user role for next turn', async () => {
    // Turn 1: tool call (read_file)
    mockStreamChat
      .mockResolvedValueOnce(mockToolResponse('Reading file', [
        { id: 'tc-1', name: 'read_file', input: { path: 'hello.ts' } },
      ]))
      // Turn 2: completion
      .mockResolvedValueOnce(mockToolResponse('Done', [
        { id: 'tc-2', name: 'attempt_completion', input: { result: 'Complete' } },
      ]));

    // Use sequential mocks: first call returns file contents, second returns completion
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ content: 'file contents here', isError: false })
      .mockResolvedValueOnce({
        content: JSON.stringify({ success: true, result: 'Complete' }),
        isError: false,
      });

    const result = await runAgentLoop(makeOptions({ executeTool }));

    expect(result.turns).toBe(2);
    // Verify that executeTool was called with read_file first, then attempt_completion
    expect(executeTool.mock.calls[0][0].name).toBe('read_file');
    expect(executeTool.mock.calls[1][0].name).toBe('attempt_completion');
    // Check second streamChat call received messages including tool result from turn 1
    const secondCall = mockStreamChat.mock.calls[1];
    const secondMessages = secondCall[2]; // messages arg is index 2
    // Find user message containing tool result from turn 1 (read_file)
    const toolResultMsgs = secondMessages.filter(
      (m: any) => m.role === 'user' && m.content.includes('Tool Result')
    );
    expect(toolResultMsgs.length).toBeGreaterThan(0);
    expect(toolResultMsgs[0].content).toContain('read_file');
  });

  // 11. Multiple tool calls in a single turn
  it('handles multiple tool calls in one turn', async () => {
    mockStreamChat.mockResolvedValueOnce(mockToolResponse('Reading both', [
      { id: 'tc-1', name: 'read_file', input: { path: 'a.ts' } },
      { id: 'tc-2', name: 'read_file', input: { path: 'b.ts' } },
    ])).mockResolvedValueOnce(mockToolResponse('Done', [
      { id: 'tc-3', name: 'attempt_completion', input: { result: 'Both read' } },
    ]));

    const executeTool = vi.fn()
      .mockResolvedValueOnce({ content: 'content of a.ts', isError: false })
      .mockResolvedValueOnce({ content: 'content of b.ts', isError: false })
      .mockResolvedValueOnce({ content: JSON.stringify({ success: true, result: 'Both read' }), isError: false });

    const result = await runAgentLoop(makeOptions({ executeTool }));

    expect(result.reason).toBe('attempt_completion');
    expect(result.toolCalls).toHaveLength(3);
    expect(executeTool).toHaveBeenCalledTimes(3);
  });

  // 12. API error during streaming
  it('returns error when streamChatToRenderer throws', async () => {
    mockStreamChat.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await runAgentLoop(makeOptions());

    expect(result.reason).toBe('error');
    expect(result.content).toContain('Network timeout');
    expect(result.turns).toBe(1);
  });
});
