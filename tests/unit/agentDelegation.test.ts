import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  createAgentDelegationPlan,
  formatAgentDelegationPlan,
  parseAgentMention,
} from '../../src/main/orchestration/agentDelegation';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 4 coordinator and sub-agent delegation', () => {
  it('decomposes broad work into specialist sub-agent assignments', () => {
    const plan = createAgentDelegationPlan('Design and implement a refactor with tests for agent orchestration');
    const roles = plan.assignments.map(assignment => assignment.roleId);

    expect(plan.coordinatorModeId).toBeTruthy();
    expect(roles).toEqual(expect.arrayContaining(['architect', 'code', 'test']));
    expect(plan.assignments.find(a => a.roleId === 'code')?.dependsOn.length).toBeGreaterThan(0);
    expect(plan.assignments.every(a => a.contextPacket.includes('Objective:'))).toBe(true);
  });

  it('supports @general and specialist mention parsing for focused delegation', () => {
    expect(parseAgentMention('@general add a save-game checkpoint')?.modeId).toBe('code');
    expect(parseAgentMention('@debug investigate failing startup')?.modeId).toBe('debug');

    const plan = createAgentDelegationPlan('@test add regression coverage for worktree handoff');
    expect(plan.objective).toBe('add regression coverage for worktree handoff');
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0].roleId).toBe('test');
  });

  it('formats a readable coordinator plan for chat', () => {
    const plan = createAgentDelegationPlan('@general wire the delegation command');
    const markdown = formatAgentDelegationPlan(plan);

    expect(markdown).toContain('Coordinator');
    expect(markdown).toContain('Sub-agent assignments');
    expect(markdown).toContain('Agent Board cards');
  });

  it('exposes delegation through slash command, IPC, preload, and @mentions', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    const ipcSrc = readSrc('main/ipc/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');
    const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');

    expect(commandsSrc).toContain("name: 'delegate'");
    expect(commandsSrc).toContain('createAgentDelegationPlan(objective');
    expect(ipcSrc).toContain('AGENT_DELEGATION_PLAN');
    expect(mainSrc).toContain('createAgentDelegationPlan(objective');
    expect(preloadSrc).toContain('planAgentDelegation');
    expect(chatSrc).toContain("trimmed.startsWith('@')");
    expect(chatSrc).toContain('`/delegate ${trimmed}`');
  });
});
