/**
 * Internet Research & Cross-Repository Analysis — Sprint 13
 * Task 4: Research workflow, Task 5: External source download, Task 6: Deep research.
 *
 * Provides slash commands /research, /research-continue, /compare-repos.
 * Results are read-only and logged to activity.
 */

import { existsSync, mkdirSync, rmSync, readdirSync, statSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { getDatabase } from '../db';
import { providerRegistry, ClaudeProvider } from '../providers';

// ─── External Analysis Area ───

const ANALYSIS_DIR_NAME = '.gdeveloper';
const EXTERNAL_DIR_NAME = 'external-analysis';

export function getAnalysisRoot(workspacePath?: string): string {
  if (workspacePath) {
    return join(workspacePath, ANALYSIS_DIR_NAME, EXTERNAL_DIR_NAME);
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return join(home, ANALYSIS_DIR_NAME, EXTERNAL_DIR_NAME);
}

export function ensureAnalysisRoot(workspacePath?: string): string {
  const root = getAnalysisRoot(workspacePath);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

// ─── External Repo Download (Task 5) ───

export interface ExternalRepoInfo {
  name: string;
  localPath: string;
  sourceUrl: string;
  branch: string;
  clonedAt: string;
  /** Approximate size in bytes */
  sizeBytes: number;
  fileCount: number;
}

/**
 * Clone a public repository into the analysis area for read-only inspection.
 */
export async function downloadExternalRepo(
  repoUrl: string,
  workspacePath?: string,
  branch?: string
): Promise<ExternalRepoInfo> {
  const db = getDatabase();
  const root = ensureAnalysisRoot(workspacePath);

  // Extract repo name from URL
  const nameMatch = repoUrl.match(/\/([^/]+?)(?:\.git)?$/);
  const repoName = nameMatch ? nameMatch[1] : `repo-${Date.now()}`;
  const localPath = join(root, repoName);

  if (existsSync(localPath)) {
    // Already downloaded, return info
    return getExternalRepoInfo(localPath, repoUrl);
  }

  db.logActivity('system', 'external_clone_start', `Downloading: ${repoUrl}`, localPath);

  try {
    const git: SimpleGit = simpleGit();
    const cloneArgs = ['--depth', '1']; // shallow clone for analysis
    if (branch) cloneArgs.push('--branch', branch);

    await git.clone(repoUrl, localPath, cloneArgs);

    const info = await getExternalRepoInfo(localPath, repoUrl);

    // Save metadata
    writeFileSync(join(localPath, '.gdeveloper-analysis.json'), JSON.stringify({
      sourceUrl: repoUrl,
      branch: info.branch,
      clonedAt: info.clonedAt,
      readOnly: true,
    }, null, 2));

    db.logActivity('system', 'external_clone_done', `Downloaded: ${repoName}`,
      `${info.fileCount} files, ${(info.sizeBytes / 1024).toFixed(0)} KB`, {
        repoUrl, localPath, branch: info.branch
      });

    return info;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    db.logActivity('system', 'external_clone_failed', `Download failed: ${repoUrl}`, errMsg, {}, 'error');
    // Cleanup on failure
    try { if (existsSync(localPath)) rmSync(localPath, { recursive: true, force: true }); } catch {}
    throw new Error(`Failed to download repository: ${errMsg}`);
  }
}

async function getExternalRepoInfo(localPath: string, sourceUrl: string): Promise<ExternalRepoInfo> {
  const git: SimpleGit = simpleGit(localPath);
  const status = await git.status();

  let sizeBytes = 0;
  let fileCount = 0;
  function countDir(dir: string, depth: number) {
    if (depth > 5) return; // limit recursion
    try {
      for (const f of readdirSync(dir)) {
        if (f === '.git' || f === 'node_modules') continue;
        const full = join(dir, f);
        try {
          const st = statSync(full);
          if (st.isFile()) {
            sizeBytes += st.size;
            fileCount++;
          } else if (st.isDirectory()) {
            countDir(full, depth + 1);
          }
        } catch {}
      }
    } catch {}
  }
  countDir(localPath, 0);

  return {
    name: basename(localPath),
    localPath,
    sourceUrl,
    branch: status.current || 'main',
    clonedAt: new Date().toISOString(),
    sizeBytes,
    fileCount,
  };
}

/**
 * List all external repos in the analysis area.
 */
export function listExternalRepos(workspacePath?: string): ExternalRepoInfo[] {
  const root = getAnalysisRoot(workspacePath);
  if (!existsSync(root)) return [];

  const repos: ExternalRepoInfo[] = [];
  try {
    for (const dir of readdirSync(root)) {
      const fullPath = join(root, dir);
      try {
        const st = statSync(fullPath);
        if (!st.isDirectory()) continue;
        const metaFile = join(fullPath, '.gdeveloper-analysis.json');
        if (existsSync(metaFile)) {
          const meta = JSON.parse(readFileSync(metaFile, 'utf-8'));
          repos.push({
            name: dir,
            localPath: fullPath,
            sourceUrl: meta.sourceUrl || '',
            branch: meta.branch || 'main',
            clonedAt: meta.clonedAt || '',
            sizeBytes: 0,
            fileCount: 0,
          });
        }
      } catch {}
    }
  } catch {}
  return repos;
}

/**
 * Remove an external analysis copy.
 */
export function removeExternalRepo(localPath: string): boolean {
  const db = getDatabase();
  try {
    if (existsSync(localPath)) {
      rmSync(localPath, { recursive: true, force: true });
      db.logActivity('system', 'external_removed', `Removed analysis copy: ${basename(localPath)}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Deep Research Workflow (Task 6) ───

export interface ResearchReport {
  topic: string;
  plan: string[];
  sources: Array<{ url?: string; type: string; description: string }>;
  findings: string;
  recommendation: string;
  citations: string[];
  openQuestions: string[];
  timestamp: string;
}

export type ResearchStage = 'planning' | 'gathering' | 'reading' | 'synthesizing' | 'complete';

/**
 * Execute a deep research workflow using the AI provider.
 * Breaks question → gathers sources → cross-references → produces structured report.
 */
export async function executeResearch(
  question: string,
  sessionId: string,
  workspacePath?: string,
  onStage?: (stage: ResearchStage, detail: string) => void
): Promise<ResearchReport> {
  const db = getDatabase();
  const provider = providerRegistry.getDefault() as ClaudeProvider | undefined;
  if (!provider) throw new Error('No AI provider configured');

  db.logActivity(sessionId, 'research_started', `Research: ${question.substring(0, 80)}`, '', { question });

  onStage?.('planning', 'Breaking down research question...');

  // Step 1: Plan the research
  const planResponse = await provider.sendMessage(
    [{ role: 'user', content: `I need to research the following question. Break it into 3-5 specific sub-questions that I should investigate. Output ONLY a numbered list, nothing else.\n\nQuestion: ${question}` }],
    undefined,
    'You are a research planning assistant. Output concise, specific sub-questions as a numbered list.'
  );

  const plan = planResponse.content.split('\n').filter(l => l.trim().match(/^\d/)).map(l => l.trim());

  onStage?.('gathering', 'Analyzing workspace and context...');

  // Step 2: Gather context from workspace if available
  let workspaceContext = '';
  if (workspacePath && existsSync(workspacePath)) {
    try {
      // Read key files for context
      const keyFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'README.md', 'go.mod'];
      for (const f of keyFiles) {
        const fPath = join(workspacePath, f);
        if (existsSync(fPath)) {
          const content = readFileSync(fPath, 'utf-8').substring(0, 2000);
          workspaceContext += `\n--- ${f} ---\n${content}\n`;
        }
      }
    } catch {}
  }

  onStage?.('reading', 'Researching and cross-referencing...');

  // Step 3: Deep analysis
  const analysisPrompt = `Research this question thoroughly:\n\n"${question}"\n\nSub-questions to investigate:\n${plan.join('\n')}\n\n${workspaceContext ? `Workspace context:\n${workspaceContext}\n\n` : ''}Please provide a structured research report with:\n1. **Findings** - detailed analysis for each sub-question\n2. **Sources** - list any relevant documentation, repos, or standards you reference\n3. **Recommendation** - your best recommendation based on the findings\n4. **Open Questions** - any remaining unknowns\n\nBe thorough and technical. Cite specific technologies, patterns, and approaches.`;

  const analysisResponse = await provider.sendMessage(
    [{ role: 'user', content: analysisPrompt }],
    undefined,
    'You are a senior software engineering researcher. Provide thorough, technical research reports with practical recommendations.'
  );

  onStage?.('synthesizing', 'Preparing final report...');

  const report: ResearchReport = {
    topic: question,
    plan,
    sources: [],
    findings: analysisResponse.content,
    recommendation: '',
    citations: [],
    openQuestions: [],
    timestamp: new Date().toISOString(),
  };

  // Extract sections from the analysis
  const recMatch = analysisResponse.content.match(/\*\*Recommendation\*\*[:\s]*([^*]+?)(?:\*\*|$)/s);
  if (recMatch) report.recommendation = recMatch[1].trim();

  db.logActivity(sessionId, 'research_completed', `Research complete: ${question.substring(0, 60)}`,
    report.findings.substring(0, 200), {
      topic: question, planSteps: plan.length, findingsLength: report.findings.length
    });

  onStage?.('complete', 'Research complete');

  return report;
}

/**
 * Compare two repositories (or a workspace vs. an external repo).
 */
export async function compareRepos(
  repoA: string,
  repoB: string,
  sessionId: string,
  focus?: string
): Promise<string> {
  const db = getDatabase();
  const provider = providerRegistry.getDefault() as ClaudeProvider | undefined;
  if (!provider) throw new Error('No AI provider configured');

  // Gather info from both repos
  const contextA = gatherRepoContext(repoA);
  const contextB = gatherRepoContext(repoB);

  const prompt = `Compare these two repositories/projects:\n\n**Repository A:** ${basename(repoA)}\n${contextA}\n\n**Repository B:** ${basename(repoB)}\n${contextB}\n\n${focus ? `Focus area: ${focus}\n\n` : ''}Provide:\n1. **Feature comparison table** (markdown table)\n2. **Architecture differences**\n3. **Strengths and weaknesses** of each\n4. **Recommendation** - which is better for what use case\n5. **Risks** of each approach`;

  const response = await provider.sendMessage(
    [{ role: 'user', content: prompt }],
    undefined,
    'You are a senior software architect comparing projects. Be objective and thorough.'
  );

  db.logActivity(sessionId, 'repo_comparison', `Compared: ${basename(repoA)} vs ${basename(repoB)}`,
    response.content.substring(0, 200), {
      repoA, repoB, focus
    });

  return response.content;
}

function gatherRepoContext(repoPath: string): string {
  const parts: string[] = [`Path: ${repoPath}`];

  // Read key files
  const keyFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'README.md'];
  for (const f of keyFiles) {
    const fPath = join(repoPath, f);
    if (existsSync(fPath)) {
      try {
        const content = readFileSync(fPath, 'utf-8');
        parts.push(`\n--- ${f} ---\n${content.substring(0, 3000)}`);
      } catch {}
    }
  }

  // List top-level files
  try {
    const entries = readdirSync(repoPath).filter(f => !f.startsWith('.')).slice(0, 30);
    parts.push(`\nTop-level files: ${entries.join(', ')}`);
  } catch {}

  return parts.join('\n');
}
