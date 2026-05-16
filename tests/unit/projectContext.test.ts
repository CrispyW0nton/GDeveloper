import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

import {
  buildProjectContext,
  buildRepoMap,
  formatProjectContextForPrompt,
  formatRelevantCodeChunksForPrompt,
  loadProjectRuleFiles,
  retrieveRelevantCodeChunks,
} from '../../src/main/orchestration/projectContext';

const tempRoots: string[] = [];

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'gd-project-context-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('projectContext', () => {
  it('loads persistent project rule files in priority order', () => {
    const root = makeWorkspace();
    writeFileSync(join(root, 'AGENTS.md'), 'Always run tests before completion.');
    writeFileSync(join(root, '.gdrules'), 'Prefer small focused diffs.');

    const rules = loadProjectRuleFiles(root);

    expect(rules.map(r => r.filename)).toEqual(['AGENTS.md', '.gdrules']);
    expect(rules[0].content).toContain('Always run tests');
    expect(rules[1].path).toBe('.gdrules');
  });

  it('builds a ranked repo map with source symbols and config files', () => {
    const root = makeWorkspace();
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'ignored'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"name":"sample"}');
    writeFileSync(join(root, 'src', 'agent.ts'), [
      "import { readFileSync } from 'fs';",
      'export interface AgentOptions { sessionId: string }',
      'export class AgentRunner {}',
      'export function runAgent() { return readFileSync; }',
    ].join('\n'));
    writeFileSync(join(root, 'node_modules', 'ignored', 'bad.ts'), 'export function ignored() {}');

    const repoMap = buildRepoMap(root);

    expect(repoMap.entries.some(entry => entry.path === 'package.json')).toBe(true);
    const agentEntry = repoMap.entries.find(entry => entry.path === 'src/agent.ts');
    expect(agentEntry?.symbols).toEqual(expect.arrayContaining(['AgentOptions', 'AgentRunner', 'runAgent']));
    expect(agentEntry?.imports).toContain('fs');
    expect(repoMap.entries.some(entry => entry.path.includes('node_modules'))).toBe(false);
  });

  it('formats rules and repo map for prompt injection', () => {
    const root = makeWorkspace();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), 'Use the project architecture.');
    writeFileSync(join(root, 'src', 'index.ts'), 'export function startApp() {}');

    const context = buildProjectContext(root);
    const prompt = formatProjectContextForPrompt(context);

    expect(prompt).toContain('## Persistent Project Rules');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toContain('## Repo Map v1');
    expect(prompt).toContain('src/index.ts');
    expect(prompt).toContain('startApp');
  });

  it('retrieves request-relevant code chunks with file and symbol scoring', () => {
    const root = makeWorkspace();
    mkdirSync(join(root, 'src', 'providers'), { recursive: true });
    mkdirSync(join(root, 'src', 'themes'), { recursive: true });
    writeFileSync(join(root, 'src', 'providers', 'gateway.ts'), [
      'export interface ProviderGateway { streamMessage(): void }',
      'export function registerProviderGateway() { return "gateway"; }',
      'export function validateProviderModel() { return true; }',
    ].join('\n'));
    writeFileSync(join(root, 'src', 'themes', 'tokens.ts'), [
      'export const themeTokens = { color: "green" };',
    ].join('\n'));

    const chunks = retrieveRelevantCodeChunks(root, 'add provider gateway model validate');

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].path).toBe('src/providers/gateway.ts');
    expect(chunks[0].symbols).toEqual(expect.arrayContaining(['ProviderGateway', 'registerProviderGateway', 'validateProviderModel']));
    expect(chunks[0].matchedTerms).toEqual(expect.arrayContaining(['provider', 'gateway', 'model', 'validate']));
  });

  it('formats relevant code chunks as prompt evidence', () => {
    const root = makeWorkspace();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'search.ts'), 'export function searchCodebase() { return true; }');

    const chunks = retrieveRelevantCodeChunks(root, 'search codebase');
    const prompt = formatRelevantCodeChunksForPrompt(chunks);

    expect(prompt).toContain('## Relevant Code Context');
    expect(prompt).toContain('src/search.ts:1-1');
    expect(prompt).toContain('searchCodebase');
  });
});

describe('projectContext integration wiring', () => {
  it('prompt builder injects project context and persists the snapshot', () => {
    const promptBuilder = readFileSync(resolve(__dirname, '../../src/main/orchestration/promptBuilder.ts'), 'utf-8');

    expect(promptBuilder).toContain('buildProjectContext');
    expect(promptBuilder).toContain('formatProjectContextForPrompt');
    expect(promptBuilder).toContain('retrieveRelevantCodeChunks');
    expect(promptBuilder).toContain('formatRelevantCodeChunksForPrompt');
    expect(promptBuilder).toContain('saveProjectContextSnapshot');
    expect(promptBuilder).toContain('saveProjectContextRetrieval');
  });

  it('chat send uses the centralized enhanced prompt builder', () => {
    const mainIndex = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf-8');
    const chatSendIdx = mainIndex.indexOf('IPC_CHANNELS.CHAT_SEND');
    const chatSendBody = mainIndex.substring(chatSendIdx, chatSendIdx + 9000);

    expect(chatSendBody).toContain('buildEnhancedSystemPrompt({');
    expect(chatSendBody).toContain('currentUserMessage: message');
    expect(chatSendBody).not.toContain('let enhancedPrompt = SYSTEM_PROMPT');
  });
});
