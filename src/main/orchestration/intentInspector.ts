import { getMCPManager } from '../mcp';
import { getActiveWorkspace } from '../tools';
import { estimatePromptTokens } from './agentRunTelemetry';
import { getActiveSpec } from './specDriven';
import { getActiveSpecialistMode } from './specialistModes';
import { getVibeLoopState } from './vibeLoop';
import {
  loadProjectRuleFiles,
  retrieveRelevantCodeChunks,
} from './projectContext';

export type IntentRiskLevel = 'low' | 'medium' | 'high';

export interface IntentInspectorInput {
  sessionId: string;
  message: string;
  workspacePath?: string;
  executionMode: 'plan' | 'build';
  provider?: string;
  model?: string;
  attachmentCount?: number;
}

export interface IntentContextSource {
  id: string;
  label: string;
  detail: string;
}

export interface IntentInspection {
  summary: string;
  riskLevel: IntentRiskLevel;
  recommendedAction: string;
  executionMode: 'plan' | 'build';
  specialistMode: {
    id: string;
    label: string;
    toolPolicy: string;
  };
  vibeLoop: {
    stage: string;
    note?: string;
  };
  activeSpec: {
    id: string;
    title: string;
    path: string;
  } | null;
  contextSources: IntentContextSource[];
  likelyActions: string[];
  riskNotes: string[];
  redirectControls: string[];
  relevantFiles: string[];
  estimatedPromptTokens: number;
  mcpToolCount: number;
  provider?: string;
  model?: string;
}

export function inspectIntent(input: IntentInspectorInput): IntentInspection {
  const workspacePath = input.workspacePath || getActiveWorkspace() || '';
  const message = input.message.trim();
  const specialistMode = getActiveSpecialistMode(workspacePath);
  const vibeLoop = getVibeLoopState(input.sessionId);
  const activeSpec = workspacePath ? getActiveSpec(workspacePath) : null;
  const projectRules = workspacePath ? loadProjectRuleFiles(workspacePath, 1200) : [];
  const mcpToolCount = countEnabledMCPTools();
  const likelyActions = inferLikelyActions(message, input.executionMode, specialistMode.toolPolicy);
  const relevantFiles = workspacePath && message
    ? retrieveRelevantCodeChunks(workspacePath, message, { maxChunks: 4, maxRagChars: 4000 }).map(chunk => chunk.path)
    : [];
  const riskNotes = inferRiskNotes({
    message,
    executionMode: input.executionMode,
    toolPolicy: specialistMode.toolPolicy,
    hasActiveSpec: !!activeSpec,
    likelyActions,
    mcpToolCount,
    relevantFiles,
  });
  const riskLevel = riskNotes.some(note => note.startsWith('High:'))
    ? 'high'
    : riskNotes.length > 0
      ? 'medium'
      : 'low';

  const contextSources: IntentContextSource[] = [
    { id: 'mode', label: 'Mode', detail: input.executionMode },
    { id: 'specialist', label: 'Specialist', detail: `${specialistMode.label} (${specialistMode.toolPolicy})` },
    { id: 'vibe-loop', label: 'Loop', detail: vibeLoop.note ? `${vibeLoop.stage}: ${vibeLoop.note}` : vibeLoop.stage },
  ];

  if (activeSpec) {
    contextSources.push({ id: 'active-spec', label: 'Spec', detail: activeSpec.title });
  }
  if (projectRules.length) {
    contextSources.push({ id: 'rules', label: 'Rules', detail: projectRules.map(rule => rule.filename).join(', ') });
  }
  if (relevantFiles.length) {
    contextSources.push({ id: 'retrieval', label: 'Retrieved Files', detail: relevantFiles.slice(0, 3).join(', ') });
  }
  if (input.attachmentCount) {
    contextSources.push({ id: 'attachments', label: 'Attachments', detail: `${input.attachmentCount} file(s)` });
  }
  if (mcpToolCount > 0) {
    contextSources.push({ id: 'mcp-tools', label: 'MCP Tools', detail: `${mcpToolCount} enabled` });
  }

  return {
    summary: summarizeIntent(message, likelyActions, input.executionMode),
    riskLevel,
    recommendedAction: recommendAction(riskLevel, input.executionMode, activeSpec?.title),
    executionMode: input.executionMode,
    specialistMode: {
      id: specialistMode.id,
      label: specialistMode.label,
      toolPolicy: specialistMode.toolPolicy,
    },
    vibeLoop: {
      stage: vibeLoop.stage,
      note: vibeLoop.note,
    },
    activeSpec: activeSpec ? {
      id: activeSpec.id,
      title: activeSpec.title,
      path: activeSpec.relativePath,
    } : null,
    contextSources,
    likelyActions,
    riskNotes,
    redirectControls: [
      'Switch Plan/Build before sending',
      'Change specialist mode',
      'Activate or create a spec',
      'Narrow file scope in the prompt',
      'Stop the run while streaming',
    ],
    relevantFiles: unique(relevantFiles),
    estimatedPromptTokens: estimatePromptTokens(message, [], []) + projectRules.reduce((sum, rule) => sum + Math.ceil(rule.content.length / 4), 0),
    mcpToolCount,
    provider: input.provider,
    model: input.model,
  };
}

