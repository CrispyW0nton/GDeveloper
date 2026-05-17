import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDatabase } from '../db';
import { createTodoList } from './todoManager';

export type SpecStatus = 'draft' | 'active' | 'done';

export interface SpecTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface SpecRecord {
  id: string;
  title: string;
  summary: string;
  status: SpecStatus;
  workspacePath: string;
  sessionId: string;
  relativePath: string;
  acceptanceCriteria: string[];
  tasks: SpecTask[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSpecInput {
  workspacePath: string;
  sessionId: string;
  markdown: string;
  title?: string;
  status?: SpecStatus;
}

interface SpecStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

const SETTINGS_KEY = 'spec_driven.v1';

export function createSpec(input: CreateSpecInput, store: SpecStore = getDatabase(), now = new Date()): SpecRecord {
  const markdown = input.markdown.trim();
  if (!markdown) throw new Error('Usage: /spec create <markdown spec>');

  const parsed = parseSpecMarkdown(markdown);
  const title = sanitizeTitle(input.title || parsed.title || titleFromMarkdown(markdown));
  const id = `spec-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`;
  const specDir = join(input.workspacePath, '.gd', 'specs');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });

  const tasks = parsed.tasks.map((task, index) => ({
    id: `task-${index + 1}`,
    title: task,
    status: index === 0 ? 'in_progress' as const : 'pending' as const,
  }));
  const record: SpecRecord = {
    id,
    title,
    summary: parsed.summary || firstParagraph(markdown),
    status: input.status || 'active',
    workspacePath: input.workspacePath,
    sessionId: input.sessionId,
    relativePath: join('.gd', 'specs', `${slugify(title)}.md`).replace(/\\/g, '/'),
    acceptanceCriteria: parsed.acceptanceCriteria,
    tasks,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const fullPath = join(input.workspacePath, record.relativePath);
  writeFileSync(fullPath, formatSpecMarkdown(record, markdown), 'utf-8');

  const registry = loadSpecRegistry(store).filter(spec => spec.id !== record.id);
  saveSpecRegistry([...registry, record], store);
  setActiveSpec(record.id, input.workspacePath, store);

  if (tasks.length > 0) {
    createTodoList(input.sessionId, tasks.map(task => ({
      content: task.title,
      priority: 'high',
      status: task.status,
    })));
  }

  return record;
}

export function listSpecs(workspacePath?: string, store: SpecStore = getDatabase()): SpecRecord[] {
  return loadSpecRegistry(store)
    .filter(spec => !workspacePath || spec.workspacePath === workspacePath)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSpec(id: string, store: SpecStore = getDatabase()): SpecRecord | undefined {
  return loadSpecRegistry(store).find(spec => spec.id === id);
}

export function setActiveSpec(id: string, workspacePath: string, store: SpecStore = getDatabase()): SpecRecord {
  const spec = getSpec(id, store);
  if (!spec) throw new Error(`Spec not found: ${id}`);
  if (spec.workspacePath !== workspacePath) throw new Error('Spec belongs to a different workspace.');
  store.setSetting(activeSpecKey(workspacePath), id);
  return spec;
}

export function getActiveSpec(workspacePath?: string | null, store: SpecStore = getDatabase()): SpecRecord | null {
  if (!workspacePath) return null;
  const activeId = store.getSetting(activeSpecKey(workspacePath));
  const active = activeId ? getSpec(activeId, store) : undefined;
  if (active && active.workspacePath === workspacePath) return active;
  return listSpecs(workspacePath, store).find(spec => spec.status === 'active') || null;
}

export function buildSpecRunPrompt(spec: SpecRecord): string {
  const criteria = spec.acceptanceCriteria.length
    ? spec.acceptanceCriteria.map(item => `- ${item}`).join('\n')
    : '- Derive acceptance checks from the spec before coding.';
  const tasks = spec.tasks.length
    ? spec.tasks.map(task => `- [${task.status === 'done' ? 'x' : task.status === 'in_progress' ? '/' : ' '}] ${task.title}`).join('\n')
    : '- Decompose the spec into implementation tasks first.';

  return [
    `Spec-driven implementation: ${spec.title}`,
    '',
    `Spec file: ${spec.relativePath}`,
    '',
    'Treat the spec as the source of truth. Implement the next unchecked task, preserve acceptance criteria, and report verification evidence.',
    '',
    'Acceptance criteria:',
    criteria,
    '',
    'Task tree:',
    tasks,
  ].join('\n');
}

export function formatSpecForPrompt(spec: SpecRecord | null): string {
  if (!spec) return '';
  return [
    'Active Spec-Driven Mode:',
    `Title: ${spec.title}`,
    `Status: ${spec.status}`,
    `Path: ${spec.relativePath}`,
    spec.summary ? `Summary: ${spec.summary}` : '',
    spec.acceptanceCriteria.length ? `Acceptance Criteria:\n${spec.acceptanceCriteria.map(item => `- ${item}`).join('\n')}` : '',
    spec.tasks.length ? `Task Tree:\n${spec.tasks.map(task => `- ${task.status}: ${task.title}`).join('\n')}` : '',
    'Use this spec as the truthfulness oracle for implementation and review.',
  ].filter(Boolean).join('\n');
}

export function formatSpecList(specs: SpecRecord[]): string {
  if (!specs.length) return '**Specs:** none yet. Create one with `/spec create <markdown spec>`.';
  return ['**Specs:**', ...specs.map(spec => `- \`${spec.id}\` ${spec.title} (${spec.status}) - ${spec.relativePath}`)].join('\n');
}

function parseSpecMarkdown(markdown: string): { title: string; summary: string; acceptanceCriteria: string[]; tasks: string[] } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const title = (lines.find(line => /^#\s+/.test(line)) || '').replace(/^#\s+/, '').trim();
  const sections = collectSections(lines);
  return {
    title,
    summary: firstParagraph(sections.get('summary') || markdown),
    acceptanceCriteria: extractBullets(sections.get('acceptance criteria') || sections.get('acceptance') || ''),
    tasks: extractBullets(sections.get('tasks') || sections.get('implementation tasks') || sections.get('task tree') || ''),
  };
}

function collectSections(lines: string[]): Map<string, string> {
  const sections = new Map<string, string>();
  let current = '';
  let buffer: string[] = [];
  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      if (current) sections.set(current, buffer.join('\n').trim());
      current = heading[1].trim().toLowerCase();
      buffer = [];
    } else if (current) {
      buffer.push(line);
    }
  }
  if (current) sections.set(current, buffer.join('\n').trim());
  return sections;
}

function extractBullets(value: string): string[] {
  return value
    .split('\n')
    .map(line => line.replace(/^\s*[-*]\s+\[[ x/]\]\s+/i, '').replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 24);
}

function formatSpecMarkdown(record: SpecRecord, originalMarkdown: string): string {
  return [
    `# ${record.title}`,
    '',
    `Spec ID: ${record.id}`,
    `Status: ${record.status}`,
    `Generated: ${record.createdAt}`,
    '',
    '## Source Spec',
    '',
    originalMarkdown,
    '',
    '## Generated Task Tree',
    '',
    ...(record.tasks.length ? record.tasks.map(task => `- [${task.status === 'done' ? 'x' : task.status === 'in_progress' ? '/' : ' '}] ${task.title}`) : ['- [ ] Decompose the spec into tasks.']),
    '',
  ].join('\n');
}

function loadSpecRegistry(store: SpecStore): SpecRecord[] {
  const raw = store.getSetting(SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSpecRecord) : [];
  } catch {
    return [];
  }
}

function saveSpecRegistry(specs: SpecRecord[], store: SpecStore): void {
  store.setSetting(SETTINGS_KEY, JSON.stringify(specs));
}

function activeSpecKey(workspacePath: string): string {
  return `spec_driven.active.${workspacePath}`;
}

function isSpecRecord(value: any): value is SpecRecord {
  return !!value && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.workspacePath === 'string';
}

function sanitizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled Spec';
}

function titleFromMarkdown(markdown: string): string {
  return firstParagraph(markdown).slice(0, 80) || 'Untitled Spec';
}

function firstParagraph(markdown: string): string {
  return markdown
    .replace(/^#.+$/gm, '')
    .split(/\n\s*\n/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .find(Boolean) || '';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `spec-${Date.now()}`;
}
