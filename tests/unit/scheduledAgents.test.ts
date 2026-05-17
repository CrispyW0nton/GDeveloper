import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildScheduledAgentRunPackets,
  createScheduledAgent,
  deleteScheduledAgent,
  getDueScheduledAgents,
  listScheduledAgents,
  markScheduledAgentRun,
  parseScheduledAgentCadence,
  setScheduledAgentStatus,
} from '../../src/main/orchestration/scheduledAgents';

const SRC = resolve(__dirname, '../../src');

class MemoryStore {
  values = new Map<string, string>();
  getSetting(key: string): string | null {
    return this.values.get(key) || null;
  }
  setSetting(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 4 scheduled background agents', () => {
  it('creates persistent schedules and computes due run packets', () => {
    const store = new MemoryStore();
    const now = new Date('2026-05-16T10:00:00.000Z');
    const job = createScheduledAgent({
      name: 'Dependency audit',
      prompt: 'Check dependency health and summarize risks',
      workspacePath: '/repo',
      sessionId: 'session-1',
      cadence: { type: 'interval', everyMinutes: 30 },
      namespaces: ['package.json', 'src'],
      modeId: 'test',
    }, store, now);

    expect(job.nextRunAt).toBe('2026-05-16T10:30:00.000Z');
    expect(listScheduledAgents(store)).toHaveLength(1);
    expect(getDueScheduledAgents(store, new Date('2026-05-16T10:29:00.000Z'))).toHaveLength(0);

    const packets = buildScheduledAgentRunPackets(store, new Date('2026-05-16T10:30:00.000Z'));
    expect(packets).toHaveLength(1);
    expect(packets[0].prompt).toContain('Scheduled agent: Dependency audit');
    expect(packets[0].namespaces).toEqual(['package.json', 'src']);
  });

  it('marks runs, pauses/resumes jobs, and deletes schedules', () => {
    const store = new MemoryStore();
    const job = createScheduledAgent({
      name: 'PR summary',
      prompt: 'Summarize open PRs',
      workspacePath: '/repo',
      sessionId: 'session-1',
      cadence: parseScheduledAgentCadence('hourly'),
    }, store, new Date('2026-05-16T10:00:00.000Z'));

    const run = markScheduledAgentRun(job.id, store, new Date('2026-05-16T11:00:00.000Z'));
    expect(run.runCount).toBe(1);
    expect(run.lastRunAt).toBe('2026-05-16T11:00:00.000Z');
    expect(run.nextRunAt).toBe('2026-05-16T12:00:00.000Z');

    expect(setScheduledAgentStatus(job.id, 'paused', store).status).toBe('paused');
    expect(setScheduledAgentStatus(job.id, 'active', store).status).toBe('active');
    expect(deleteScheduledAgent(job.id, store)).toBe(true);
    expect(listScheduledAgents(store)).toHaveLength(0);
  });

  it('parses supported cadence shortcuts', () => {
    expect(parseScheduledAgentCadence('every 45m')).toEqual({ type: 'interval', everyMinutes: 45 });
    expect(parseScheduledAgentCadence('2h')).toEqual({ type: 'interval', everyMinutes: 120 });
    expect(parseScheduledAgentCadence('daily@08:30')).toEqual({ type: 'daily', time: '08:30' });
    expect(parseScheduledAgentCadence('weekly@1@09:00')).toEqual({ type: 'weekly', day: 1, time: '09:00' });
  });

  it('exposes scheduled agents through slash command, IPC, and preload', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    const ipcSrc = readSrc('main/ipc/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');

    expect(commandsSrc).toContain("name: 'agent-schedule'");
    expect(commandsSrc).toContain('buildScheduledAgentRunPackets');
    expect(ipcSrc).toContain('SCHEDULED_AGENT_CREATE');
    expect(ipcSrc).toContain('SCHEDULED_AGENT_DUE');
    expect(mainSrc).toContain('IPC_CHANNELS.SCHEDULED_AGENT_CREATE');
    expect(mainSrc).toContain('markScheduledAgentRun(jobId)');
    expect(preloadSrc).toContain('createScheduledAgent');
    expect(preloadSrc).toContain('getDueScheduledAgents');
  });
});
