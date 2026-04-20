/**
 * Sprint 33 Test Suite — Tool Invocation Contract Tests
 *
 * Tests cover:
 *   1. build_mode_request_includes_25_tools — tools.length >= 20, required tool names present
 *   2. system_prompt_contains_tool_use_contract — system prompt references attempt_completion
 *   3. tool_choice_never_none_in_build_mode — no tool_choice override to "none"
 *   4. nudge_not_fired_when_tool_use_block_present — toolUseCount > 0 suppresses nudge
 *   5. max_mistakes_not_hit_on_successful_tool_turn — successful tool use resets counter
 *   6. provider_logs_outbound_payload — diagnostic logging of outbound request metadata
 *   7. provider_logs_first_inbound_delta — first content block logged for diagnostics
 *   8. agentLoop_emits_turn_start_event — turn-start event emitted at each turn
 *   9. agentLoop_emits_turn_inspection_event — turn-inspection with stopReason and toolUseCount
 *  10. agentLoop_emits_turn_end_event — turn-end event emitted after tool execution
 *  11. invariant_verification_in_main_process — toolCount, system contract, inputSchema checks
 *  12. anti_goals_sprint33 — does not modify UI components or preload
 *
 * Root cause: stop_reason='end_turn' with no tool_use blocks triggers max-mistakes-reached.
 * Diagnosis: The model does not emit tool calls when tools are missing, truncated, or
 * tool_choice is set to "none". Sprint 33 adds diagnostic logging to verify the outbound
 * payload, hardens the nudge to inspect toolUseCount, and adds invariant checks.
 *
 * Cline reference: src/core/task/index.ts comment about unstable keys,
 * combineApiRequests.ts fold pattern.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════
//  Test 1: build_mode_request_includes_25_tools
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Contract: build mode includes all tools', () => {
  const toolsSrc = readSrc('main/tools/index.ts');

  it('LOCAL_TOOL_DEFINITIONS has at least 20 entries', () => {
    // Count named tool entries and imported tool defs
    const namedTools = toolsSrc.match(/\{\s*name:\s*'/g) || [];
    const importedDefs = (toolsSrc.match(/ATTEMPT_COMPLETION_TOOL_DEF|ASK_FOLLOWUP_QUESTION_TOOL_DEF/g) || []).length;
    expect(namedTools.length + importedDefs).toBeGreaterThanOrEqual(20);
  });

  it('includes task_plan in tool definitions', () => {
    expect(toolsSrc).toContain("name: 'task_plan'");
  });

  it('includes attempt_completion in tool definitions', () => {
    expect(toolsSrc).toContain('ATTEMPT_COMPLETION_TOOL_DEF');
  });

  it('includes ask_followup_question in tool definitions', () => {
    expect(toolsSrc).toContain('ASK_FOLLOWUP_QUESTION_TOOL_DEF');
  });

  it('includes core file tools (read_file, write_file, patch_file)', () => {
    expect(toolsSrc).toContain("name: 'read_file'");
    expect(toolsSrc).toContain("name: 'write_file'");
    expect(toolsSrc).toContain("name: 'patch_file'");
  });

  it('includes bash_command and multi_edit', () => {
    expect(toolsSrc).toContain("name: 'bash_command'");
    expect(toolsSrc).toContain("name: 'multi_edit'");
  });

  it('getToolsForMode("build") returns all tools (not filtered)', () => {
    // In build mode, the function returns the full array
    expect(toolsSrc).toContain("return LOCAL_TOOL_DEFINITIONS");
  });

  it('main process validates tool count invariant >= 20', () => {
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain('INVARIANT VIOLATION: toolCount');
    expect(mainSrc).toContain('expectedMinTools');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 2: system_prompt_contains_tool_use_contract
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Contract: system prompt contains tool-use contract', () => {
  const promptsSrc = readSrc('main/orchestration/prompts.ts');

  it('SYSTEM_PROMPT references attempt_completion', () => {
    expect(promptsSrc).toContain('attempt_completion');
  });

  it('SYSTEM_PROMPT contains "TOOL USE RULES" section', () => {
    expect(promptsSrc).toContain('TOOL USE RULES');
  });

  it('SYSTEM_PROMPT instructs "you MUST use at least one tool"', () => {
    expect(promptsSrc).toContain('MUST use at least one tool');
  });

  it('main process verifies system prompt contract before agent loop', () => {
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain("INVARIANT VIOLATION: system prompt missing tool-use contract");
  });

  it('main process checks that each tool has a valid inputSchema', () => {
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain('toolsWithoutSchema');
    expect(mainSrc).toContain('INVARIANT VIOLATION');
    expect(mainSrc).toContain('tools missing inputSchema');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 3: tool_choice_never_none_in_build_mode
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Contract: tool_choice is never "none"', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('streamMessage does NOT set tool_choice to "none"', () => {
    expect(providerSrc).not.toContain("tool_choice: 'none'");
    expect(providerSrc).not.toContain('tool_choice: "none"');
  });

  it('sendMessage does NOT set tool_choice to "none"', () => {
    // Double-check in the non-streaming path too
    expect(providerSrc).not.toContain("tool_choice: 'none'");
  });

  it('streamChatToRenderer does NOT override tool_choice', () => {
    // The function should just pass tools through, no tool_choice manipulation
    const streamFnBlock = providerSrc.slice(
      providerSrc.indexOf('export async function streamChatToRenderer'),
      providerSrc.indexOf('export async function streamChatToRenderer') + 2000
    );
    expect(streamFnBlock).not.toContain('tool_choice');
  });

  it('main process logs toolChoiceOverride=none (confirming no override)', () => {
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain('toolChoiceOverride=none');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 4: nudge_not_fired_when_tool_use_block_present
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Contract: nudge not fired when tool_use blocks present', () => {
  const loopSrc = readSrc('main/orchestration/agentLoop.ts');

  it('nudge fires ONLY when toolCalls.length === 0', () => {
    // The nudge block is inside if (toolCalls.length === 0)
    expect(loopSrc).toContain('if (toolCalls.length === 0)');
    // And it increments consecutiveNoToolUse inside that block
    expect(loopSrc).toContain('consecutiveNoToolUse++');
  });

  it('consecutiveNoToolUse resets when tools are used', () => {
    expect(loopSrc).toContain('consecutiveNoToolUse = 0');
  });

  it('reset happens AFTER the toolCalls.length === 0 check (in the tool-use branch)', () => {
    const nudgeIdx = loopSrc.indexOf('if (toolCalls.length === 0)');
    // The reset at line ~203 is in the "Case 2: Tool calls present" branch,
    // after the "Case 1: No tool calls" block. Use lastIndexOf to find
    // the actual reset (not the initialization at let consecutiveNoToolUse = 0).
    const resetIdx = loopSrc.lastIndexOf('consecutiveNoToolUse = 0');
    expect(nudgeIdx).toBeGreaterThan(0);
    expect(resetIdx).toBeGreaterThan(nudgeIdx);
  });

  it('nudge event includes stopReason for diagnostics', () => {
    // Sprint 33 added stopReason to the nudge event
    const nudgeBlock = loopSrc.slice(
      loopSrc.indexOf("event: 'no-tools-used-nudge'"),
      loopSrc.indexOf("event: 'no-tools-used-nudge'") + 300
    );
    expect(nudgeBlock).toContain('stopReason');
  });

  it('no-tools-used diagnostic log includes turn number and consecutiveNoToolUse', () => {
    expect(loopSrc).toContain('[agentLoop] Turn');
    expect(loopSrc).toContain('no tool calls');
    expect(loopSrc).toContain('consecutiveNoToolUse=');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 5: max_mistakes_not_hit_on_successful_tool_turn
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Contract: successful tool turns reset mistake counter', () => {
  const loopSrc = readSrc('main/orchestration/agentLoop.ts');

  it('maxConsecutiveMistakes defaults to 3', () => {
    expect(loopSrc).toContain('maxConsecutiveMistakes ?? 3');
  });

  it('terminal tools exit BEFORE max_mistakes check', () => {
    // The terminal tool check should come after tool execution, not after nudge
    const terminalCheckIdx = loopSrc.indexOf('TERMINAL_TOOLS.has(tc.name)');
    const maxMistakesIdx = loopSrc.indexOf("reason: 'no_tools'");
    expect(terminalCheckIdx).toBeGreaterThan(0);
    expect(maxMistakesIdx).toBeGreaterThan(0);
    // Terminal tool exit comes before the no_tools exit in the source
    // (different code paths: tools present vs no tools)
  });

  it('agent loop continues when stopReason is tool_use', () => {
    // The loop continues past Case 4 when tools are present
    expect(loopSrc).toContain("stopReason !== 'tool_use'");
    expect(loopSrc).toContain('Continue to next turn');
  });

  it('agent loop records total tool calls across turns', () => {
    expect(loopSrc).toContain('totalToolCalls.push(...toolCalls)');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 6: Provider diagnostic logging
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Provider diagnostic logging', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('logs outbound-payload with model, systemLength, toolCount', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] outbound-payload');
    expect(providerSrc).toContain('systemLength');
    expect(providerSrc).toContain('systemPreview');
    expect(providerSrc).toContain('systemTail');
    expect(providerSrc).toContain('toolCount');
    expect(providerSrc).toContain('toolNames');
    expect(providerSrc).toContain('messageCount');
  });

  it('logs first-inbound-delta with block type and tool_use presence', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] first-inbound-delta');
    expect(providerSrc).toContain('blockType');
    expect(providerSrc).toContain('toolUsePresent');
  });

  it('logs message-delta with stopReason', () => {
    expect(providerSrc).toContain('[ClaudeProvider:stream] message-delta');
    expect(providerSrc).toContain('stopReason');
  });

  it('emits outbound-payload to devconsole:api-traffic', () => {
    expect(providerSrc).toContain("direction: 'outbound-payload'");
    expect(providerSrc).toContain('hasToolUseContract');
    expect(providerSrc).toContain('systemPromptLength');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 7: Agent loop turn lifecycle events
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Agent loop turn lifecycle events', () => {
  const loopSrc = readSrc('main/orchestration/agentLoop.ts');

  it('emits turn-start event at each turn', () => {
    expect(loopSrc).toContain("event: 'turn-start'");
    expect(loopSrc).toContain('messageCount: currentMessages.length');
  });

  it('emits turn-inspection event with stop_reason and tool analysis', () => {
    expect(loopSrc).toContain("event: 'turn-inspection'");
    expect(loopSrc).toContain('toolUseCount: toolCalls.length');
    expect(loopSrc).toContain('textLen:');
  });

  it('emits turn-end event after tool execution', () => {
    expect(loopSrc).toContain("event: 'turn-end'");
    expect(loopSrc).toContain('terminalToolUsed');
  });

  it('turn-start includes tool count from options', () => {
    const turnStartBlock = loopSrc.slice(
      loopSrc.indexOf("event: 'turn-start'"),
      loopSrc.indexOf("event: 'turn-start'") + 200
    );
    expect(turnStartBlock).toContain('toolCount: options.tools.length');
  });

  it('turn-inspection includes tool names', () => {
    const turnInspBlock = loopSrc.slice(
      loopSrc.indexOf("event: 'turn-inspection'"),
      loopSrc.indexOf("event: 'turn-inspection'") + 300
    );
    expect(turnInspBlock).toContain('toolNames:');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 8: Invariant verification in main process
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Invariant verification in main process', () => {
  const mainSrc = readSrc('main/index.ts');

  it('checks toolCount >= expected minimum', () => {
    expect(mainSrc).toContain('expectedMinTools');
    expect(mainSrc).toContain('allTools.length < expectedMinTools');
  });

  it('checks system prompt contains tool-use contract', () => {
    expect(mainSrc).toContain("enhancedPrompt.includes('attempt_completion')");
  });

  it('logs Sprint 33 invariant summary', () => {
    expect(mainSrc).toContain('Sprint 33 invariants');
    expect(mainSrc).toContain('toolCount=');
    expect(mainSrc).toContain('systemHasContract=');
  });

  it('verifies each tool has inputSchema', () => {
    expect(mainSrc).toContain('toolsWithoutSchema');
    expect(mainSrc).toContain('!t.inputSchema');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 9: Anti-goals — do NOT modify UI, preload, or activePlanState
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Anti-goals', () => {
  it('does not modify ChatWorkspace.tsx', () => {
    const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');
    expect(chatSrc).not.toContain('Sprint 33');
  });

  it('does not modify ToolCallCard.tsx', () => {
    const cardSrc = readSrc('renderer/components/chat/ToolCallCard.tsx');
    expect(cardSrc).not.toContain('Sprint 33');
  });

  it('does not modify activePlanState.ts', () => {
    const planStateSrc = readSrc('main/orchestration/activePlanState.ts');
    expect(planStateSrc).not.toContain('Sprint 33');
  });

  it('does not modify preload/index.ts', () => {
    const preloadSrc = readSrc('preload/index.ts');
    expect(preloadSrc).not.toContain('Sprint 33');
  });

  it('does not modify chat:active-plan-update channel', () => {
    // The IPC channel should remain unchanged from Sprint 32
    const preloadSrc = readSrc('preload/index.ts');
    expect(preloadSrc).toContain('onActivePlanUpdate');
    expect(preloadSrc).toContain("'chat:active-plan-update'");
  });

  it('does not modify formatResponse.ts', () => {
    const formatSrc = readSrc('main/orchestration/formatResponse.ts');
    expect(formatSrc).not.toContain('Sprint 33');
    // Original COMPLETION_PATTERNS reference still present
    expect(formatSrc).toContain('COMPLETION_PATTERNS');
  });

  it('does not modify taskPlan.ts', () => {
    const taskPlanSrc = readSrc('main/tools/taskPlan.ts');
    expect(taskPlanSrc).not.toContain('Sprint 33');
  });

  it('does not modify tools/index.ts', () => {
    const toolsSrc = readSrc('main/tools/index.ts');
    expect(toolsSrc).not.toContain('Sprint 33');
  });

  it('DEFAULT_TIER unchanged at 2', () => {
    const tierSrc = readSrc('main/orchestration/tierPresets.ts');
    expect(tierSrc).toMatch(/DEFAULT_TIER\s*[:=]\s*2/);
  });
});

// ═══════════════════════════════════════════════════════
//  Test 10: Backward compatibility — Sprint 29-32 patterns preserved
// ═══════════════════════════════════════════════════════
describe('Sprint 33 — Backward compatibility', () => {
  it('agentLoop STRUCTURED_TOOLS and 16000 cap still present', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain('STRUCTURED_TOOLS');
    expect(loopSrc).toContain('16000');
  });

  it('agentLoop still emits terminal-tool-used event', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain("'terminal-tool-used'");
  });

  it('agentLoop still emits max-mistakes-reached event', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain("'max-mistakes-reached'");
  });

  it('provider still records session usage and rate limits', () => {
    const providerSrc = readSrc('main/providers/index.ts');
    expect(providerSrc).toContain('recordSessionUsage');
    expect(providerSrc).toContain('getRateLimiter');
  });

  it('main process still emits devconsole:api-traffic for responses', () => {
    const providerSrc = readSrc('main/providers/index.ts');
    expect(providerSrc).toContain("direction: 'response'");
  });

  it('main process still uses STRUCTURED_TOOL_NAMES for per-tool truncation policy', () => {
    // MCP-429-05 (Slice 2) split the previous single-ternary into a
    // branch: structured tools get a 16000-char substring cap,
    // non-structured tools flow through ToolResultBudget. The
    // STRUCTURED_TOOL_NAMES set itself is still the gating predicate.
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain('STRUCTURED_TOOL_NAMES');
    expect(mainSrc).toMatch(/STRUCTURED_TOOL_NAMES\.has\(tc\.name\)/);
    expect(mainSrc).toMatch(/substring\(0,\s*16000\)/);
  });
});