export function formatIntentInspectionMarkdown(inspection: IntentInspection): string {
  return [
    `**Intent Inspector:** ${inspection.summary}`,
    '',
    `Risk: \`${inspection.riskLevel}\``,
    `Recommended action: ${inspection.recommendedAction}`,
    '',
    '**Context:**',
    ...inspection.contextSources.map(source => `- ${source.label}: ${source.detail}`),
    '',
    '**Likely actions:**',
    ...inspection.likelyActions.map(action => `- ${action}`),
    inspection.riskNotes.length ? '\n**Risk notes:**' : '',
    ...inspection.riskNotes.map(note => `- ${note}`),
    inspection.relevantFiles.length ? '\n**Relevant files:**' : '',
    ...inspection.relevantFiles.slice(0, 6).map(file => `- ${file}`),
  ].filter(Boolean).join('\n');
}

function countEnabledMCPTools(): number {
  try {
    return getMCPManager().getServers()
      .filter(server => server.status === 'connected')
      .reduce((sum, server) => sum + server.tools.filter(tool => tool.enabled !== false).length, 0);
  } catch {
    return 0;
  }
}

function inferLikelyActions(message: string, executionMode: 'plan' | 'build', toolPolicy: string): string[] {
  const lower = message.toLowerCase();
  const actions: string[] = [];

  if (!message) return ['wait for a prompt'];
  if (/\b(explain|why|what|where|how|review|analyze|inspect)\b/.test(lower)) actions.push('read and explain code');
  if (/\b(add|implement|create|build|fix|repair|update|refactor|remove|delete)\b/.test(lower)) actions.push('change files');
  if (/\b(tests?|typecheck|verify|verification|lint|build)\b/.test(lower)) actions.push('run verification commands');
  if (/\b(commit|branch|worktree|merge|push|pr)\b/.test(lower)) actions.push('use git workflow tools');
  if (/\b(mcp|server|tool|integration)\b/.test(lower)) actions.push('inspect MCP/tool configuration');

  if (executionMode === 'plan' || toolPolicy === 'read-only') {
    return unique(actions.map(action => action === 'change files' ? 'plan file changes without editing' : action));
  }

  return unique(actions.length ? actions : ['answer directly']);
}

function inferRiskNotes(input: {
  message: string;
  executionMode: 'plan' | 'build';
  toolPolicy: string;
  hasActiveSpec: boolean;
  likelyActions: string[];
  mcpToolCount: number;
  relevantFiles: string[];
}): string[] {
  const lower = input.message.toLowerCase();
  const notes: string[] = [];
  const wantsEdits = input.likelyActions.includes('change files');

  if (input.executionMode === 'build' && wantsEdits && !input.hasActiveSpec) {
    notes.push('No active spec is attached to this edit request.');
  }
  if (input.executionMode === 'build' && /\b(all|entire|everything|whole app|rewrite|mass|global)\b/.test(lower)) {
    notes.push('High: broad edit language can expand scope quickly.');
  }
  if (input.toolPolicy === 'read-only' && wantsEdits) {
    notes.push('Read-only specialist mode will prevent direct edits.');
  }
  if (input.mcpToolCount > 25) {
    notes.push('Many MCP tools are enabled; request cost and latency may rise.');
  }
  if (wantsEdits && input.relevantFiles.length === 0) {
    notes.push('No relevant files were retrieved from the prompt yet.');
  }
  if (/\b(secret|token|password|api key|credential)\b/.test(lower)) {
    notes.push('High: prompt mentions sensitive credential-like material.');
  }

  return notes;
}

function summarizeIntent(message: string, likelyActions: string[], executionMode: 'plan' | 'build'): string {
  if (!message.trim()) return 'Waiting for a prompt.';
  const firstAction = likelyActions[0] || 'answer directly';
  return `${executionMode === 'plan' ? 'Plan' : 'Build'} mode will likely ${firstAction}.`;
}

function recommendAction(riskLevel: IntentRiskLevel, executionMode: 'plan' | 'build', specTitle?: string): string {
  if (riskLevel === 'high') return 'Narrow the prompt or switch to Plan before sending.';
  if (riskLevel === 'medium' && executionMode === 'build' && !specTitle) return 'Attach a spec or name a tight file scope.';
  if (riskLevel === 'medium') return 'Review context and scope before sending.';
  return 'Ready to send.';
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
