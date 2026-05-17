import { getActiveSpecialistMode, listSpecialistModes, type SpecialistModeDefinition } from './specialistModes';

export type AgentAssignmentStatus = 'queued' | 'blocked' | 'ready';

export interface AgentAssignment {
  id: string;
  roleId: string;
  roleLabel: string;
  title: string;
  brief: string;
  dependsOn: string[];
  status: AgentAssignmentStatus;
  recommendedWorktree: boolean;
  contextPacket: string;
}

export interface AgentDelegationPlan {
  id: string;
  objective: string;
  coordinatorModeId: string;
  coordinatorModeLabel: string;
  createdAt: string;
  assignments: AgentAssignment[];
}

interface AgentMention {
  modeId: string;
  prompt: string;
}

const GENERAL_MENTION = 'general';

export function parseAgentMention(input: string, workspacePath?: string | null): AgentMention | null {
  const match = input.trim().match(/^@([A-Za-z0-9_-]+)\s+([\s\S]+)$/);
  if (!match) return null;

  const requested = match[1].toLowerCase();
  const prompt = match[2].trim();
  if (!prompt) return null;

  const modes = listSpecialistModes(workspacePath);
  if (requested === GENERAL_MENTION) {
    return { modeId: 'code', prompt };
  }

  const mode = modes.find(candidate => candidate.id === requested);
  return mode ? { modeId: mode.id, prompt } : null;
}

export function createAgentDelegationPlan(objective: string, workspacePath?: string | null): AgentDelegationPlan {
  const cleanObjective = objective.trim();
  if (!cleanObjective) {
    throw new Error('Delegation requires a goal or focused @mention prompt.');
  }
  const mention = parseAgentMention(cleanObjective, workspacePath);
  const effectiveObjective = mention?.prompt || cleanObjective;
  const modes = listSpecialistModes(workspacePath);
  const coordinatorMode = getActiveSpecialistMode(workspacePath);
  const assignments = mention
    ? [createAssignment(mustGetMode(modes, mention.modeId), effectiveObjective, 0, [], true)]
    : buildAssignments(effectiveObjective, modes);

  return {
    id: stablePlanId(effectiveObjective),
    objective: effectiveObjective,
    coordinatorModeId: coordinatorMode.id,
    coordinatorModeLabel: coordinatorMode.label,
    createdAt: new Date().toISOString(),
    assignments,
  };
}

export function formatAgentDelegationPlan(plan: AgentDelegationPlan): string {
  const lines = [
    `**Coordinator:** ${plan.coordinatorModeLabel} (\`${plan.coordinatorModeId}\`)`,
    `**Objective:** ${plan.objective}`,
    '',
    '**Sub-agent assignments:**',
  ];

  for (const assignment of plan.assignments) {
    const dependency = assignment.dependsOn.length > 0 ? ` after ${assignment.dependsOn.join(', ')}` : '';
    const worktree = assignment.recommendedWorktree ? 'isolated worktree recommended' : 'main context ok';
    lines.push(`- \`${assignment.id}\` ${assignment.roleLabel}: ${assignment.title}${dependency} (${worktree})`);
    lines.push(`  ${assignment.brief}`);
  }

  lines.push('', 'Use these as separate Agent Board cards or start a focused chat with `@general`, `@debug`, `@test`, etc.');
  return lines.join('\n');
}

function buildAssignments(objective: string, modes: SpecialistModeDefinition[]): AgentAssignment[] {
  const lowered = objective.toLowerCase();
  const assignments: AgentAssignment[] = [];
  const add = (modeId: string, title: string, brief: string, dependsOn: string[] = [], recommendedWorktree = true) => {
    assignments.push(createAssignment(mustGetMode(modes, modeId), `${title}: ${objective}`, assignments.length, dependsOn, recommendedWorktree, brief));
  };

  const needsArchitecture = /\b(architecture|design|migration|refactor|rewrite|api|schema|system|multi-agent|orchestration)\b/.test(lowered);
  const needsDebug = /\b(bug|fix|failure|failing|crash|regression|debug|error|broken)\b/.test(lowered);
  const needsTests = /\b(test|coverage|verify|qa|regression|e2e|unit)\b/.test(lowered);

  if (needsArchitecture) {
    add('architect', 'Frame contracts and risks', 'Map the design boundary, affected modules, invariants, and rollout plan.', [], false);
  }

  if (needsDebug) {
    add('debug', 'Reproduce and isolate failure', 'Find the smallest failing surface before proposing a repair.', [], false);
  }

  const implementationDeps = assignments.map(item => item.id);
  add('code', 'Implement the thin vertical slice', 'Make the smallest production change that satisfies the objective and follows local patterns.', implementationDeps, true);

  if (needsTests || needsDebug || needsArchitecture) {
    add('test', 'Verify behavior and guard against regressions', 'Add or strengthen focused checks around the changed behavior; watch for skipped or shallow assertions.', implementationDeps, false);
  }

  return assignments;
}

function createAssignment(
  mode: SpecialistModeDefinition,
  objective: string,
  index: number,
  dependsOn: string[] = [],
  recommendedWorktree = true,
  customBrief?: string
): AgentAssignment {
  const id = `agent-${index + 1}-${mode.id}`;
  const title = objective.length > 84 ? `${objective.slice(0, 81)}...` : objective;
  const brief = customBrief || mode.prompt;
  return {
    id,
    roleId: mode.id,
    roleLabel: mode.label,
    title,
    brief,
    dependsOn,
    status: dependsOn.length > 0 ? 'blocked' : 'ready',
    recommendedWorktree,
    contextPacket: [
      `Role: ${mode.label} (${mode.id})`,
      `Tool posture: ${mode.toolPolicy}`,
      `Objective: ${objective}`,
      dependsOn.length > 0 ? `Wait for: ${dependsOn.join(', ')}` : 'Can start immediately.',
      mode.prompt,
    ].join('\n'),
  };
}

function mustGetMode(modes: SpecialistModeDefinition[], id: string): SpecialistModeDefinition {
  const mode = modes.find(candidate => candidate.id === id);
  if (!mode) {
    throw new Error(`Unknown specialist mode for delegation: ${id}`);
  }
  return mode;
}

function stablePlanId(objective: string): string {
  let hash = 0;
  for (let i = 0; i < objective.length; i++) {
    hash = ((hash << 5) - hash + objective.charCodeAt(i)) | 0;
  }
  return `delegation-${Math.abs(hash).toString(36)}`;
}
