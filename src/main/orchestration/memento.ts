import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, join, relative } from 'path';
import simpleGit from 'simple-git';
import { getDatabase } from '../db';
import { getCheckpoints } from './checkpoint';
import { getTodoList } from './todoManager';
import { formatVibeLoopMarkdown, getVibeLoopState } from './vibeLoop';

export interface MementoResult {
  filePath: string;
  relativePath: string;
  markdown: string;
}

function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sanitizeMarkdown(value: string): string {
  return (value || '').replace(/\r\n/g, '\n').trim();
}

function formatRecentMessages(messages: any[]): string {
  if (!messages.length) return '- No chat messages captured yet.';
  return messages.slice(-12).map((m: any) => {
    const content = sanitizeMarkdown(String(m.content || '')).replace(/\n{3,}/g, '\n\n');
    const clipped = content.length > 900 ? `${content.slice(0, 900)}...` : content;
    return `### ${String(m.role || 'message').toUpperCase()}\n\n${clipped || '(empty)'}`;
  }).join('\n\n');
}

export async function writeSessionMemento(workspacePath: string, sessionId: string, note = ''): Promise<MementoResult> {
  const db = getDatabase();
  const mementoDir = join(workspacePath, '.gd', 'memento');
  if (!existsSync(mementoDir)) mkdirSync(mementoDir, { recursive: true });

  let branch = '(unknown)';
  let statusLine = 'Git status unavailable.';
  let diffSummary = '';
  try {
    const git = simpleGit(workspacePath);
    const status = await git.status();
    branch = status.current || '(detached)';
    statusLine = [
      `Branch: ${branch}`,
      `Modified: ${status.modified.length}`,
      `Staged: ${status.staged.length}`,
      `Untracked: ${status.not_added.length}`,
      `Deleted: ${status.deleted.length}`,
    ].join(' | ');
    diffSummary = (await git.diff(['--stat'])).trim();
  } catch {
    // Mementos should still work outside Git repos.
  }

  const vibe = getVibeLoopState(sessionId);
  const todos = getTodoList(sessionId);
  const checkpoints = getCheckpoints(sessionId);
  const messages = db.getMessages(sessionId);

  const todoMarkdown = todos?.items.length
    ? todos.items.map(t => `- [${t.status === 'done' || t.status === 'skipped' ? 'x' : ' '}] (${t.priority}) ${t.content}${t.notes ? ` — ${t.notes}` : ''}`).join('\n')
    : '- No active todo list.';

  const checkpointMarkdown = checkpoints.length
    ? checkpoints.slice(-8).map(cp => `- ${cp.timestamp}: ${cp.label}${cp.data.notes ? ` — ${cp.data.notes}` : ''}`).join('\n')
    : '- No checkpoints captured.';

  const markdown = [
    `# GDeveloper Memento: ${basename(workspacePath)}`,
    '',
    `Session: ${sessionId}`,
    `Generated: ${new Date().toISOString()}`,
    note.trim() ? `Note: ${note.trim()}` : '',
    '',
    '## Current State',
    '',
    statusLine,
    diffSummary ? `\n\`\`\`text\n${diffSummary}\n\`\`\`` : '',
    '',
    '## Vibe Coding Loop',
    '',
    formatVibeLoopMarkdown(vibe),
    '',
    '## Todo Ledger',
    '',
    todoMarkdown,
    '',
    '## Checkpoints',
    '',
    checkpointMarkdown,
    '',
    '## Recent Transcript',
    '',
    formatRecentMessages(messages),
    '',
    '## Restart Prompt',
    '',
    [
      'Continue this session from the memento.',
      `Current loop stage is ${vibe.stage}.`,
      'First read the current git status and any changed files, then resume from the next unchecked todo or ask one focused question if the next action is ambiguous.',
    ].join(' '),
    '',
  ].filter(line => line !== '').join('\n');

  const filePath = join(mementoDir, `${timestampForFile()}-${sessionId.slice(0, 8) || 'session'}.md`);
  writeFileSync(filePath, markdown, 'utf-8');
  db.logActivity(sessionId, 'memento_written', `Memento written: ${relative(workspacePath, filePath)}`, note.trim(), {
    filePath,
    branch,
  });

  return {
    filePath,
    relativePath: relative(workspacePath, filePath),
    markdown,
  };
}
