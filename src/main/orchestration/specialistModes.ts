import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { getDatabase } from '../db';

export type SpecialistToolPolicy = 'full' | 'read-only' | 'debug' | 'test';

export interface SpecialistModeDefinition {
  id: string;
  label: string;
  description: string;
  prompt: string;
  toolPolicy: SpecialistToolPolicy;
  source: 'built-in' | 'workspace';
}

const ACTIVE_MODE_KEY = 'specialist_mode.active';

export const BUILT_IN_SPECIALIST_MODES: SpecialistModeDefinition[] = [
  {
    id: 'code',
    label: 'Code',
    description: 'Implement scoped changes with normal Build/Plan safeguards.',
    toolPolicy: 'full',
    source: 'built-in',
    prompt: 'Act as a pragmatic implementation engineer. Keep changes scoped, follow existing patterns, and verify the behavior you touched.',
  },
  {
    id: 'architect',
    label: 'Architect',
    description: 'Design systems, APIs, data flow, and migration plans before implementation.',
    toolPolicy: 'read-only',
    source: 'built-in',
    prompt: 'Act as a senior architect. Prefer discovery, diagrams, contracts, tradeoffs, and migration plans. Avoid code edits unless the user explicitly asks to implement.',
  },
  {
    id: 'ask',
    label: 'Ask',
    description: 'Answer questions and explain the codebase without taking write actions.',
    toolPolicy: 'read-only',
    source: 'built-in',
    prompt: 'Act as an explanatory pair programmer. Answer directly, cite relevant files when useful, and ask for clarification only when needed.',
  },
  {
    id: 'debug',
    label: 'Debug',
    description: 'Investigate failures, isolate causes, and make minimal repairs.',
    toolPolicy: 'debug',
    source: 'built-in',
    prompt: 'Act as a debugging specialist. Reproduce before changing when possible, identify the smallest failing surface, and keep fixes minimal and test-backed.',
  },
  {
    id: 'test',
    label: 'Test',
    description: 'Design, run, and strengthen verification around the current work.',
    toolPolicy: 'test',
    source: 'built-in',
    prompt: 'Act as a test engineer. Focus on meaningful coverage, regression cases, and verification commands. Watch for shallow assertions and skipped tests.',
  },
];

let activeSpecialistModeId = 'code';

export function listSpecialistModes(workspacePath?: string | null): SpecialistModeDefinition[] {
  const byId = new Map<string, SpecialistModeDefinition>();
  for (const mode of BUILT_IN_SPECIALIST_MODES) byId.set(mode.id, mode);
  for (const mode of loadWorkspaceSpecialistModes(workspacePath)) byId.set(mode.id, mode);
  return Array.from(byId.values()).sort((a, b) => Number(a.source === 'workspace') - Number(b.source === 'workspace') || a.label.localeCompare(b.label));
}

export function getActiveSpecialistMode(workspacePath?: string | null): SpecialistModeDefinition {
  const saved = readActiveModeId();
  if (saved) activeSpecialistModeId = saved;
  return getSpecialistMode(activeSpecialistModeId, workspacePath) || BUILT_IN_SPECIALIST_MODES[0];
}

export function setActiveSpecialistMode(id: string, workspacePath?: string | null): SpecialistModeDefinition {
  const mode = getSpecialistMode(id, workspacePath);
  if (!mode) {
    throw new Error(`Unknown specialist mode: ${id}`);
  }
  activeSpecialistModeId = mode.id;
  writeActiveModeId(mode.id);
  return mode;
}

export function getSpecialistMode(id: string, workspacePath?: string | null): SpecialistModeDefinition | undefined {
  return listSpecialistModes(workspacePath).find(mode => mode.id === id);
}

export function formatSpecialistModeForPrompt(workspacePath?: string | null): string {
  const mode = getActiveSpecialistMode(workspacePath);
  return [
    `Specialist Mode: ${mode.label} (${mode.id})`,
    `Tool posture: ${mode.toolPolicy}`,
    mode.prompt,
  ].join('\n');
}

function loadWorkspaceSpecialistModes(workspacePath?: string | null): SpecialistModeDefinition[] {
  if (!workspacePath) return [];
  const modesDir = join(workspacePath, '.gd', 'modes');
  if (!existsSync(modesDir)) return [];

  const modes: SpecialistModeDefinition[] = [];
  for (const entry of readdirSync(modesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = join(modesDir, entry.name);
    try {
      const parsed = parseModeMarkdown(readFileSync(filePath, 'utf-8'), basename(entry.name, '.md'));
      modes.push(parsed);
    } catch (err) {
      console.warn(`[Specialist Modes] Failed to load ${filePath}:`, err);
    }
  }
  return modes;
}

function parseModeMarkdown(content: string, fallbackId: string): SpecialistModeDefinition {
  const lines = content.split(/\r?\n/);
  const meta: Record<string, string> = {};
  let bodyStart = 0;

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
        if (match) meta[match[1].toLowerCase()] = match[2].trim();
      }
      bodyStart = end + 1;
    }
  }

  const id = sanitizeModeId(meta.id || fallbackId);
  const label = meta.label || titleFromId(id);
  const prompt = lines.slice(bodyStart).join('\n').trim() || `Act as ${label}.`;
  const toolPolicy = parseToolPolicy(meta.toolpolicy || meta.tool_policy);

  return {
    id,
    label,
    description: meta.description || `Workspace specialist mode: ${label}`,
    prompt,
    toolPolicy,
    source: 'workspace',
  };
}

function parseToolPolicy(value?: string): SpecialistToolPolicy {
  if (value === 'read-only' || value === 'debug' || value === 'test' || value === 'full') return value;
  return 'full';
}

function sanitizeModeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
}

function titleFromId(id: string): string {
  return id.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function readActiveModeId(): string | null {
  try {
    return getDatabase().getSetting(ACTIVE_MODE_KEY);
  } catch {
    return activeSpecialistModeId;
  }
}

function writeActiveModeId(id: string): void {
  try {
    getDatabase().setSetting(ACTIVE_MODE_KEY, id);
  } catch {
    // In-memory fallback already updated.
  }
}
