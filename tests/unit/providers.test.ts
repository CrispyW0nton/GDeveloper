/**
 * Providers Tests — Sprint 28
 * Verifies that streamChatToRenderer surfaces stopReason from Anthropic's message_delta.
 * Also validates LLMStreamChunk interface includes stopReason.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const providersCode = readFileSync(resolve(__dirname, '../../src/main/providers/index.ts'), 'utf-8');
const interfacesCode = readFileSync(resolve(__dirname, '../../src/main/domain/interfaces/index.ts'), 'utf-8');

describe('Providers — Sprint 28 stopReason', () => {

  // ─── Interface checks ───

  it('LLMStreamChunk interface has stopReason field', () => {
    expect(interfacesCode).toContain('stopReason?: string');
  });

  it('LLMResponse interface has stopReason field', () => {
    expect(interfacesCode).toContain('stopReason: string');
  });

  // ─── streamMessage captures stop_reason ───

  it('streamMessage captures stop_reason from message_delta', () => {
    expect(providersCode).toContain('event.delta?.stop_reason');
    expect(providersCode).toContain('streamStopReason = event.delta.stop_reason');
  });

  it('streamMessage yields done chunk with stopReason', () => {
    // MCP-429-04 broadened the done chunk from a single-line literal to a
    // multi-line object that also carries parsed rate-limit headers.
    // Assert on the structural invariant (type:'done' + stopReason:streamStopReason)
    // rather than a brittle exact-string match.
    expect(providersCode).toMatch(/yield\s*\{[\s\S]{0,400}?type:\s*'done'[\s\S]{0,400}?stopReason:\s*streamStopReason/);
  });

  it('streamStopReason defaults to end_turn', () => {
    expect(providersCode).toContain("let streamStopReason = 'end_turn'");
  });

  // ─── streamChatToRenderer returns stopReason ───

  it('streamChatToRenderer return type includes stopReason', () => {
    expect(providersCode).toContain('Promise<{ content: string; toolCalls?: any[]; stopReason: string }>');
  });

  it('streamChatToRenderer captures stopReason from done chunk', () => {
    // The done handler reads (chunk as any).stopReason
    expect(providersCode).toContain('stopReason = (chunk as any).stopReason');
  });

  it('streamChatToRenderer infers tool_use when toolCalls present but stopReason is end_turn', () => {
    // Edge case fix: Anthropic sometimes sends end_turn even with tool calls
    expect(providersCode).toContain("if (toolCalls.length > 0 && stopReason === 'end_turn')");
    expect(providersCode).toContain("stopReason = 'tool_use'");
  });

  it('streamChatToRenderer sends stopReason to renderer', () => {
    expect(providersCode).toContain("type: 'done'");
    // The done chunk includes stopReason
    expect(providersCode).toContain('stopReason,');
  });

  // ─── sendMessage surfaces stop_reason ───

  it('sendMessage reads stop_reason from response', () => {
    expect(providersCode).toContain("data.stop_reason || 'end_turn'");
  });

  // ─── No legacy patterns ───

  it('providers does not contain COMPLETION_PATTERNS', () => {
    expect(providersCode).not.toContain('COMPLETION_PATTERNS');
  });

  it('providers does not contain scheduleNextTurn', () => {
    expect(providersCode).not.toContain('scheduleNextTurn');
  });

  it('providers does not import autoContinue', () => {
    expect(providersCode).not.toContain('autoContinue');
  });
});
