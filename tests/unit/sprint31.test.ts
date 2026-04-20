/**
 * Sprint 31 Regression Tests
 *
 * Tests cover:
 *   1. task_plan_not_truncated — IPC payload uses 16 KB limit for structured tools
 *   2. task_plan_update_event_emitted — main process emits task_plan_update chunk
 *   3. task_plan_card_consolidation — ChatWorkspace consolidates duplicate task_plan cards
 *   4. task_plan_body_parses_envelope — TaskPlanBody parses JSON result without "No plan data"
 *   5. non_structured_tools_still_2kb — non-structured tools still use 2 KB limit
 *   6. devconsole_tool_result_metadata — DevConsole emitter includes resultLength/truncated/maxAllowed
 *   7. friendly_empty_state — TaskPlanBody shows "Waiting for plan data..." instead of "No plan data"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════
//  Test 1: task_plan_not_truncated
// ═══════════════════════════════════════════════════════
describe('Sprint 31 — Bug #1: Length-aware truncation', () => {
  const mainSrc = readSrc('main/index.ts');

  it('defines STRUCTURED_TOOL_NAMES with task_plan', () => {
    expect(mainSrc).toContain('STRUCTURED_TOOL_NAMES');
    expect(mainSrc).toContain("'task_plan'");
  });

  it('uses 16000 chars for structured tools', () => {
    // MCP-429-05 (Slice 2) replaced the inline
    //   maxResultLen = STRUCTURED_TOOL_NAMES.has(tc.name) ? 16000 : 2000
    // ternary with a branch: structured tools still take a 16000-char
    // substring cap, non-structured tools now flow through
    // ToolResultBudget.processToolResult for proper token-aware
    // truncation. The 16000 upper bound for structured tools is the
    // preserved invariant.
    expect(mainSrc).toContain('16000');
    expect(mainSrc).toMatch(/STRUCTURED_TOOL_NAMES\.has\(tc\.name\)/);
    expect(mainSrc).toMatch(/substring\(0,\s*16000\)/);
  });

  it('task_plan is in STRUCTURED_TOOL_NAMES set', () => {
    const structuredBlock = mainSrc.match(/STRUCTURED_TOOL_NAMES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(structuredBlock).not.toBeNull();
    expect(structuredBlock![1]).toContain("'task_plan'");
  });

  it('attempt_completion is in STRUCTURED_TOOL_NAMES set', () => {
    const structuredBlock = mainSrc.match(/STRUCTURED_TOOL_NAMES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(structuredBlock).not.toBeNull();
    expect(structuredBlock![1]).toContain("'attempt_completion'");
  });

  it('ask_followup_question is in STRUCTURED_TOOL_NAMES set', () => {
    const structuredBlock = mainSrc.match(/STRUCTURED_TOOL_NAMES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(structuredBlock).not.toBeNull();
    expect(structuredBlock![1]).toContain("'ask_followup_question'");
  });

  it('no longer hard-codes substring(0, 2000) for all tool results', () => {
    // The old pattern: result: toolResultContent.substring(0, 2000)
    // Should now use truncatedResult variable instead
    expect(mainSrc).toContain('result: truncatedResult');
    // The old 2000 truncation should NOT appear in the chat:stream-chunk emission
    const streamChunkLines = mainSrc.split('\n').filter(l =>
      l.includes('chat:stream-chunk') || l.includes('toolResultContent.substring(0, 2000)')
    );
    const has2kTruncation = streamChunkLines.some(l => l.includes('toolResultContent.substring(0, 2000)'));
    expect(has2kTruncation).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
//  Test 2: task_plan_update_event_emitted (Sprint 32 superseded: now uses chat:active-plan-update)
// ═══════════════════════════════════════════════════════
describe('Sprint 31 → Sprint 32 — Bug #2: task_plan plan emission via dedicated IPC', () => {
  const mainSrc = readSrc('main/index.ts');

  it('emits plan via chat:active-plan-update channel (Sprint 32 upgrade)', () => {
    // Sprint 32 replaced task_plan_update stream-chunk with dedicated IPC channel
    expect(mainSrc).toContain("'chat:active-plan-update'");
    expect(mainSrc).toContain('plan: planData');
  });

  it('parses task_plan result and extracts plan data before emitting', () => {
    expect(mainSrc).toContain("tc.name === 'task_plan'");
    expect(mainSrc).toContain('planData.tasks');
  });

  it('strips [Tool Result: ...] prefix when parsing task_plan', () => {
    expect(mainSrc).toContain('[Tool Result:');
    expect(mainSrc).toContain('.replace(');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 3: task_plan card consolidation (Sprint 32 superseded: plan is now top-level state)
// ═══════════════════════════════════════════════════════
describe('Sprint 31 → Sprint 32 — Bug #3: task_plan card is lightweight, plan is top-level', () => {
  const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');

  it('task_plan tool results update status only (not card.result) in Sprint 32', () => {
    // Sprint 32: task_plan cards are lightweight status indicators;
    // plan data flows via activePlan state, not tool card result field.
    expect(chatSrc).toContain("existing.name === 'task_plan'");
  });

  it('plan state lives in activePlan, not in streamingToolCalls', () => {
    // Sprint 32: top-level activePlan state (Cline pattern)
    expect(chatSrc).toContain('activePlan');
    expect(chatSrc).toContain('setActivePlanState');
  });

  it('TaskPlanCard renders outside the streaming tool call loop', () => {
    const planCardIdx = chatSrc.indexOf('<TaskPlanCard');
    const streamingMapIdx = chatSrc.indexOf('streamingToolCalls.map');
    expect(planCardIdx).toBeGreaterThan(0);
    expect(streamingMapIdx).toBeGreaterThan(0);
    expect(planCardIdx).toBeLessThan(streamingMapIdx);
  });
});

// ═══════════════════════════════════════════════════════
//  Test 4: TaskPlanBody is lightweight (Sprint 32 superseded Sprint 31 full rendering)
// ═══════════════════════════════════════════════════════
describe('Sprint 31 → Sprint 32 — TaskPlanBody is lightweight', () => {
  const cardSrc = readSrc('renderer/components/chat/ToolCallCard.tsx');

  it('does NOT show "No plan data" — Sprint 32 removed full plan rendering', () => {
    expect(cardSrc).not.toContain("'No plan data'");
    expect(cardSrc).not.toContain('"No plan data"');
  });

  it('does NOT show "Waiting for plan data..." — plan renders in sticky TaskPlanCard', () => {
    // Sprint 32: TaskPlanBody is a one-line status, not a full plan renderer
    expect(cardSrc).not.toContain('Waiting for plan data');
  });

  it('TaskPlanBody shows action and "plan visible above" message', () => {
    expect(cardSrc).toContain("input?.action || 'update'");
    expect(cardSrc).toContain('plan visible above');
  });

  it('ToolCallCard is memoized with deepEqual', () => {
    expect(cardSrc).toContain('memo(ToolCallCardInner, deepEqual)');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 5: non_structured_tools_still_2kb
// ═══════════════════════════════════════════════════════
describe('Sprint 31 — Non-structured tools still use 2 KB', () => {
  const mainSrc = readSrc('main/index.ts');

  it('non-structured tools flow through ToolResultBudget (replacing the old 2000-char hard cap)', () => {
    // MCP-429-05 (Slice 2): the old inline "2000 chars for non-structured"
    // fallback was replaced with a ToolResultBudget.processToolResult call
    // that applies proper token-aware truncation AND retains the full
    // result in the trb ring buffer. The upper-bound 16000 char cap for
    // STRUCTURED tools is preserved separately.
    expect(mainSrc).toMatch(/getToolResultBudget\(\)\s*\.\s*processToolResult\s*\(/);
    expect(mainSrc).toMatch(/trbEntry\.truncatedResult/);
  });

  it('read_file is NOT in STRUCTURED_TOOL_NAMES', () => {
    const structuredBlock = mainSrc.match(/STRUCTURED_TOOL_NAMES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(structuredBlock).not.toBeNull();
    expect(structuredBlock![1]).not.toContain("'read_file'");
  });

  it('write_file is NOT in STRUCTURED_TOOL_NAMES', () => {
    const structuredBlock = mainSrc.match(/STRUCTURED_TOOL_NAMES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(structuredBlock![1]).not.toContain("'write_file'");
  });

  it('bash_command is NOT in STRUCTURED_TOOL_NAMES', () => {
    const structuredBlock = mainSrc.match(/STRUCTURED_TOOL_NAMES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(structuredBlock![1]).not.toContain("'bash_command'");
  });
});

// ═══════════════════════════════════════════════════════
//  Test 6: DevConsole tool-result metadata
// ═══════════════════════════════════════════════════════
describe('Sprint 31 — DevConsole api-traffic tool-result metadata', () => {
  const mainSrc = readSrc('main/index.ts');

  it('emits devconsole:api-traffic with direction tool-result', () => {
    expect(mainSrc).toContain("direction: 'tool-result'");
  });

  it('includes resultLength field', () => {
    expect(mainSrc).toContain('resultLength: toolResultContent.length');
  });

  it('includes truncated boolean field', () => {
    expect(mainSrc).toContain('truncated: wasTruncated');
  });

  it('DevConsole tool-result event includes budget-aware truncation metadata', () => {
    // MCP-429-05 (Slice 2): the old `maxAllowed: maxResultLen` field was
    // replaced with per-result `fullTokens` / `truncatedTokens` /
    // `truncatedLength` / `retentionId` fields sourced from
    // ToolResultBudget. These give the DevConsole far more useful
    // telemetry: actual token counts (not just char counts) and a
    // retention ID so the UI can offer "include full in next prompt".
    expect(mainSrc).toMatch(/truncatedLength:\s*truncatedResult\.length/);
    expect(mainSrc).toMatch(/fullTokens:\s*trbEntry\.fullTokens/);
    expect(mainSrc).toMatch(/truncatedTokens:\s*trbEntry\.truncatedTokens/);
    expect(mainSrc).toMatch(/retentionId:\s*trbEntry\.id/);
  });
});

// ═══════════════════════════════════════════════════════
//  Test 7: Anti-goals verification
// ═══════════════════════════════════════════════════════
describe('Sprint 31 — Anti-goals', () => {
  it('does not modify agentLoop.ts STRUCTURED_TOOLS cap', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    // Original STRUCTURED_TOOLS pattern should still be present
    expect(loopSrc).toContain('STRUCTURED_TOOLS');
    expect(loopSrc).toContain('16000');
  });

  it('does not modify formatResponse.ts', () => {
    const formatSrc = readSrc('main/orchestration/formatResponse.ts');
    // Should still contain its original COMPLETION_PATTERNS
    expect(formatSrc).toContain('COMPLETION_PATTERNS');
  });

  it('does not modify taskPlan.ts tool definition', () => {
    const taskPlanSrc = readSrc('main/tools/taskPlan.ts');
    // taskPlan.ts exports executeTaskPlan — the tool name is registered in tools/index.ts
    expect(taskPlanSrc).toContain('executeTaskPlan');
    // Verify it still has the original Sprint 16 header
    expect(taskPlanSrc).toContain('task_plan');
  });

  it('DEFAULT_TIER remains unchanged at 2', () => {
    const tierSrc = readSrc('main/orchestration/tierPresets.ts');
    expect(tierSrc).toMatch(/DEFAULT_TIER\s*[:=]\s*2/);
  });
});
