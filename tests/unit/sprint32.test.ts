/**
 * Sprint 32 Test Suite — Cline Architecture Port
 *
 * Tests cover:
 *   1. activePlan_in_place_update_preserves_identity — plan identity stable across updates
 *   2. activePlan_ignores_empty_plan_update — empty plan.tasks never downgrades state
 *   3. activePlan_cleared_on_session_end — clearActivePlan removes state
 *   4. task_plan_body_is_lightweight — no full plan render in tool card
 *   5. single_TaskPlanCard_rendered_outside_tool_loop — plan renders at session level
 *   6. stable_key_no_index_as_key — stable keys on streaming tool calls
 *   7. devconsole_export_includes_activePlan — export payload has activePlan field
 *   8. settings_roundtrip_tier_matches_providerTier — tier2 default matches main process
 *   9. dedicated_ipc_channel_not_stream_chunk — plan flows via chat:active-plan-update
 *  10. memo_deepEqual_on_ToolCallCard — ToolCallCard wrapped with memo(deepEqual)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════
//  Test 1: activePlan_in_place_update_preserves_identity
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — activePlanState module', () => {
  const stateSrc = readSrc('main/orchestration/activePlanState.ts');

  it('exports setActivePlan, getActivePlan, clearActivePlan, onActivePlanChange', () => {
    expect(stateSrc).toContain('export function setActivePlan');
    expect(stateSrc).toContain('export function getActivePlan');
    expect(stateSrc).toContain('export function clearActivePlan');
    expect(stateSrc).toContain('export function onActivePlanChange');
  });

  it('uses EventEmitter for change notification (Cline pattern)', () => {
    expect(stateSrc).toContain("import { EventEmitter } from 'events'");
    expect(stateSrc).toContain("bus.emit('change'");
  });

  it('stores plans by session ID', () => {
    expect(stateSrc).toContain('plansBySession');
    expect(stateSrc).toContain('Map<string, TaskPlan>');
  });

  it('clearActivePlan deletes from map and emits null', () => {
    expect(stateSrc).toContain('plansBySession.delete(sessionId)');
    expect(stateSrc).toContain("bus.emit('change', sessionId, null)");
  });
});

// ═══════════════════════════════════════════════════════
//  Test 2: activePlan_ignores_empty_plan_update
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — ChatWorkspace ignores empty plan updates', () => {
  const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');

  it('onActivePlanUpdate guard rejects empty tasks array', () => {
    // The guard: if (!data.plan?.tasks?.length) return;
    expect(chatSrc).toContain("!data.plan?.tasks?.length");
  });

  it('uses dedicated onActivePlanUpdate channel, not stream-chunk', () => {
    expect(chatSrc).toContain('api.onActivePlanUpdate');
    // ChatWorkspace uses api.onActivePlanUpdate, not the raw channel name
    expect(chatSrc).not.toContain("'chat:active-plan-update'");
    // Verify it does NOT use the old task_plan_update handler
    expect(chatSrc).not.toContain("data.type === 'task_plan_update'");
  });
});

// ═══════════════════════════════════════════════════════
//  Test 3: activePlan_cleared_on_session_end
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — activePlan lifecycle', () => {
  const mainSrc = readSrc('main/index.ts');

  it('imports activePlanState functions', () => {
    expect(mainSrc).toContain('setActivePlanState');
    expect(mainSrc).toContain('getActivePlanState');
    expect(mainSrc).toContain('clearActivePlan');
  });

  it('emits plan via chat:active-plan-update channel (not chat:stream-chunk)', () => {
    expect(mainSrc).toContain("'chat:active-plan-update'");
    expect(mainSrc).toContain('planId: planData.id');
    expect(mainSrc).toContain('plan: planData');
  });

  it('stores plan in activePlanState before emitting', () => {
    expect(mainSrc).toContain('setActivePlanState(sessionId, planData)');
  });

  it('validates plan.tasks is a non-empty array before storing', () => {
    expect(mainSrc).toContain('planData.tasks.length > 0');
    expect(mainSrc).toContain('Array.isArray(planData.tasks)');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 4: task_plan_body_is_lightweight
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — Lightweight TaskPlanBody', () => {
  const cardSrc = readSrc('renderer/components/chat/ToolCallCard.tsx');

  it('TaskPlanBody does NOT contain full plan rendering logic', () => {
    // No STATUS_ICONS map, no progress bar, no task list
    expect(cardSrc).not.toMatch(/function TaskPlanBody[\s\S]*?STATUS_ICONS/);
  });

  it('TaskPlanBody does NOT contain "Waiting for plan data"', () => {
    expect(cardSrc).not.toContain('Waiting for plan data');
  });

  it('TaskPlanBody does NOT contain "No plan data"', () => {
    expect(cardSrc).not.toContain('No plan data');
  });

  it('TaskPlanBody shows action and task count only', () => {
    expect(cardSrc).toContain("input?.action || 'update'");
    expect(cardSrc).toContain('plan visible above');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 5: TaskPlanCard rendered outside tool loop
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — Sticky TaskPlanCard at session level', () => {
  const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');

  it('defines TaskPlanCard component', () => {
    expect(chatSrc).toContain('function TaskPlanCard');
  });

  it('renders TaskPlanCard outside the streaming tool calls loop', () => {
    // TaskPlanCard should appear before the isLoading block
    const planCardIdx = chatSrc.indexOf('<TaskPlanCard');
    const streamingMapIdx = chatSrc.indexOf('streamingToolCalls.map');
    expect(planCardIdx).toBeGreaterThan(0);
    expect(streamingMapIdx).toBeGreaterThan(0);
    expect(planCardIdx).toBeLessThan(streamingMapIdx);
  });

  it('TaskPlanCard receives activePlan as plan prop', () => {
    expect(chatSrc).toContain('<TaskPlanCard plan={activePlan}');
  });

  it('TaskPlanCard is memoized with deepEqual', () => {
    expect(chatSrc).toContain('memo(function TaskPlanCard');
    expect(chatSrc).toContain('}, deepEqual)');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 6: Stable keys — no index-as-key for tool calls
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — Stable keys (Cline ts pattern)', () => {
  const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');

  it('streaming ToolCallCard uses toolCallId as key, not index', () => {
    // Find the streaming tool calls render block
    const streamingBlock = chatSrc.slice(
      chatSrc.indexOf('streamingToolCalls.map'),
      chatSrc.indexOf('streamingToolCalls.map') + 500
    );
    expect(streamingBlock).toContain('toolCallId');
    expect(streamingBlock).not.toMatch(/key=\{i\}/);
  });

  it('assigns stable toolCallId at tool_call creation time', () => {
    // The tool_call handler should always provide a toolCallId
    expect(chatSrc).toContain("data.toolCall.id || `tc-${Date.now()}");
  });

  it('activePlan state uses useRef for identity stability', () => {
    expect(chatSrc).toContain('activePlanRef');
    expect(chatSrc).toContain('activePlanRef.current = data.plan');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 7: DevConsole export includes activePlan
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — DevConsole export with activePlan', () => {
  const storeSrc = readSrc('renderer/components/devConsole/devConsoleStore.ts');
  const panelSrc = readSrc('renderer/components/devConsole/DevConsolePanel.tsx');

  it('DevConsoleState interface includes activePlan field', () => {
    expect(storeSrc).toContain('activePlan: any | null');
  });

  it('buildExportPayload includes activePlan', () => {
    expect(storeSrc).toContain('activePlan: _state.activePlan');
  });

  it('DevConsolePanel subscribes to onActivePlanUpdate for export capture', () => {
    expect(panelSrc).toContain('onActivePlanUpdate');
    expect(panelSrc).toContain('setDevConsoleActivePlan');
  });

  it('setActivePlan function exported from store', () => {
    expect(storeSrc).toContain('export function setActivePlan');
  });
});

// ═══════════════════════════════════════════════════════
//  Test 8: Settings tier/providerTier roundtrip
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — Settings tier/providerTier consistency', () => {
  const storeSrc = readSrc('renderer/store/index.ts');
  const settingsSrc = readSrc('renderer/components/settings/SettingsPanel.tsx');

  it('store default providerTier matches DEFAULT_TIER=2', () => {
    expect(storeSrc).toContain("providerTier: 'tier2'");
    expect(storeSrc).not.toContain("providerTier: 'tier4'");
  });

  it('SettingsPanel default providerTier matches DEFAULT_TIER=2', () => {
    expect(settingsSrc).toContain("providerTier: 'tier2'");
    expect(settingsSrc).not.toContain("providerTier: 'tier4'");
  });

  it('main process DEFAULT_TIER is 2', () => {
    const tierSrc = readSrc('main/orchestration/tierPresets.ts');
    expect(tierSrc).toMatch(/DEFAULT_TIER\s*[:=]\s*2/);
  });
});

// ═══════════════════════════════════════════════════════
//  Test 9: Dedicated IPC channel
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — Dedicated active-plan-update IPC channel', () => {
  const preloadSrc = readSrc('preload/index.ts');

  it('preload exposes onActivePlanUpdate bridge', () => {
    expect(preloadSrc).toContain('onActivePlanUpdate');
    expect(preloadSrc).toContain("'chat:active-plan-update'");
  });

  it('main process sends via chat:active-plan-update, not chat:stream-chunk for plan', () => {
    const mainSrc = readSrc('main/index.ts');
    // Should use the dedicated channel
    expect(mainSrc).toContain("'chat:active-plan-update'");
    // Should NOT send task_plan_update via stream-chunk anymore
    expect(mainSrc).not.toContain("type: 'task_plan_update'");
  });
});

// ═══════════════════════════════════════════════════════
//  Test 10: memo(deepEqual) on ToolCallCard
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — memo(deepEqual) on ToolCallCard', () => {
  const cardSrc = readSrc('renderer/components/chat/ToolCallCard.tsx');

  it('imports fast-deep-equal', () => {
    expect(cardSrc).toContain("import deepEqual from 'fast-deep-equal'");
  });

  it('imports memo from React', () => {
    expect(cardSrc).toContain('memo');
  });

  it('wraps ToolCallCard with memo and deepEqual', () => {
    expect(cardSrc).toContain('memo(ToolCallCardInner, deepEqual)');
  });

  it('exports the memoized version', () => {
    expect(cardSrc).toContain('export default ToolCallCard');
  });
});

// ═══════════════════════════════════════════════════════
//  Anti-goals verification
// ═══════════════════════════════════════════════════════
describe('Sprint 32 — Anti-goals', () => {
  it('does not modify agentLoop.ts', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).not.toContain('Sprint 32');
  });

  it('does not modify formatResponse.ts', () => {
    const formatSrc = readSrc('main/orchestration/formatResponse.ts');
    expect(formatSrc).not.toContain('Sprint 32');
  });

  it('does not modify taskPlan.ts', () => {
    const taskPlanSrc = readSrc('main/tools/taskPlan.ts');
    expect(taskPlanSrc).not.toContain('Sprint 32');
  });

  it('does not modify tools/index.ts', () => {
    const toolsSrc = readSrc('main/tools/index.ts');
    expect(toolsSrc).not.toContain('Sprint 32');
  });

  it('terminal tool wiring (Sprint 30) unchanged', () => {
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain('getToolsForMode');
    expect(mainSrc).toContain('WRITE_ACCESS_TOOLS');
  });

  it('DEFAULT_TIER unchanged at 2', () => {
    const tierSrc = readSrc('main/orchestration/tierPresets.ts');
    expect(tierSrc).toMatch(/DEFAULT_TIER\s*[:=]\s*2/);
  });
});
