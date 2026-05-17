import { getDatabase } from '../db';

export type ScheduledAgentStatus = 'active' | 'paused';

export type ScheduledAgentCadence =
  | { type: 'interval'; everyMinutes: number }
  | { type: 'daily'; time: string }
  | { type: 'weekly'; day: number; time: string };

export interface ScheduledAgentJob {
  id: string;
  name: string;
  prompt: string;
  workspacePath: string;
  sessionId: string;
  status: ScheduledAgentStatus;
  cadence: ScheduledAgentCadence;
  modeId?: string;
  namespaces: string[];
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  lastRunAt: string | null;
  runCount: number;
}

export interface ScheduledAgentRunPacket {
  jobId: string;
  sessionId: string;
  workspacePath: string;
  prompt: string;
  namespaces: string[];
  modeId?: string;
  dueAt: string;
}

interface ScheduledAgentStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

interface CreateScheduledAgentInput {
  name: string;
  prompt: string;
  workspacePath: string;
  sessionId: string;
  cadence: ScheduledAgentCadence;
  modeId?: string;
  namespaces?: string[];
}

const SETTINGS_KEY = 'scheduled_agents.v1';

export function createScheduledAgent(input: CreateScheduledAgentInput, store: ScheduledAgentStore = getDatabase(), now = new Date()): ScheduledAgentJob {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Scheduled agent prompt is required.');
  const cadence = normalizeCadence(input.cadence);
  const jobs = loadScheduledAgents(store);
  const job: ScheduledAgentJob = {
    id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim() || titleFromPrompt(prompt),
    prompt,
    workspacePath: input.workspacePath,
    sessionId: input.sessionId || 'system',
    status: 'active',
    cadence,
    modeId: input.modeId,
    namespaces: normalizeNamespaces(input.namespaces || []),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    nextRunAt: computeNextRun(cadence, now).toISOString(),
    lastRunAt: null,
    runCount: 0,
  };
  saveScheduledAgents([...jobs, job], store);
  return job;
}

export function listScheduledAgents(store: ScheduledAgentStore = getDatabase()): ScheduledAgentJob[] {
  return loadScheduledAgents(store).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
}

export function getDueScheduledAgents(store: ScheduledAgentStore = getDatabase(), now = new Date()): ScheduledAgentJob[] {
  const ts = now.getTime();
  return listScheduledAgents(store).filter(job => job.status === 'active' && new Date(job.nextRunAt).getTime() <= ts);
}

export function buildScheduledAgentRunPackets(store: ScheduledAgentStore = getDatabase(), now = new Date()): ScheduledAgentRunPacket[] {
  return getDueScheduledAgents(store, now).map(job => ({
    jobId: job.id,
    sessionId: job.sessionId,
    workspacePath: job.workspacePath,
    prompt: [
      `Scheduled agent: ${job.name}`,
      '',
      job.prompt,
      '',
      'Run in the configured workspace and report a concise summary with verification evidence.',
    ].join('\n'),
    namespaces: job.namespaces,
    modeId: job.modeId,
    dueAt: job.nextRunAt,
  }));
}

export function markScheduledAgentRun(jobId: string, store: ScheduledAgentStore = getDatabase(), now = new Date()): ScheduledAgentJob {
  const jobs = loadScheduledAgents(store);
  const index = jobs.findIndex(job => job.id === jobId);
  if (index < 0) throw new Error(`Scheduled agent not found: ${jobId}`);
  const job = jobs[index];
  const updated: ScheduledAgentJob = {
    ...job,
    lastRunAt: now.toISOString(),
    nextRunAt: computeNextRun(job.cadence, now).toISOString(),
    runCount: job.runCount + 1,
    updatedAt: now.toISOString(),
  };
  jobs[index] = updated;
  saveScheduledAgents(jobs, store);
  return updated;
}

export function setScheduledAgentStatus(jobId: string, status: ScheduledAgentStatus, store: ScheduledAgentStore = getDatabase(), now = new Date()): ScheduledAgentJob {
  const jobs = loadScheduledAgents(store);
  const index = jobs.findIndex(job => job.id === jobId);
  if (index < 0) throw new Error(`Scheduled agent not found: ${jobId}`);
  const updated = {
    ...jobs[index],
    status,
    updatedAt: now.toISOString(),
  };
  jobs[index] = updated;
  saveScheduledAgents(jobs, store);
  return updated;
}

