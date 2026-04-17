/**
 * CHANGELOG Writer — Sprint 27
 * Generates structured CHANGELOG entries from session activity.
 * Writes to CHANGELOG.md in the workspace root.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface ChangelogEntry {
  version?: string;
  date: string;
  sessionId: string;
  sections: {
    added: string[];
    changed: string[];
    fixed: string[];
    removed: string[];
  };
}

/**
 * Build a CHANGELOG entry from tool calls and git status.
 */
export function buildChangelogEntry(
  sessionId: string,
  toolCalls: Array<{ name: string; input?: any; result?: string }>,
  version?: string,
): ChangelogEntry {
  const entry: ChangelogEntry = {
    version,
    date: new Date().toISOString().split('T')[0],
    sessionId,
    sections: { added: [], changed: [], fixed: [], removed: [] },
  };

  for (const tc of toolCalls) {
    const path = tc.input?.path || tc.input?.file_path || '';
    if (tc.name === 'write_file' && tc.input?.content) {
      // New file creation vs modification
      entry.sections.added.push(`Created \`${path}\``);
    } else if (tc.name === 'patch_file' || tc.name === 'multi_edit') {
      entry.sections.changed.push(`Modified \`${path}\``);
    } else if (tc.name === 'run_command' || tc.name === 'bash_command') {
      const cmd = (tc.input?.command || '').substring(0, 80);
      if (cmd.includes('rm ') || cmd.includes('delete')) {
        entry.sections.removed.push(`Executed: \`${cmd}\``);
      } else if (cmd.includes('fix') || cmd.includes('patch')) {
        entry.sections.fixed.push(`Executed: \`${cmd}\``);
      }
    }
  }

  return entry;
}

/**
 * Format a ChangelogEntry as a Markdown block.
 */
export function formatChangelogMarkdown(entry: ChangelogEntry): string {
  const lines: string[] = [];
  const header = entry.version
    ? `## [${entry.version}] - ${entry.date}`
    : `## [Unreleased] - ${entry.date}`;
  lines.push(header);
  lines.push('');

  const { added, changed, fixed, removed } = entry.sections;
  if (added.length > 0) {
    lines.push('### Added');
    added.forEach(a => lines.push(`- ${a}`));
    lines.push('');
  }
  if (changed.length > 0) {
    lines.push('### Changed');
    changed.forEach(c => lines.push(`- ${c}`));
    lines.push('');
  }
  if (fixed.length > 0) {
    lines.push('### Fixed');
    fixed.forEach(f => lines.push(`- ${f}`));
    lines.push('');
  }
  if (removed.length > 0) {
    lines.push('### Removed');
    removed.forEach(r => lines.push(`- ${r}`));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Prepend a changelog entry to the workspace's CHANGELOG.md file.
 */
export function writeChangelog(workspacePath: string, entry: ChangelogEntry): string {
  const changelogPath = join(workspacePath, 'CHANGELOG.md');
  const newBlock = formatChangelogMarkdown(entry);

  let existing = '';
  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, 'utf-8');
  }

  // Prepend the new entry after the title line (or at the top)
  const titleLine = '# Changelog\n\n';
  let content: string;
  if (existing.startsWith('# Changelog')) {
    content = existing.replace(/^# Changelog\n*/, titleLine + newBlock + '\n');
  } else {
    content = titleLine + newBlock + '\n' + existing;
  }

  writeFileSync(changelogPath, content, 'utf-8');
  return changelogPath;
}
