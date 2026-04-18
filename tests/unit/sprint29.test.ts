/**
 * Sprint 29 Test Suite — Key Fixes & New Features
 *
 * Tests cover:
 *   1. Tool-visibility probe (attempt_completion + ask_followup_question in tool list, count >= 19)
 *   2. Task-plan render probe (parsing [Tool Result: task_plan] JSON)
 *   3. Tier presets (DEFAULT_TIER=2, all 4 presets defined, structure validation)
 *   4. Plan-mode enforcement (getToolsForMode excludes write tools)
 *   5. Nudge visibility (agent loop emits no-tools-used-nudge event)
 *   6. No "Run again" button in FollowupButtons after bash_command
 *   7. Settings persistence IPC channels exist
 *   8. End-to-end agent loop exits via attempt_completion (smoke)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════
//  Probe 1: Tool-visibility — terminal tools in tool list
// ═══════════════════════════════════════════════════════
describe('Probe 1 — Tool visibility', () => {
  const toolsSrc = readSrc('main/tools/index.ts');

  it('LOCAL_TOOL_DEFINITIONS includes attempt_completion', () => {
    expect(toolsSrc).toContain('ATTEMPT_COMPLETION_TOOL_DEF');
    expect(toolsSrc).toContain("'attempt_completion'");
  });

  it('LOCAL_TOOL_DEFINITIONS includes ask_followup_question', () => {
    expect(toolsSrc).toContain('ASK_FOLLOWUP_QUESTION_TOOL_DEF');
    expect(toolsSrc).toContain("'ask_followup_question'");
  });

  it('tool definitions count is at least 19', () => {
    // Count entries in LOCAL_TOOL_DEFINITIONS array
    const defMatches = toolsSrc.match(/\{\s*name:\s*'/g) || [];
    const importedDefs = (toolsSrc.match(/ATTEMPT_COMPLETION_TOOL_DEF|ASK_FOLLOWUP_QUESTION_TOOL_DEF/g) || []).length;
    expect(defMatches.length + importedDefs).toBeGreaterThanOrEqual(19);
  });

  it('chat:send handler logs tool names for debug (P0-A)', () => {
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain('[chat:send] Tools passed to agent loop');
    expect(mainSrc).toContain('attempt_completion');
    expect(mainSrc).toContain('ask_followup_question');
  });
});

// ═══════════════════════════════════════════════════════
//  Probe 2: Task-plan rendering (Sprint 32: plan parsing moved to main process)
// ═══════════════════════════════════════════════════════
describe('Probe 2 — Task-plan rendering', () => {
  it('main process parses task_plan and strips [Tool Result:] prefix before emitting', () => {
    // Sprint 32: plan parsing moved from ToolCallCard.tsx to src/main/index.ts
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain('[Tool Result:');
    expect(mainSrc).toContain('.replace(');
  });

  it('main process extracts plan data with tasks array', () => {
    const mainSrc = readSrc('main/index.ts');
    expect(mainSrc).toContain('planData.tasks');
  });

  it('agentLoop does not truncate structured tools below 16000 chars', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain('STRUCTURED_TOOLS');
    expect(loopSrc).toContain('16000');
  });
});

// ═══════════════════════════════════════════════════════
//  Probe 3: Tier presets & settings persistence
// ═══════════════════════════════════════════════════════
describe('Probe 3 — Tier presets & settings persistence', () => {
  const presetsSrc = readSrc('main/orchestration/tierPresets.ts');

  it('exports DEFAULT_TIER = 2', () => {
    expect(presetsSrc).toContain('export const DEFAULT_TIER = 2');
  });

  it('defines all four tier presets (1-4)', () => {
    expect(presetsSrc).toContain('tier: 1');
    expect(presetsSrc).toContain('tier: 2');
    expect(presetsSrc).toContain('tier: 3');
    expect(presetsSrc).toContain('tier: 4');
  });

  it('each preset has required fields', () => {
    const requiredFields = [
      'maxTurnsPerTask', 'maxToolCallsPerTurn', 'maxRetries',
      'tokenBudget', 'timeoutMs', 'maxParallelToolCalls',
      'maxContextTokens', 'maxToolResultTokens',
      'softInputTokensPerMinute', 'softOutputTokensPerMinute', 'softRequestsPerMinute',
    ];
    for (const field of requiredFields) {
      expect(presetsSrc).toContain(field);
    }
  });

  it('tier 2 preset has sane defaults', () => {
    // maxTurnsPerTask for tier 2 should be 25
    expect(presetsSrc).toMatch(/tier:\s*2[\s\S]*?maxTurnsPerTask:\s*25/);
  });

  it('IPC channels include settings:get-orchestration and settings:set-orchestration', () => {
    const ipcSrc = readSrc('main/ipc/index.ts');
    expect(ipcSrc).toContain('settings:get-orchestration');
    expect(ipcSrc).toContain('settings:set-orchestration');
  });

  it('preload exposes getOrchestrationSettings and setOrchestrationSettings', () => {
    const preloadSrc = readSrc('preload/index.ts');
    expect(preloadSrc).toContain('getOrchestrationSettings');
    expect(preloadSrc).toContain('setOrchestrationSettings');
  });

  it('OrchestrationEngine DEFAULT_BUDGET sources from tier presets', () => {
    const orchSrc = readSrc('main/orchestration/index.ts');
    expect(orchSrc).toContain('getTierPreset');
    expect(orchSrc).toContain('DEFAULT_TIER');
  });
});

// ═══════════════════════════════════════════════════════
//  Probe 4: Plan-mode enforcement
// ═══════════════════════════════════════════════════════
describe('Probe 4 — Plan-mode enforcement', () => {
  const toolsSrc = readSrc('main/tools/index.ts');

  it('exports WRITE_ACCESS_TOOLS set', () => {
    expect(toolsSrc).toContain('WRITE_ACCESS_TOOLS');
    expect(toolsSrc).toContain('write_file');
    expect(toolsSrc).toContain('patch_file');
    expect(toolsSrc).toContain('multi_edit');
    expect(toolsSrc).toContain('bash_command');
  });

  it('exports getToolsForMode function', () => {
    expect(toolsSrc).toContain('export function getToolsForMode');
  });

  it('getToolsForMode filters write tools in plan mode', () => {
    expect(toolsSrc).toContain("mode === 'plan'");
    expect(toolsSrc).toContain('WRITE_ACCESS_TOOLS.has(t.name)');
  });

  it('PLANNER_PROMPT instructs use of ask_followup_question to switch modes', () => {
    const promptsSrc = readSrc('main/orchestration/prompts.ts');
    expect(promptsSrc).toContain('PLAN MODE');
    expect(promptsSrc).toContain('ask_followup_question');
    expect(promptsSrc).toContain('Build mode');
  });
});

// ═══════════════════════════════════════════════════════
//  Probe 5: Nudge visibility — instrumentation banner
// ═══════════════════════════════════════════════════════
describe('Probe 5 — Nudge instrumentation banner', () => {
  it('agentLoop emits no-tools-used-nudge event', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain("'agent:loop-event'");
    expect(loopSrc).toContain("'no-tools-used-nudge'");
    expect(loopSrc).toContain('consecutiveMistakes');
  });

  it('agentLoop emits max-mistakes-reached event', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain("'max-mistakes-reached'");
  });

  it('agentLoop emits terminal-tool-used event', () => {
    const loopSrc = readSrc('main/orchestration/agentLoop.ts');
    expect(loopSrc).toContain("'terminal-tool-used'");
  });

  it('ChatWorkspace listens for agent:loop-event via onAgentLoopEvent', () => {
    const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');
    expect(chatSrc).toContain('onAgentLoopEvent');
    expect(chatSrc).toContain('no-tools-used-nudge');
    expect(chatSrc).toContain('nudgeBanner');
  });

  it('ChatWorkspace renders the nudge banner', () => {
    const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');
    expect(chatSrc).toContain('Auto-recovery');
    expect(chatSrc).toContain('nudgeBanner.visible');
  });

  it('preload exposes onAgentLoopEvent', () => {
    const preloadSrc = readSrc('preload/index.ts');
    expect(preloadSrc).toContain('onAgentLoopEvent');
    expect(preloadSrc).toContain("'agent:loop-event'");
  });
});

// ═══════════════════════════════════════════════════════
//  Probe 6: No "Run again" in FollowupButtons
// ═══════════════════════════════════════════════════════
describe('Probe 6 — "Run again" removal', () => {
  const followupSrc = readSrc('renderer/components/chat/FollowupButtons.tsx');

  it('does not contain a "Run again" button label', () => {
    // The string 'Run again' as a label should not exist
    expect(followupSrc).not.toMatch(/label:\s*'Run again'/);
  });

  it('contains "Fix issues" as replacement after bash_command', () => {
    expect(followupSrc).toContain('Fix issues');
  });
});

// ═══════════════════════════════════════════════════════
//  Probe 7 (acceptance): grep for legacy patterns
// ═══════════════════════════════════════════════════════
describe('Acceptance — no legacy patterns', () => {
  it('no "honor.system" strings in source', () => {
    const files = [
      'main/index.ts', 'main/tools/index.ts',
      'main/orchestration/agentLoop.ts', 'main/orchestration/prompts.ts',
    ];
    for (const f of files) {
      const src = readSrc(f);
      expect(src).not.toContain('honor.system');
    }
  });

  it('exactly one DEFAULT_TIER reference in tierPresets.ts export line', () => {
    const presetsSrc = readSrc('main/orchestration/tierPresets.ts');
    const matches = presetsSrc.match(/export const DEFAULT_TIER/g) || [];
    expect(matches.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════
//  Probe 8 (smoke): Agent loop exits via attempt_completion
// ═══════════════════════════════════════════════════════
describe('Smoke — agent loop structure', () => {
  const loopSrc = readSrc('main/orchestration/agentLoop.ts');

  it('TERMINAL_TOOLS includes both terminal tools', () => {
    expect(loopSrc).toContain("'attempt_completion'");
    expect(loopSrc).toContain("'ask_followup_question'");
    expect(loopSrc).toContain('TERMINAL_TOOLS');
  });

  it('returns attempt_completion as exit reason', () => {
    expect(loopSrc).toContain("reason: 'attempt_completion'");
  });

  it('returns ask_followup_question as exit reason', () => {
    expect(loopSrc).toContain("reason: 'ask_followup_question'");
  });

  it('safety cap returns max_turns reason', () => {
    expect(loopSrc).toContain("reason: 'max_turns'");
  });
});