export function deleteScheduledAgent(jobId: string, store: ScheduledAgentStore = getDatabase()): boolean {
  const jobs = loadScheduledAgents(store);
  const next = jobs.filter(job => job.id !== jobId);
  saveScheduledAgents(next, store);
  return next.length !== jobs.length;
}

export function parseScheduledAgentCadence(value: string): ScheduledAgentCadence {
  const raw = value.trim().toLowerCase();
  const interval = raw.match(/^(?:every\s+)?(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours)$/);
  if (interval) {
    const amount = Number(interval[1]);
    const unit = interval[2];
    return { type: 'interval', everyMinutes: unit.startsWith('h') ? amount * 60 : amount };
  }
  if (raw === 'hourly') return { type: 'interval', everyMinutes: 60 };
  if (raw === 'daily') return { type: 'daily', time: '09:00' };
  const daily = raw.match(/^daily@([0-2]\d:[0-5]\d)$/);
  if (daily) return { type: 'daily', time: daily[1] };
  const weekly = raw.match(/^weekly@([0-6])@([0-2]\d:[0-5]\d)$/);
  if (weekly) return { type: 'weekly', day: Number(weekly[1]), time: weekly[2] };
  throw new Error('Unsupported schedule. Use hourly, daily, daily@09:00, weekly@1@09:00, or every 30m.');
}

export function formatScheduledAgent(job: ScheduledAgentJob): string {
  return `\`${job.id}\` ${job.name} (${formatCadence(job.cadence)}, ${job.status}) next ${job.nextRunAt}`;
}

function loadScheduledAgents(store: ScheduledAgentStore): ScheduledAgentJob[] {
  const raw = store.getSetting(SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isScheduledAgentJob) : [];
  } catch {
    return [];
  }
}

function saveScheduledAgents(jobs: ScheduledAgentJob[], store: ScheduledAgentStore): void {
  store.setSetting(SETTINGS_KEY, JSON.stringify(jobs));
}

function normalizeCadence(cadence: ScheduledAgentCadence): ScheduledAgentCadence {
  if (cadence.type === 'interval') {
    return { type: 'interval', everyMinutes: Math.max(1, Math.min(10080, Math.floor(cadence.everyMinutes))) };
  }
  if (cadence.type === 'daily') {
    return { type: 'daily', time: normalizeTime(cadence.time) };
  }
  return { type: 'weekly', day: Math.max(0, Math.min(6, Math.floor(cadence.day))), time: normalizeTime(cadence.time) };
}

function computeNextRun(cadence: ScheduledAgentCadence, now: Date): Date {
  if (cadence.type === 'interval') {
    return new Date(now.getTime() + cadence.everyMinutes * 60_000);
  }

  const [hour, minute] = normalizeTime(cadence.time).split(':').map(Number);
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);

  if (cadence.type === 'daily') {
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }

  const dayDelta = (cadence.day - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + dayDelta);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);
  return next;
}

function normalizeTime(value: string): string {
  if (!/^([0-2]\d):([0-5]\d)$/.test(value)) return '09:00';
  const [hour, minute] = value.split(':').map(Number);
  return `${String(Math.min(hour, 23)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeNamespaces(namespaces: string[]): string[] {
  return Array.from(new Set(namespaces.map(ns => ns.trim().replace(/\\/g, '/')).filter(Boolean))).sort();
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > 48 ? `${compact.slice(0, 45)}...` : compact;
}

function formatCadence(cadence: ScheduledAgentCadence): string {
  if (cadence.type === 'interval') return `every ${cadence.everyMinutes}m`;
  if (cadence.type === 'daily') return `daily@${cadence.time}`;
  return `weekly@${cadence.day}@${cadence.time}`;
}

function isScheduledAgentJob(value: any): value is ScheduledAgentJob {
  return !!value && typeof value.id === 'string' && typeof value.prompt === 'string' && !!value.cadence;
}
