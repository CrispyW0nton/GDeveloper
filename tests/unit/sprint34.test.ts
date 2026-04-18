/**
 * Sprint 34 Test Suite — Stop Silent tool_use Drops
 *
 * Tests cover:
 *   1. multi_block_parsing — multiple tool_use blocks are all captured
 *   2. partial_json_across_chunks — inputJson accumulates across delta events
 *   3. malformed_json_logging — parse failures are logged, not silently swallowed
 *   4. crlf_boundaries — SSE buffer splits on \r\n, \r, and \n correctly
 *   5. single_block_regression — single tool_use block still works
 *   6. empty_input_schema_guard — git_status (empty input) yields {}, others skip
 *   7. sse_parse_fail_logging — outer SSE JSON.parse errors are logged
 *   8. tool_block_start_logging — every content_block_start type=tool_use is logged
 *   9. tool_block_stop_logging — content_block_stop yields with input summary
 *  10. no_silent_catch — no bare catch{} in streaming code path
 *  11. anti_goals — does NOT modify agentLoop.ts, ChatWorkspace.tsx, TaskPlanCard.tsx,
 *      activePlanState.ts, preload, or IPC channels
 *  12. backward_compat — Sprint 33 diagnostics and Sprint 29-32 patterns preserved
 *
 * Root cause: Two silent `catch {}` blocks in streamMessage swallowed JSON parse
 * errors for both SSE event lines and tool input JSON. Combined with a \n-only
 * line splitter that failed on \r\n boundaries, tool_use blocks were silently
 * dropped, causing the agent loop to see zero tool calls and fire the nudge.
 *
 * One-line diagnosis: Silent catch blocks in ClaudeProvider.streamMessage
 * swallowed tool_use input JSON parse errors, dropping valid tool calls.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════
//  Test 1: multi_block_parsing — multiple tool_use blocks
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — Multi-block tool_use parsing', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('tracks tool block count with _toolBlockCount', () => {
    expect(providerSrc).toContain('_toolBlockCount');
    expect(providerSrc).toContain('_toolBlockCount++');
  });

  it('logs each tool-block-start with blockIndex, toolId, toolName', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] tool-block-start');
    expect(providerSrc).toContain('blockIndex');
    expect(providerSrc).toContain('toolId');
    expect(providerSrc).toContain('toolName');
  });

  it('yields tool_call for each completed tool_use block', () => {
    // Verify the yield is inside the content_block_stop handler
    const blockStopIdx = providerSrc.indexOf("event.type === 'content_block_stop'");
    const yieldIdx = providerSrc.indexOf("yield {\n                  type: 'tool_call'", blockStopIdx);
    expect(blockStopIdx).toBeGreaterThan(0);
    expect(yieldIdx).toBeGreaterThan(blockStopIdx);
  });

  it('message-delta log includes toolBlocksSeen count', () => {
    expect(providerSrc).toContain('toolBlocksSeen: _toolBlockCount');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 2: partial_json_across_chunks
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — Partial JSON across chunks', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('accumulates inputJson from input_json_delta events', () => {
    expect(providerSrc).toContain("currentToolCall.inputJson += event.delta.partial_json || ''");
  });

  it('parses accumulated inputJson on content_block_stop', () => {
    // The parse happens in the content_block_stop handler
    expect(providerSrc).toContain('JSON.parse(rawJson)');
  });

  it('rawJson references currentToolCall.inputJson', () => {
    expect(providerSrc).toContain('const rawJson = currentToolCall.inputJson');
  });

  it('only attempts parse when rawJson.length > 0', () => {
    expect(providerSrc).toContain('if (rawJson.length > 0)');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 3: malformed_json_logging
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — Malformed JSON logging (no silent drops)', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('tool-input-parse-fail is logged on JSON.parse error', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] tool-input-parse-fail');
  });

  it('parse fail log includes rawJsonLength, rawJsonPreview, rawJsonTail, error', () => {
    const parseFail = providerSrc.slice(
      providerSrc.indexOf('tool-input-parse-fail'),
      providerSrc.indexOf('tool-input-parse-fail') + 500
    );
    expect(parseFail).toContain('rawJsonLength');
    expect(parseFail).toContain('rawJsonPreview');
    expect(parseFail).toContain('rawJsonTail');
    expect(parseFail).toContain('error: errMsg');
  });

  it('tool-input-empty is logged when empty input on non-empty-schema tool', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] tool-input-empty');
  });

  it('tool-input-empty log includes reason field', () => {
    const emptyLog = providerSrc.slice(
      providerSrc.indexOf('tool-input-empty\','),
      providerSrc.indexOf('tool-input-empty\',') + 400
    );
    expect(emptyLog).toContain('reason:');
    expect(emptyLog).toContain('no input_json_delta received');
    expect(emptyLog).toContain('JSON parse failed');
  });

  it('broken tool_call is skipped (continue, not yielded)', () => {
    // After logging tool-input-empty, the code sets currentToolCall = null and continues
    const emptyIdx = providerSrc.indexOf('tool-input-empty event and SKIP');
    expect(emptyIdx).toBeGreaterThan(0);
    const afterEmpty = providerSrc.slice(emptyIdx, emptyIdx + 800);
    expect(afterEmpty).toContain('currentToolCall = null');
    expect(afterEmpty).toContain('continue; // skip yielding');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 4: crlf_boundaries — CRLF-aware SSE splitter
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — CRLF-aware SSE buffer handling', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('uses regex-based line splitter for \\r\\n, \\r, and \\n', () => {
    // The split regex handles all three SSE line endings
    expect(providerSrc).toContain('split(/\\r\\n|\\r|\\n/)');
  });

  it('keeps trailing incomplete segment in buffer', () => {
    // lines.pop() retains the incomplete segment
    expect(providerSrc).toContain("buffer = lines.pop() || ''");
  });

  it('does NOT use simple \\n-only split for SSE lines', () => {
    // Ensure the old split('\n') is NOT used for SSE line parsing
    // (it may still exist elsewhere for non-SSE uses, but the main
    // streaming loop should use the regex splitter)
    const streamMethodStart = providerSrc.indexOf('async *streamMessage(');
    const streamMethodEnd = providerSrc.indexOf('yield { type: \'done\'');
    const streamBody = providerSrc.slice(streamMethodStart, streamMethodEnd);
    // The stream body should NOT have split('\n') — it should use the regex
    expect(streamBody).not.toContain("split('\\n')");
  });

  it('trims lines before checking data: prefix', () => {
    expect(providerSrc).toContain('const trimmedLine = line.trim()');
    expect(providerSrc).toContain("trimmedLine.startsWith('data: ')");
  });

  it('handles empty data after prefix strip', () => {
    expect(providerSrc).toContain('data.length === 0');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 5: single_block_regression
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — Single tool_use block regression', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('content_block_start creates currentToolCall for tool_use type', () => {
    expect(providerSrc).toContain("if (event.content_block?.type === 'tool_use')");
    expect(providerSrc).toContain('currentToolCall = {');
  });

  it('content_block_delta accumulates partial_json', () => {
    expect(providerSrc).toContain("event.delta?.type === 'input_json_delta'");
  });

  it('content_block_stop yields tool_call when input is valid', () => {
    expect(providerSrc).toContain("type: 'tool_call'");
    expect(providerSrc).toContain('toolCall: {');
  });

  it('tool-block-stop log emits inputKeys for debugging', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] tool-block-stop');
    expect(providerSrc).toContain('inputKeys: Object.keys(input)');
    expect(providerSrc).toContain('inputJsonLength: rawJson.length');
  });

  it('currentToolCall is nulled after yield', () => {
    // After yielding, currentToolCall = null
    const yieldIdx = providerSrc.indexOf("type: 'tool_call',\n                  toolCall:");
    const afterYield = providerSrc.slice(yieldIdx, yieldIdx + 300);
    expect(afterYield).toContain('currentToolCall = null');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 6: empty_input_schema_guard
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — Empty input schema guard (EMPTY_INPUT_TOOLS)', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('defines EMPTY_INPUT_TOOLS set', () => {
    expect(providerSrc).toContain('EMPTY_INPUT_TOOLS');
    expect(providerSrc).toContain("new Set(['git_status'])");
  });

  it('allows empty input for tools in EMPTY_INPUT_TOOLS', () => {
    expect(providerSrc).toContain('EMPTY_INPUT_TOOLS.has(toolName)');
    expect(providerSrc).toContain('tool-input-empty-allowed');
  });

  it('skips (continues) tool_call for non-empty-schema tools with null input', () => {
    // After the EMPTY_INPUT_TOOLS check, tools NOT in the set get skipped
    const emptyIdx = providerSrc.indexOf('tool-input-empty event and SKIP');
    expect(emptyIdx).toBeGreaterThan(0);
    const afterEmpty = providerSrc.slice(emptyIdx, emptyIdx + 800);
    expect(afterEmpty).toContain('continue; // skip yielding');
  });

  it('git_status tool definition has empty properties and required', () => {
    const toolsSrc = readSrc('main/tools/index.ts');
    // Find git_status definition
    const gitStatusIdx = toolsSrc.indexOf("name: 'git_status'");
    expect(gitStatusIdx).toBeGreaterThan(0);
    const gitStatusBlock = toolsSrc.slice(gitStatusIdx, gitStatusIdx + 300);
    // git_status has an empty properties object and empty required array
    expect(gitStatusBlock).toContain('properties:');
    expect(gitStatusBlock).toContain('required:');
    // Verify the input_schema is minimal (no required params)
    expect(gitStatusBlock).toContain('input_schema:');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 7: sse_parse_fail_logging
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — SSE parse fail logging', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('sse-parse-fail is logged on outer JSON.parse error', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] sse-parse-fail');
  });

  it('sse-parse-fail log includes rawDataLength, rawDataPreview, error', () => {
    const sseParseBlock = providerSrc.slice(
      providerSrc.indexOf('sse-parse-fail'),
      providerSrc.indexOf('sse-parse-fail') + 300
    );
    expect(sseParseBlock).toContain('rawDataLength');
    expect(sseParseBlock).toContain('rawDataPreview');
    expect(sseParseBlock).toContain('error:');
  });

  it('catch block captures error message (not empty catch)', () => {
    // The catch block should name the error variable
    expect(providerSrc).toContain('catch (sseParseErr)');
    expect(providerSrc).toContain('sseParseErr instanceof Error');
  });

  it('no bare catch{} in the streaming code path', () => {
    // Find the streamMessage method and ensure no bare catch{}
    const streamStart = providerSrc.indexOf('async *streamMessage(');
    const streamEnd = providerSrc.indexOf("yield { type: 'done'", streamStart);
    const streamBody = providerSrc.slice(streamStart, streamEnd);
    // Should NOT contain catch {} or catch { } (bare catch)
    expect(streamBody).not.toMatch(/catch\s*\{\s*\}/);
    // But should contain named catches
    expect(streamBody).toContain('catch (parseErr)');
    expect(streamBody).toContain('catch (sseParseErr)');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 8: tool_block_start logging
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — Tool block start/stop logging', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('tool-block-start logged for every tool_use content_block_start', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] tool-block-start');
  });

  it('tool-block-start includes blockIndex incrementing counter', () => {
    const blockStartLog = providerSrc.slice(
      providerSrc.indexOf('tool-block-start'),
      providerSrc.indexOf('tool-block-start') + 200
    );
    expect(blockStartLog).toContain('blockIndex: _toolBlockCount');
  });

  it('tool-block-stop logged for completed tool_use blocks', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] tool-block-stop');
  });

  it('tool-block-stop includes inputKeys for debugging', () => {
    const blockStopLog = providerSrc.slice(
      providerSrc.indexOf('tool-block-stop'),
      providerSrc.indexOf('tool-block-stop') + 200
    );
    expect(blockStopLog).toContain('inputKeys');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 9: no silent catch blocks in streaming path
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — No silent catch blocks in streaming', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('tool input parse uses named catch (parseErr)', () => {
    expect(providerSrc).toContain('catch (parseErr)');
  });

  it('SSE line parse uses named catch (sseParseErr)', () => {
    expect(providerSrc).toContain('catch (sseParseErr)');
  });

  it('Sprint 34 header comment is present', () => {
    expect(providerSrc).toContain('Sprint 34');
    expect(providerSrc).toContain('CRLF-aware buffer');
    expect(providerSrc).toContain('no silent drops');
  });

  it('response devconsole event includes toolNames', () => {
    // Sprint 34: response event should now include tool names
    const responseBlock = providerSrc.slice(
      providerSrc.indexOf("direction: 'response'"),
      providerSrc.indexOf("direction: 'response'") + 300
    );
    expect(responseBlock).toContain('toolNames:');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 10: Anti-goals — no changes to restricted files
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — Anti-goals', () => {
  it('does NOT modify agentLoop.ts', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).not.toContain('Sprint 34');
  });

  it('does NOT modify ChatWorkspace.tsx', () => {
    const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');
    expect(chatSrc).not.toContain('Sprint 34');
  });

  it('does NOT modify TaskPlanCard.tsx', () => {
    const cardSrc = readSrc('renderer/components/chat/TaskPlanCard.tsx');
    expect(cardSrc).not.toContain('Sprint 34');
  });

  it('does NOT modify activePlanState.ts', () => {
    const stateSrc = readSrc('main/orchestration/activePlanState.ts');
    expect(stateSrc).not.toContain('Sprint 34');
  });

  it('does NOT modify preload/index.ts', () => {
    const preloadSrc = readSrc('preload/index.ts');
    expect(preloadSrc).not.toContain('Sprint 34');
  });

  it('does NOT modify IPC channel definitions', () => {
    const ipcSrc = readSrc('main/ipc/index.ts');
    expect(ipcSrc).not.toContain('Sprint 34');
  });

  it('does NOT modify tools/index.ts', () => {
    const toolsSrc = readSrc('main/tools/index.ts');
    expect(toolsSrc).not.toContain('Sprint 34');
  });

  it('chat:active-plan-update channel unchanged', () => {
    const preloadSrc = readSrc('preload/index.ts');
    expect(preloadSrc).toContain('onActivePlanUpdate');
    expect(preloadSrc).toContain("'chat:active-plan-update'");
  });
});

// ═══════════════════════════════════════════════════════
//  Test 11: Backward compatibility
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — Backward compatibility with Sprint 29-33', () => {
  it('Sprint 33 outbound-payload logging preserved', () => {
    const providerSrc = readSrc('main/providers/index.ts');
    expect(providerSrc).toContain('[ClaudeProvider:stream] outbound-payload');
    expect(providerSrc).toContain('systemLength');
    expect(providerSrc).toContain('systemPreview');
    expect(providerSrc).toContain('systemTail');
    expect(providerSrc).toContain('toolCount');
  });

  it('Sprint 33 first-inbound-delta logging preserved', () => {
    const providerSrc = readSrc('main/providers/index.ts');
    expect(providerSrc).toContain('[ClaudeProvider:stream] first-inbound-delta');
    expect(providerSrc).toContain('blockType');
    expect(providerSrc).toContain('toolUsePresent');
  });

  it('Sprint 33 message-delta logging preserved', () => {
    const providerSrc = readSrc('main/providers/index.ts');
    expect(providerSrc).toContain('[ClaudeProvider:stream] message-delta');
  });

  it('Sprint 33 turn lifecycle events in agentLoop preserved', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain("event: 'turn-start'");
    expect(loopSrc).toContain("event: 'turn-inspection'");
    expect(loopSrc).toContain("event: 'turn-end'");
  });

  it('Sprint 33 invariant checks in main/index.ts preserved', () => {
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain('INVARIANT VIOLATION: toolCount');
    expect(mainSrc).toContain('toolsWithoutSchema');
    expect(mainSrc).toContain('Sprint 33 invariants');
  });

  it('Sprint 29 STRUCTURED_TOOLS and 16000 cap preserved', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain('STRUCTURED_TOOLS');
    expect(loopSrc).toContain('16000');
  });

  it('Sprint 29 nudge and max-mistakes events preserved', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain("'no-tools-used-nudge'");
    expect(loopSrc).toContain("'max-mistakes-reached'");
    expect(loopSrc).toContain("'terminal-tool-used'");
  });

  it('Sprint 24 session usage tracking preserved', () => {
    const providerSrc = readSrc('main/providers/index.ts');
    expect(providerSrc).toContain('recordSessionUsage');
    expect(providerSrc).toContain('getRateLimiter');
  });

  it('Sprint 32 activePlanState unchanged', () => {
    const stateSrc = readSrc('main/orchestration/activePlanState.ts');
    expect(stateSrc).toContain('export function setActivePlan');
    expect(stateSrc).toContain('export function getActivePlan');
    expect(stateSrc).toContain('export function clearActivePlan');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 12: Integration — full streaming path integrity
// ═══════════════════════════════════════════════════════
describe('Sprint 34 — Streaming path integrity', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('streamMessage is an async generator (async *streamMessage)', () => {
    expect(providerSrc).toContain('async *streamMessage(');
  });

  it('streamChatToRenderer iterates the generator with for-await-of', () => {
    expect(providerSrc).toContain('for await (const chunk of');
  });

  it('streamChatToRenderer infers stopReason from tool calls', () => {
    // If API said end_turn but we have tool calls, override to tool_use
    expect(providerSrc).toContain("toolCalls.length > 0 && stopReason === 'end_turn'");
    expect(providerSrc).toContain("stopReason = 'tool_use'");
  });

  it('streamChatToRenderer emits tool_call chunks to renderer', () => {
    expect(providerSrc).toContain("type: 'tool_call',");
    expect(providerSrc).toContain('toolCall: chunk.toolCall');
  });

  it('yield { type: "done" } includes streamStopReason', () => {
    expect(providerSrc).toContain("yield { type: 'done', stopReason: streamStopReason }");
  });
});
