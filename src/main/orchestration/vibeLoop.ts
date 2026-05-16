import { getDatabase } from '../db';

export const VIBE_LOOP_STAGES = ['frame', 'decompose', 'converse', 'review', 'test', 'refine'] as const;

export type VibeLoopStage = typeof VIBE_LOOP_STAGES[number];

export interface VibeLoopState {
  sessionId: string;
  stage: VibeLoopStage;
  updatedAt: string;
  note?: string;
}

export interface VibeLoopStageDefinition {
  id: VibeLoopStage;
  label: string;
  intent: string;
  template: string;
}

const SETTINGS_PREFIX = 'vibe.loop.';

export const VIBE_LOOP_STAGE_DEFINITIONS: VibeLoopStageDefinition[] = [
  {
    id: 'frame',
    label: 'Frame',
    intent: 'Clarify the outcome, constraints, risk, and acceptance bar before building.',
    template: 'Frame the work: goal, user impact, constraints, non-goals, and done criteria.',
  },
  {
    id: 'decompose',
    label: 'Decompose',
    intent: 'Break the work into thin, ordered tasks with a tracer-bullet first slice.',
    template: 'Decompose this into a tracer bullet, implementation steps, verification, and rollback notes.',
  },
  {
    id: 'converse',
    label: 'Converse',
    intent: 'Collaborate with the agent while keeping assumptions visible and decisions reversible.',
    template: 'Work through the implementation, call out assumptions, and keep changes scoped.',
  },
  {
    id: 'review',
    label: 'Review',
    intent: 'Inspect the diff for correctness, missing states, hidden shortcuts, and maintainability.',
    template: 'Review the current diff for regressions, missing tests, and cardboard-muffin behavior.',
  },
  {
    id: 'test',
    label: 'Test',
    intent: 'Run focused verification and capture concrete evidence before claiming completion.',
    template: 'Run the most relevant checks, explain failures, and fix issues before moving on.',
  },
  {
    id: 'refine',
    label: 'Refine',
    intent: 'Tighten UX, docs, cleanup, and handoff once the core behavior is proven.',
    template: 'Refine the result: simplify, document, polish edge cases, and prepare handoff notes.',
  },
];

export function isVibeLoopStage(value: string): value is VibeLoopStage {
  return VIBE_LOOP_STAGES.includes(value.toLowerCase() as VibeLoopStage);
}

export function getVibeLoopStageDefinition(stage: VibeLoopStage): VibeLoopStageDefinition {
  return VIBE_LOOP_STAGE_DEFINITIONS.find(s => s.id === stage) || VIBE_LOOP_STAGE_DEFINITIONS[0];
}

export function getNextVibeLoopStage(stage: VibeLoopStage): VibeLoopStage {
  const idx = VIBE_LOOP_STAGES.indexOf(stage);
  return VIBE_LOOP_STAGES[(idx + 1) % VIBE_LOOP_STAGES.length];
}

function keyForSession(sessionId: string): string {
  return `${SETTINGS_PREFIX}${sessionId || 'system'}`;
}

function defaultState(sessionId: string): VibeLoopState {
  return {
    sessionId: sessionId || 'system',
    stage: 'frame',
    updatedAt: new Date().toISOString(),
  };
}

export function getVibeLoopState(sessionId: string): VibeLoopState {
  const effectiveSessionId = sessionId || 'system';
  try {
    const raw = getDatabase().getSetting(keyForSession(effectiveSessionId));
    if (!raw) return defaultState(effectiveSessionId);
    const parsed = JSON.parse(raw) as Partial<VibeLoopState>;
    const stage = parsed.stage && isVibeLoopStage(parsed.stage) ? parsed.stage : 'frame';
    return {
      sessionId: effectiveSessionId,
      stage,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      note: typeof parsed.note === 'string' ? parsed.note : undefined,
    };
  } catch {
    return defaultState(effectiveSessionId);
  }
}

export function setVibeLoopStage(sessionId: string, stage: VibeLoopStage, note?: string): VibeLoopState {
  const state: VibeLoopState = {
    sessionId: sessionId || 'system',
    stage,
    updatedAt: new Date().toISOString(),
    note: note?.trim() || undefined,
  };
  getDatabase().setSetting(keyForSession(state.sessionId), JSON.stringify(state));
  return state;
}

export function resetVibeLoopState(sessionId: string): VibeLoopState {
  return setVibeLoopStage(sessionId || 'system', 'frame');
}

export function formatVibeLoopForPrompt(state: VibeLoopState): string {
  const def = getVibeLoopStageDefinition(state.stage);
  return [
    'Vibe Coding Loop',
    `Current stage: ${def.label}`,
    `Intent: ${def.intent}`,
    `Template: ${def.template}`,
    state.note ? `Session note: ${state.note}` : '',
    'Respect this stage unless the user explicitly asks to move forward or change strategy.',
  ].filter(Boolean).join('\n');
}

export function formatVibeLoopMarkdown(state: VibeLoopState): string {
  const def = getVibeLoopStageDefinition(state.stage);
  const lines = [
    `**Vibe Coding Loop: ${def.label}**`,
    '',
    def.intent,
    '',
    `Suggested prompt: \`${def.template}\``,
  ];
  if (state.note) {
    lines.push('', `Note: ${state.note}`);
  }
  lines.push('', `Next: \`/vibe next\` moves to ${getVibeLoopStageDefinition(getNextVibeLoopStage(state.stage)).label}.`);
  return lines.join('\n');
}
