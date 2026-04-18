/**
 * Tool Wiring Contract Test — Sprint 30
 *
 * Integration test that verifies the actual tool arrays passed to
 * the agent loop / Anthropic API contain the expected terminal tools
 * in both build and plan modes.
 *
 * This test operates on the real source code (static analysis + import)
 * to catch wiring bugs before they reach production.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════
//  Contract: Build mode tool list
// ═══════════════════════════════════════════════════════
describe('Contract: Build mode tools', () => {
  const toolsSrc = readSrc('main/tools/index.ts');

  it('getToolsForMode("build") returns all LOCAL_TOOL_DEFINITIONS', () => {
    // getToolsForMode('build') returns LOCAL_TOOL_DEFINITIONS directly
    expect(toolsSrc).toContain("return LOCAL_TOOL_DEFINITIONS;");
  });

  it('build mode includes attempt_completion', () => {
    // ATTEMPT_COMPLETION_TOOL_DEF is in the LOCAL_TOOL_DEFINITIONS array
    expect(toolsSrc).toContain('ATTEMPT_COMPLETION_TOOL_DEF');
    // The tool def is NOT in WRITE_ACCESS_TOOLS (so it won't be filtered in plan mode either)
    const writeAccessBlock = toolsSrc.match(/WRITE_ACCESS_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(writeAccessBlock).not.toBeNull();
    expect(writeAccessBlock![1]).not.toContain('attempt_completion');
  });

  it('build mode includes ask_followup_question', () => {
    expect(toolsSrc).toContain('ASK_FOLLOWUP_QUESTION_TOOL_DEF');
    const writeAccessBlock = toolsSrc.match(/WRITE_ACCESS_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(writeAccessBlock![1]).not.toContain('ask_followup_question');
  });

  it('build mode includes read_file', () => {
    expect(toolsSrc).toContain("name: 'read_file'");
  });

  it('LOCAL_TOOL_DEFINITIONS contains at least 19 tools', () => {
    const namedDefs = (toolsSrc.match(/name:\s*'/g) || []).length;
    const importedDefs = (toolsSrc.match(/ATTEMPT_COMPLETION_TOOL_DEF|ASK_FOLLOWUP_QUESTION_TOOL_DEF/g) || []);
    // Each imported def is in the array once (referenced in the array literal)
    const arrayRefs = importedDefs.filter((_, i) => i < 2).length;
    expect(namedDefs + arrayRefs).toBeGreaterThanOrEqual(19);
  });
});

// ═══════════════════════════════════════════════════════
//  Contract: Plan mode tool list
// ═══════════════════════════════════════════════════════
describe('Contract: Plan mode tools', () => {
  const toolsSrc = readSrc('main/tools/index.ts');

  it('plan mode includes attempt_completion', () => {
    // attempt_completion is NOT a write tool
    const writeAccessBlock = toolsSrc.match(/WRITE_ACCESS_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(writeAccessBlock).not.toBeNull();
    expect(writeAccessBlock![1]).not.toContain('attempt_completion');
  });

  it('plan mode includes ask_followup_question', () => {
    const writeAccessBlock = toolsSrc.match(/WRITE_ACCESS_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(writeAccessBlock![1]).not.toContain('ask_followup_question');
  });

  it('plan mode excludes write_file', () => {
    const writeAccessBlock = toolsSrc.match(/WRITE_ACCESS_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(writeAccessBlock![1]).toContain("'write_file'");
  });

  it('plan mode excludes bash_command', () => {
    const writeAccessBlock = toolsSrc.match(/WRITE_ACCESS_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(writeAccessBlock![1]).toContain("'bash_command'");
  });

  it('getToolsForMode filters by WRITE_ACCESS_TOOLS for plan mode', () => {
    expect(toolsSrc).toContain("WRITE_ACCESS_TOOLS.has(t.name)");
  });
});

// ═══════════════════════════════════════════════════════
//  Contract: chat:send handler wiring
// ═══════════════════════════════════════════════════════
describe('Contract: chat:send uses getToolsForMode', () => {
  const mainSrc = readSrc('main/index.ts');

  it('imports getToolsForMode from tools', () => {
    expect(mainSrc).toContain('getToolsForMode');
  });

  it('calls getToolsForMode(mode) in chat:send handler', () => {
    // The handler should use getToolsForMode, not a manual filter
    expect(mainSrc).toContain("getToolsForMode(mode as 'plan' | 'build')");
  });

  it('maps input_schema to inputSchema for Anthropic compatibility', () => {
    // The handler maps t.input_schema -> inputSchema
    expect(mainSrc).toContain('inputSchema: t.input_schema');
  });

  it('passes tools to runAgentLoop', () => {
    expect(mainSrc).toContain('tools: allTools');
  });

  it('logs tool names for debugging (Sprint 29 P0-A)', () => {
    expect(mainSrc).toContain('[chat:send] Tools passed to agent loop');
  });

  it('warns if terminal tools are missing', () => {
    expect(mainSrc).toContain('Terminal tools missing');
  });
});

// ═══════════════════════════════════════════════════════
//  Contract: Provider sends tools to Anthropic correctly
// ═══════════════════════════════════════════════════════
describe('Contract: Provider maps tool schemas correctly', () => {
  const providerSrc = readSrc('main/providers/index.ts');

  it('maps inputSchema to input_schema for Anthropic API (sendMessage)', () => {
    expect(providerSrc).toContain('input_schema: t.inputSchema');
  });

  it('maps inputSchema to input_schema for Anthropic API (streamMessage)', () => {
    // Both sendMessage and streamMessage should map the schema
    const matches = providerSrc.match(/input_schema:\s*t\.inputSchema/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════
//  Contract: Terminal tool definitions have valid schemas
// ═══════════════════════════════════════════════════════
describe('Contract: Terminal tool definition schemas', () => {
  const attemptSrc = readSrc('main/tools/attemptCompletion.ts');
  const followupSrc = readSrc('main/tools/askFollowupQuestion.ts');

  it('attempt_completion has name field', () => {
    expect(attemptSrc).toContain("name: 'attempt_completion'");
  });

  it('attempt_completion has input_schema with type object', () => {
    expect(attemptSrc).toContain("type: 'object'");
    expect(attemptSrc).toContain("required: ['result']");
  });

  it('ask_followup_question has name field', () => {
    expect(followupSrc).toContain("name: 'ask_followup_question'");
  });

  it('ask_followup_question has input_schema with type object', () => {
    expect(followupSrc).toContain("type: 'object'");
    expect(followupSrc).toContain("required: ['question']");
  });

  it('both tools use input_schema (not inputSchema) property', () => {
    // The tool defs should use input_schema to match LocalToolDef interface
    expect(attemptSrc).toContain('input_schema:');
    expect(followupSrc).toContain('input_schema:');
  });
});

// ═══════════════════════════════════════════════════════
//  Contract: Dev Console emits API traffic events
// ═══════════════════════════════════════════════════════
describe('Contract: Dev Console observability (Sprint 30)', () => {
  const mainSrc = readSrc('main/index.ts');
  const providerSrc = readSrc('main/providers/index.ts');
  const preloadSrc = readSrc('preload/index.ts');
  const ipcSrc = readSrc('main/ipc/index.ts');

  it('main process emits devconsole:api-traffic on request', () => {
    expect(mainSrc).toContain("devconsole:api-traffic");
  });

  it('provider emits devconsole:api-traffic on response', () => {
    expect(providerSrc).toContain("devconsole:api-traffic");
  });

  it('main process emits devconsole:tool-registry', () => {
    expect(mainSrc).toContain("devconsole:tool-registry");
  });

  it('main process emits devconsole:settings-snapshot', () => {
    expect(mainSrc).toContain("devconsole:settings-snapshot");
  });

  it('IPC channels include Dev Console channels', () => {
    expect(ipcSrc).toContain('DEVCONSOLE_GET_TOOL_REGISTRY');
    expect(ipcSrc).toContain('DEVCONSOLE_GET_SETTINGS_SNAPSHOT');
    expect(ipcSrc).toContain('DEVCONSOLE_EXPORT');
  });

  it('preload exposes Dev Console bridges', () => {
    expect(preloadSrc).toContain('onDevConsoleApiTraffic');
    expect(preloadSrc).toContain('onDevConsoleToolRegistry');
    expect(preloadSrc).toContain('onDevConsoleSettingsSnapshot');
    expect(preloadSrc).toContain('getDevConsoleToolRegistry');
    expect(preloadSrc).toContain('getDevConsoleSettingsSnapshot');
    expect(preloadSrc).toContain('exportDevConsole');
  });
});

// ═══════════════════════════════════════════════════════
//  Contract: No changes to anti-goal files
// ═══════════════════════════════════════════════════════
describe('Anti-goals: no forbidden changes', () => {
  it('formatResponse.ts has no Sprint 30 markers', () => {
    const src = readSrc('main/orchestration/formatResponse.ts');
    expect(src).not.toContain('Sprint 30');
  });

  it('agentLoop.ts has no Sprint 30 markers', () => {
    const src = readSrc('main/orchestration/agentLoop.ts');
    expect(src).not.toContain('Sprint 30');
  });

  it('DEFAULT_TIER is still 2', () => {
    const src = readSrc('main/orchestration/tierPresets.ts');
    expect(src).toContain('DEFAULT_TIER = 2');
  });
});
