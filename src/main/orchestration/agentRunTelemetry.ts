export interface ToolLineageEntry {
  name: string;
  count: number;
  errors: number;
  source?: 'local' | 'mcp' | 'unknown';
}

export interface AgentRunAccumulator {
  tools: Map<string, ToolLineageEntry>;
  filesTouched: Set<string>;
  testsRun: string[];
}

export function createAgentRunAccumulator(): AgentRunAccumulator {
  return {
    tools: new Map(),
    filesTouched: new Set(),
    testsRun: [],
  };
}

export function recordToolLineage(
  accumulator: AgentRunAccumulator,
  toolName: string,
  input: any,
  isError: boolean,
  source: 'local' | 'mcp' | 'unknown' = 'unknown',
): void {
  const current = accumulator.tools.get(toolName) || { name: toolName, count: 0, errors: 0, source };
  current.count += 1;
  if (isError) current.errors += 1;
  current.source = current.source === 'unknown' ? source : current.source;
  accumulator.tools.set(toolName, current);

  if (!isError) {
    for (const filePath of extractTouchedFiles(toolName, input)) {
      accumulator.filesTouched.add(filePath);
    }
  }

  const testCommand = extractTestCommand(toolName, input);
  if (testCommand && !accumulator.testsRun.includes(testCommand)) {
    accumulator.testsRun.push(testCommand);
  }
}

export function serializeAgentRunAccumulator(accumulator: AgentRunAccumulator): {
  tools: ToolLineageEntry[];
  filesTouched: string[];
  testsRun: string[];
} {
  return {
    tools: Array.from(accumulator.tools.values()).sort((a, b) => a.name.localeCompare(b.name)),
    filesTouched: Array.from(accumulator.filesTouched.values()).sort(),
    testsRun: [...accumulator.testsRun],
  };
}

export function estimatePromptTokens(systemPrompt: string, messages: Array<{ content: string }>, tools: any[]): number {
  const messageChars = messages.reduce((sum, message) => sum + (message.content?.length || 0), 0);
  let toolChars = 0;
  try {
    toolChars = JSON.stringify(tools || []).length;
  } catch {
    toolChars = 0;
  }
  return Math.ceil(((systemPrompt?.length || 0) + messageChars + toolChars) / 4);
}

export function extractTouchedFiles(toolName: string, input: any): string[] {
  const normalized = normalizePath(input?.path || input?.file_path || input?.filePath);
  if (['write_file', 'patch_file', 'multi_edit'].includes(toolName) && normalized) {
    return [normalized];
  }
  if (toolName === 'compare_apply_hunk' || toolName === 'sync_preview') return [];
  return [];
}

export function extractTestCommand(toolName: string, input: any): string | null {
  if (!['run_command', 'bash_command'].includes(toolName)) return null;
  const command = String(input?.command || '').trim();
  if (!command) return null;
  return looksLikeTestCommand(command) ? command.slice(0, 240) : null;
}

export function looksLikeTestCommand(command: string): boolean {
  return /\b(npm|pnpm|yarn)\s+(run\s+)?(test|typecheck|build|lint)\b/i.test(command)
    || /\b(npx\s+)?vitest\b/i.test(command)
    || /\b(pytest|ruff|mypy|cargo\s+test|go\s+test|dotnet\s+test|gradle\s+test|mvn\s+test)\b/i.test(command);
}

function normalizePath(value: any): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.replace(/\\/g, '/');
}
