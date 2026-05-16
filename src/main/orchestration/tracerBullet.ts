import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { createTodoList } from './todoManager';

export interface TracerBulletResult {
  feature: string;
  filePath: string;
  relativePath: string;
  tasks: string[];
  markdown: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'tracer-bullet';
}

function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function createTracerBullet(workspacePath: string, sessionId: string, feature: string): TracerBulletResult {
  const trimmedFeature = feature.trim();
  if (!trimmedFeature) {
    throw new Error('Usage: /tracer <feature or behavior>');
  }

  const tasks = [
    `Frame the smallest observable behavior for: ${trimmedFeature}`,
    'Identify the end-to-end path and one acceptance check',
    'Build the thinnest implementation slice behind existing patterns',
    'Run the focused check and capture evidence',
    'Only then expand scope or polish',
  ];

  createTodoList(sessionId, tasks.map((content, index) => ({
    content,
    priority: index <= 1 ? 'high' : 'medium',
    status: index === 0 ? 'in_progress' : 'pending',
  })));

  const tracerDir = join(workspacePath, '.gd', 'tracers');
  if (!existsSync(tracerDir)) mkdirSync(tracerDir, { recursive: true });

  const markdown = [
    `# Tracer Bullet: ${trimmedFeature}`,
    '',
    '## Purpose',
    '',
    'Prove the feature with the smallest end-to-end slice before widening scope.',
    '',
    '## Acceptance Check',
    '',
    '- A user-visible or test-visible behavior proves the path works.',
    '- The check fails before the slice and passes after it.',
    '- No broad refactor is required to claim the tracer bullet complete.',
    '',
    '## Task Ladder',
    '',
    ...tasks.map((task, index) => `- [${index === 0 ? '/' : ' '}] ${task}`),
    '',
    '## Expansion Gate',
    '',
    'Do not expand the implementation until the focused check passes and the current diff has been reviewed.',
    '',
  ].join('\n');

  const filePath = join(tracerDir, `${timestampForFile()}-${slugify(trimmedFeature)}.md`);
  writeFileSync(filePath, markdown, 'utf-8');

  return {
    feature: trimmedFeature,
    filePath,
    relativePath: relative(workspacePath, filePath),
    tasks,
    markdown,
  };
}
