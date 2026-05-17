import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  buildSpecRunPrompt,
  createSpec,
  formatSpecForPrompt,
  getActiveSpec,
  listSpecs,
  setActiveSpec,
} from '../../src/main/orchestration/specDriven';
import { getTodoList } from '../../src/main/orchestration/todoManager';

const SRC = resolve(__dirname, '../../src');
const TMP_ROOT = resolve(__dirname, '../../.pytest_tmp_specs');

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

function makeWorkspace(): string {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, 'workspace-'));
}

describe('Phase 5 spec-driven mode', () => {
  it('creates a persistent spec file, registry entry, active spec, and todo task tree', () => {
    const workspacePath = makeWorkspace();
    const store = new MemoryStore();
    const spec = createSpec({
      workspacePath,
      sessionId: 'session-spec',
      markdown: [
        '# Checkout Flow',
        '',
        'Let users check out with saved payment methods.',
        '',
        '## Acceptance Criteria',
        '',
        '- Saved cards are listed',
        '- Failed payment shows a retry path',
        '',
        '## Tasks',
        '',
        '- Add API contract',
        '- Render saved cards',
        '- Add retry test',
      ].join('\n'),
    }, store, new Date('2026-05-16T10:00:00.000Z'));

    expect(spec.title).toBe('Checkout Flow');
    expect(spec.acceptanceCriteria).toEqual(['Saved cards are listed', 'Failed payment shows a retry path']);
    expect(spec.tasks.map(task => task.title)).toEqual(['Add API contract', 'Render saved cards', 'Add retry test']);
    expect(listSpecs(workspacePath, store)).toHaveLength(1);
    expect(getActiveSpec(workspacePath, store)?.id).toBe(spec.id);
    expect(existsSync(join(workspacePath, spec.relativePath))).toBe(true);
    expect(getTodoList('session-spec')?.items.map(item => item.content)).toEqual(spec.tasks.map(task => task.title));
  });

  it('formats the active spec as a run prompt and prompt-builder oracle', () => {
    const workspacePath = makeWorkspace();
    const store = new MemoryStore();
    const spec = createSpec({
      workspacePath,
      sessionId: 'session-spec-format',
      markdown: [
        '# Audit Dashboard',
        '',
        'Show operational health.',
        '',
        '## Acceptance Criteria',
        '- Token spend is visible',
        '',
        '## Tasks',
        '- Add dashboard data shape',
      ].join('\n'),
    }, store, new Date('2026-05-16T10:00:00.000Z'));

    expect(setActiveSpec(spec.id, workspacePath, store).title).toBe('Audit Dashboard');
    expect(buildSpecRunPrompt(spec)).toContain('Spec-driven implementation: Audit Dashboard');
    expect(formatSpecForPrompt(spec)).toContain('Use this spec as the truthfulness oracle');
  });

  it('wires slash command, IPC, preload, and prompt builder integration', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    const ipcSrc = readSrc('main/ipc/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');
    const promptBuilderSrc = readSrc('main/orchestration/promptBuilder.ts');
    const dropdownSrc = readSrc('renderer/components/chat/SlashCommandDropdown.tsx');
    const appSrc = readSrc('renderer/App.tsx');
    const sidebarSrc = readSrc('renderer/components/common/Sidebar.tsx');
    const storeSrc = readSrc('renderer/store/index.ts');

    expect(commandsSrc).toContain("name: 'spec'");
    expect(commandsSrc).toContain('createSpec({ workspacePath: ws');
    expect(commandsSrc).toContain('buildSpecRunPrompt(spec)');
    expect(ipcSrc).toContain('SPEC_CREATE');
    expect(ipcSrc).toContain('SPEC_RUN_PROMPT');
    expect(mainSrc).toContain('IPC_CHANNELS.SPEC_CREATE');
    expect(mainSrc).toContain('buildSpecRunPrompt(spec)');
    expect(preloadSrc).toContain('createSpec');
    expect(preloadSrc).toContain('getSpecRunPrompt');
    expect(promptBuilderSrc).toContain('formatSpecForPrompt(getActiveSpec');
    expect(dropdownSrc).toContain("'spec': '/spec create");
    expect(appSrc).toContain('<SpecsPanel');
    expect(sidebarSrc).toContain("id: 'specs'");
    expect(storeSrc).toContain("'specs'");
  });
});
