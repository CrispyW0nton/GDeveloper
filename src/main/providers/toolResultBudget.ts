/**
 * Tool-Result Budgeting System — Sprint 21
 *
 * Caps token size per tool result, truncates with a marker,
 * stores full results locally, and provides UI hooks to expand/collapse.
 * Also manages parallel MCP tool-call concurrency.
 */

import { TokenBudgetConfig, DEFAULT_TOKEN_BUDGET_CONFIG } from './rateLimitConfig';
import { estimateTokens } from './contextManager';

// ─── Types ───

export interface ToolResultEntry {
  id: string;
  toolName: string;
  /** Truncated result included in the prompt */
  truncatedResult: string;
  truncatedTokens: number;
  /** Full result stored locally */
  fullResult: string;
  fullTokens: number;
  /** Whether the result was truncated */
  wasTruncated: boolean;
  /** Whether user has opted to include full result in next prompt */
  includeFullInNextPrompt: boolean;
  /** Timestamp */
  timestamp: number;
}

export interface ParallelToolCallConfig {
  maxConcurrency: number;
  prioritiseLightweight: boolean;
  warnOnLargeOutputTools: boolean;
  disableParallelCalls: boolean;
}

/** Tools known to produce potentially large outputs */
const HEAVY_OUTPUT_TOOLS = new Set([
  'Read', 'read_file', 'search_files', 'list_directory',
  'parallel_search', 'parallel_read', 'summarize_large_document',
  'bash', 'terminal_execute', 'execute_command',
  'Glob', 'Grep', 'LS',
]);

// ─── Tool Result Manager ───

export class ToolResultBudget {
  private config: TokenBudgetConfig;
  private results: ToolResultEntry[] = [];
  private maxRetained: number;

  constructor(config?: TokenBudgetConfig) {
    this.config = config ?? { ...DEFAULT_TOKEN_BUDGET_CONFIG };
    this.maxRetained = this.config.maxToolResultsRetained;
  }

  updateConfig(config: TokenBudgetConfig): void {
    this.config = config;
    this.maxRetained = config.maxToolResultsRetained;
    // Evict if the retained limit shrunk
    this.evictOldest();
  }

  /**
   * Process a raw tool result: truncate if needed, store full version.
   * Returns the (possibly truncated) result to include in the prompt.
   */
  processToolResult(
    toolName: string,
    rawResult: string,
    toolCallId?: string,
  ): ToolResultEntry {
    const fullTokens = estimateTokens(rawResult);
    const maxTokens = this.config.maxToolResultTokensPerTool;
    const id = toolCallId || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let truncatedResult = rawResult;
    let truncatedTokens = fullTokens;
    let wasTruncated = false;

    if (fullTokens > maxTokens) {
      // Truncate: keep first M tokens' worth of characters
      const maxChars = maxTokens * 4; // rough inverse of estimateTokens
      truncatedResult = rawResult.slice(0, maxChars);
      truncatedResult += `\n\n[truncated: original ${fullTokens.toLocaleString()} tokens, showing first ${estimateTokens(truncatedResult).toLocaleString()}]`;
      truncatedTokens = estimateTokens(truncatedResult);
      wasTruncated = true;
    }

    const entry: ToolResultEntry = {
      id,
      toolName,
      truncatedResult,
      truncatedTokens,
      fullResult: rawResult,
      fullTokens,
      wasTruncated,
      includeFullInNextPrompt: false,
      timestamp: Date.now(),
    };

    this.results.push(entry);
    this.evictOldest();

    return entry;
  }

  /** Get all retained results */
  getRetainedResults(): ToolResultEntry[] {
    return [...this.results];
  }

  /** Get a specific result by ID */
  getResultById(id: string): ToolResultEntry | undefined {
    return this.results.find(r => r.id === id);
  }

  /** Mark a result to include its full version in the next prompt */
  setIncludeFullInNextPrompt(id: string, include: boolean): void {
    const entry = this.results.find(r => r.id === id);
    if (entry) {
      entry.includeFullInNextPrompt = include;
    }
  }

  /** Get results that should be included in full in the next prompt */
  getFullInclusionResults(): ToolResultEntry[] {
    return this.results.filter(r => r.includeFullInNextPrompt);
  }

  /** Clear the inclusion flag after the prompt is built */
  clearFullInclusionFlags(): void {
    for (const r of this.results) {
      r.includeFullInNextPrompt = false;
    }
  }

  /** Clear all stored results */
  clear(): void {
    this.results = [];
  }

  // ─── Parallel Tool-Call Management ───

  getParallelConfig(): ParallelToolCallConfig {
    return {
      maxConcurrency: this.config.maxParallelToolCalls,
      prioritiseLightweight: true,
      warnOnLargeOutputTools: true,
      disableParallelCalls: this.config.maxParallelToolCalls <= 1,
    };
  }

  /** Check if a tool is known to produce heavy output */
  isHeavyTool(toolName: string): boolean {
    return HEAVY_OUTPUT_TOOLS.has(toolName);
  }

  /**
   * Given a list of pending tool calls, partition them into batches
   * respecting concurrency limits and prioritising lightweight tools.
   */
  planToolCallBatches(
    pendingTools: Array<{ name: string; id: string; input: any }>
  ): Array<Array<{ name: string; id: string; input: any }>> {
    const parallelConfig = this.getParallelConfig();

    if (parallelConfig.disableParallelCalls) {
      // Sequential: one tool per batch
      return pendingTools.map(t => [t]);
    }

    const batches: Array<Array<{ name: string; id: string; input: any }>> = [];

    // Separate lightweight and heavy tools
    const lightweight = pendingTools.filter(t => !this.isHeavyTool(t.name));
    const heavy = pendingTools.filter(t => this.isHeavyTool(t.name));

    // Batch lightweight tools up to concurrency limit
    if (parallelConfig.prioritiseLightweight) {
      for (let i = 0; i < lightweight.length; i += parallelConfig.maxConcurrency) {
        batches.push(lightweight.slice(i, i + parallelConfig.maxConcurrency));
      }
      // Heavy tools run one at a time
      for (const t of heavy) {
        batches.push([t]);
      }
    } else {
      // Simple batching
      for (let i = 0; i < pendingTools.length; i += parallelConfig.maxConcurrency) {
        batches.push(pendingTools.slice(i, i + parallelConfig.maxConcurrency));
      }
    }

    return batches;
  }

  /** Pre-flight warning for potentially huge tool outputs */
  getWarnings(toolNames: string[]): string[] {
    const warnings: string[] = [];
    const heavyTools = toolNames.filter(n => this.isHeavyTool(n));
    if (heavyTools.length > 0) {
      warnings.push(
        `Tools with potentially large output: ${heavyTools.join(', ')}. ` +
        `Results will be capped at ${this.config.maxToolResultTokensPerTool.toLocaleString()} tokens each.`
      );
    }
    if (toolNames.length > this.config.maxParallelToolCalls) {
      warnings.push(
        `${toolNames.length} tool calls requested but concurrency is capped at ${this.config.maxParallelToolCalls}. ` +
        `Tools will run in batches.`
      );
    }
    return warnings;
  }

  // ─── Internals ───

  private evictOldest(): void {
    while (this.results.length > this.maxRetained) {
      this.results.shift();
    }
  }
}

// ─── Singleton ───

let toolResultBudgetInstance: ToolResultBudget | null = null;

export function getToolResultBudget(): ToolResultBudget {
  if (!toolResultBudgetInstance) {
    toolResultBudgetInstance = new ToolResultBudget();
  }
  return toolResultBudgetInstance;
}
