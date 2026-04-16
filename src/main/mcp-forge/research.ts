/**
 * MCP Forge — Research-Assisted Adapter Generation
 * Sprint 14, Tasks 6 + 7
 *
 * Uses AI to research the target application before generating an adapter.
 * Cross-references docs, SDKs, existing wrappers, and community examples.
 * Also manages external repo downloads for adapter-building analysis.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join, resolve, basename } from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { getDatabase } from '../db';
import { providerRegistry, ClaudeProvider } from '../providers';
import type { CapabilityReport } from './types';

// ─── External Analysis Area (Task 7) ───

const FORGE_ANALYSIS_DIR = '.gdeveloper-forge-analysis';

/**
 * Get the dedicated external analysis root for MCP Forge.
 * Separate from workspace external analysis and from generated adapters.
 */
export function getForgeAnalysisRoot(): string {
  const { app } = require('electron');
  const root = join(app.getPath('userData'), FORGE_ANALYSIS_DIR);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

export interface ForgeExternalRepo {
  name: string;
  localPath: string;
  sourceUrl: string;
  branch: string;
  clonedAt: string;
  notes: string;
}

/**
 * Clone a public repo into the forge analysis area for read-only inspection.
 */
export async function cloneForAnalysis(
  repoUrl: string,
  branch?: string
): Promise<ForgeExternalRepo> {
  const db = getDatabase();
  const root = getForgeAnalysisRoot();

  const nameMatch = repoUrl.match(/\/([^/]+?)(?:\.git)?$/);
  const repoName = nameMatch ? nameMatch[1] : `repo-${Date.now()}`;
  const localPath = join(root, repoName);

  if (existsSync(localPath)) {
    // Already cloned, return existing info
    return loadForgeExternalRepo(localPath, repoUrl);
  }

  db.logActivity('system', 'forge_analysis_clone_start', `Cloning for analysis: ${repoUrl}`, localPath);

  try {
    const git: SimpleGit = simpleGit();
    const cloneArgs = ['--depth', '1'];
    if (branch) cloneArgs.push('--branch', branch);
    await git.clone(repoUrl, localPath, cloneArgs);

    // Write metadata
    const meta = {
      sourceUrl: repoUrl,
      branch: branch || 'main',
      clonedAt: new Date().toISOString(),
      readOnly: true,
      purpose: 'MCP Forge adapter research',
      notes: '',
    };
    writeFileSync(join(localPath, '.forge-analysis.json'), JSON.stringify(meta, null, 2), 'utf-8');

    db.logActivity('system', 'forge_analysis_clone_done', `Analysis clone complete: ${repoName}`, localPath);

    return {
      name: repoName,
      localPath,
      sourceUrl: repoUrl,
      branch: branch || 'main',
      clonedAt: meta.clonedAt,
      notes: '',
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try { if (existsSync(localPath)) rmSync(localPath, { recursive: true, force: true }); } catch {}
    db.logActivity('system', 'forge_analysis_clone_fail', `Clone failed: ${repoUrl}`, errMsg, {}, 'error');
    throw new Error(`Failed to clone for analysis: ${errMsg}`);
  }
}

function loadForgeExternalRepo(localPath: string, sourceUrl: string): ForgeExternalRepo {
  const metaPath = join(localPath, '.forge-analysis.json');
  let meta: any = {};
  if (existsSync(metaPath)) {
    try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch {}
  }
  return {
    name: basename(localPath),
    localPath,
    sourceUrl: meta.sourceUrl || sourceUrl,
    branch: meta.branch || 'main',
    clonedAt: meta.clonedAt || '',
    notes: meta.notes || '',
  };
}

/**
 * List all repos in the forge analysis area.
 */
export function listForgeAnalysisRepos(): ForgeExternalRepo[] {
  const root = getForgeAnalysisRoot();
  const repos: ForgeExternalRepo[] = [];

  try {
    for (const dir of readdirSync(root)) {
      const fullPath = join(root, dir);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
        if (existsSync(join(fullPath, '.forge-analysis.json'))) {
          repos.push(loadForgeExternalRepo(fullPath, ''));
        }
      } catch {}
    }
  } catch {}

  return repos;
}

/**
 * Remove a forge analysis repo.
 */
export function removeForgeAnalysisRepo(localPath: string): boolean {
  const db = getDatabase();
  try {
    if (existsSync(localPath)) {
      rmSync(localPath, { recursive: true, force: true });
      db.logActivity('system', 'forge_analysis_removed', `Removed: ${basename(localPath)}`);
      return true;
    }
    return false;
  } catch { return false; }
}

// ─── AI Research for Adapter Strategy (Task 6) ───

/**
 * Research an application to inform adapter generation.
 * Uses the AI provider to analyze the app and suggest the best integration strategy.
 */
export async function researchAppForAdapter(
  appName: string,
  capReport: CapabilityReport,
  sessionId: string
): Promise<string> {
  const db = getDatabase();
  const provider = providerRegistry.getDefault() as ClaudeProvider | undefined;
  if (!provider) {
    return 'No AI provider configured — research unavailable. Configure a Claude API key in Settings.';
  }

  db.logActivity(sessionId, 'forge_research_start', `Researching: ${appName}`, '', { appName });

  const prompt = `You are a senior developer researching how to build an MCP (Model Context Protocol) server adapter for the application "${appName}".

Here is a capability scan report:
- App path: ${capReport.appPath}
- Detected capabilities: ${capReport.capabilities.map(c => `${c.type} (confidence: ${(c.confidence * 100).toFixed(0)}%)`).join(', ')}
- Recommended strategy: ${capReport.recommendedStrategy || 'unknown'}
- CLI help output (if any): ${capReport.cliHelpOutput ? capReport.cliHelpOutput.substring(0, 2000) : 'Not available'}
- Discovered files: ${capReport.discoveredArtifacts.slice(0, 20).join(', ')}

Please research and provide:
1. **Official Documentation**: What docs/SDKs exist for this application?
2. **CLI Reference**: If CLI-capable, what are the key commands and patterns?
3. **Existing MCP Servers/Wrappers**: Are there existing MCP servers or automation wrappers for this app?
4. **Integration Strategy Recommendation**: Based on your knowledge, what is the best way to build an MCP adapter?
5. **Risks & Limitations**: What could go wrong? What limitations should the user know about?
6. **Confidence Assessment**: How confident are you in this adapter working well?

Be concise and technical. Focus on actionable information for adapter generation.`;

  try {
    const response = await provider.sendMessage(
      [{ role: 'user', content: prompt }],
      undefined,
      'You are a software engineering researcher specializing in developer tools integration and MCP protocol adapters.'
    );

    const summary = response.content;

    db.logActivity(sessionId, 'forge_research_done', `Research complete: ${appName}`,
      summary.substring(0, 200), { appName, summaryLength: summary.length });

    return summary;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    db.logActivity(sessionId, 'forge_research_fail', `Research failed: ${appName}`, errMsg, {}, 'error');
    return `Research failed: ${errMsg}`;
  }
}
