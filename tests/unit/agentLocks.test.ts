import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  clearAgentNamespaceLocksForTests,
  getAgentNamespaceLocks,
  heartbeatAgentLock,
  releaseAgentNamespaces,
  reserveAgentNamespaces,
} from '../../src/main/worktree/agentLocks';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 4 Stewnami protection agent locks', () => {
  beforeEach(() => clearAgentNamespaceLocksForTests());

  it('reserves namespaces and blocks overlapping agent tasks', () => {
    const first = reserveAgentNamespaces('task-a', 'session-a', ['src/main', './tests/unit']);
    const second = reserveAgentNamespaces('task-b', 'session-b', ['src/main/orchestration']);

    expect(first.success).toBe(true);
    expect(first.lock?.namespaces).toEqual(['src/main', 'tests/unit']);
    expect(second.success).toBe(false);
    expect(second.conflicts?.[0].taskId).toBe('task-a');
  });

  it('allows non-overlapping reservations and supports heartbeat/release', () => {
    expect(reserveAgentNamespaces('task-a', 'session-a', ['src/main']).success).toBe(true);
    expect(reserveAgentNamespaces('task-b', 'session-b', ['docs']).success).toBe(true);

    const heartbeat = heartbeatAgentLock('task-a');
    expect(heartbeat.success).toBe(true);
    expect(getAgentNamespaceLocks()).toHaveLength(2);

    const release = releaseAgentNamespaces('task-a');
    expect(release.success).toBe(true);
    expect(getAgentNamespaceLocks().map(lock => lock.taskId)).toEqual(['task-b']);
  });

  it('expires locks that miss their heartbeat', () => {
    const reserved = reserveAgentNamespaces('task-a', 'session-a', ['src/main'], -1);
    expect(reserved.success).toBe(true);

    expect(getAgentNamespaceLocks()).toHaveLength(0);
  });

  it('wires locks into commands, IPC, preload, and the Agent Board UI', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    const ipcSrc = readSrc('main/ipc/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');
    const boardSrc = readSrc('main/worktree/agentBoard.ts');
    const boardUiSrc = readSrc('renderer/components/worktree/AgentKanbanBoard.tsx');

    expect(commandsSrc).toContain("name: 'agent-lock'");
    expect(commandsSrc).toContain("name: 'agent-unlock'");
    expect(commandsSrc).toContain("name: 'agent-heartbeat'");
    expect(ipcSrc).toContain('AGENT_LOCK_RESERVE');
    expect(mainSrc).toContain('reserveAgentNamespaces');
    expect(preloadSrc).toContain('reserveAgentLock');
    expect(boardSrc).toContain('namespaceConflicts');
    expect(boardUiSrc).toContain('onReleaseLock');
  });
});
