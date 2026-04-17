/**
 * Context Window Manager — Sprint 21
 *
 * Ensures each API request fits within maxContextTokensPerRequest.
 *
 * Priority slots (always included):
 *   1. System prompt
 *   2. Active task plan (if any)
 *   3. Tool call state (pending tool calls)
 *   4. Workspace metadata (branch, files, worktree)
 *   5. Recent N messages (configurable)
 *
 * Older assistant messages and tool results are either:
 *   a) Summarised (preferred) — compressed to ~20% of original tokens
 *   b) Truncated (fallback) — hard-trim oldest-first
 *
 * Context budget = maxContextTokensPerRequest
 *   - systemPromptTokens
 *   - taskPlanTokens
 *   - toolCallStateTokens
 *   - workspaceMetadataTokens
 *   = remaining budget for conversation messages
 */

import { TokenBudgetConfig, DEFAULT_TOKEN_BUDGET_CONFIG } from './rateLimitConfig';

// ─── Types ───

export interface ContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool-result messages carry the originating tool name */
  toolName?: string;
  /** Estimated token count (roughly content.length / 4) */
  tokens?: number;
  /** Whether this message is a priority slot (always kept) */
  priority?: boolean;
  /** Message timestamp for ordering */
  timestamp?: string;
}

export interface ContextBuildResult {
  messages: ContextMessage[];
  totalTokens: number;
  trimmedCount: number;
  summarisedCount: number;
  /** If context was trimmed or summarised */
  wasCompacted: boolean;
}

// ─── Token Estimation ───

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 chars per token for English (same heuristic as ClaudeProvider.countTokens)
  return Math.ceil(text.length / 4);
}

// ─── Context Manager ───

export class ContextManager {
  private config: TokenBudgetConfig;

  constructor(config?: TokenBudgetConfig) {
    this.config = config ?? { ...DEFAULT_TOKEN_BUDGET_CONFIG };
  }

  updateConfig(config: TokenBudgetConfig): void {
    this.config = config;
  }

  /**
   * Build a context-window payload from the full conversation history.
   *
   * @param systemPrompt - System prompt text (always slot 1)
   * @param messages - Full conversation history (oldest-first)
   * @param taskPlan - Optional stringified task plan
   * @param toolCallState - Optional pending tool call context
   * @param workspaceMeta - Optional workspace/worktree metadata
   */
  buildContext(
    systemPrompt: string,
    messages: ContextMessage[],
    taskPlan?: string,
    toolCallState?: string,
    workspaceMeta?: string,
  ): ContextBuildResult {
    const maxTokens = this.config.maxContextTokensPerRequest;
    const maxMessages = this.config.maxConversationHistoryMessages;

    // 1. Reserve tokens for priority slots
    const systemTokens = estimateTokens(systemPrompt);
    const taskPlanTokens = taskPlan ? estimateTokens(taskPlan) : 0;
    const toolCallStateTokens = toolCallState ? estimateTokens(toolCallState) : 0;
    const workspaceMetaTokens = workspaceMeta ? estimateTokens(workspaceMeta) : 0;

    const reservedTokens = systemTokens + taskPlanTokens + toolCallStateTokens + workspaceMetaTokens;
    let remainingBudget = Math.max(0, maxTokens - reservedTokens);

    // 2. Tag each message with token count
    const taggedMessages = messages.map(m => ({
      ...m,
      tokens: m.tokens ?? estimateTokens(m.content),
    }));

    // 3. Separate priority messages (system) from conversation
    const systemMessages = taggedMessages.filter(m => m.role === 'system' || m.priority);
    const conversationMessages = taggedMessages.filter(m => m.role !== 'system' && !m.priority);

    // 4. Take the most recent N messages
    const recentMessages = conversationMessages.slice(-maxMessages);
    const olderMessages = conversationMessages.slice(0, -maxMessages);

    // 5. Calculate recent messages token cost
    let recentTokens = recentMessages.reduce((s, m) => s + (m.tokens || 0), 0);
    let trimmedCount = 0;
    let summarisedCount = 0;

    // 6. If recent messages fit, include them all
    const resultMessages: ContextMessage[] = [];

    // Add system prompt as first message
    resultMessages.push({
      role: 'system',
      content: systemPrompt,
      tokens: systemTokens,
      priority: true,
    });

    // Add task plan if present
    if (taskPlan) {
      resultMessages.push({
        role: 'system',
        content: `[Active Task Plan]\n${taskPlan}`,
        tokens: taskPlanTokens,
        priority: true,
      });
    }

    // Add workspace metadata
    if (workspaceMeta) {
      resultMessages.push({
        role: 'system',
        content: `[Workspace Context]\n${workspaceMeta}`,
        tokens: workspaceMetaTokens,
        priority: true,
      });
    }

    // Add tool call state
    if (toolCallState) {
      resultMessages.push({
        role: 'system',
        content: `[Pending Tool Calls]\n${toolCallState}`,
        tokens: toolCallStateTokens,
        priority: true,
      });
    }

    // 7. If recent messages exceed remaining budget, trim/summarise them
    if (recentTokens > remainingBudget) {
      // Try summarising older recent messages first
      const keptRecent: ContextMessage[] = [];
      let keptTokens = 0;

      // Work backwards (newest-first), keep as many as fit
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i];
        const msgTokens = msg.tokens || 0;
        if (keptTokens + msgTokens <= remainingBudget) {
          keptRecent.unshift(msg);
          keptTokens += msgTokens;
        } else {
          // Try to summarise this message instead
          const summary = this.summariseMessage(msg);
          const summaryTokens = estimateTokens(summary.content);
          if (keptTokens + summaryTokens <= remainingBudget) {
            keptRecent.unshift(summary);
            keptTokens += summaryTokens;
            summarisedCount++;
          } else {
            trimmedCount++;
          }
        }
      }

      resultMessages.push(...keptRecent);
      recentTokens = keptTokens;
    } else {
      // All recent messages fit — add a summary of older messages if they exist
      remainingBudget -= recentTokens;

      if (olderMessages.length > 0 && remainingBudget > 200) {
        const olderSummary = this.summariseMessageBatch(olderMessages);
        const olderSummaryTokens = estimateTokens(olderSummary.content);

        if (olderSummaryTokens <= remainingBudget) {
          resultMessages.push(olderSummary);
          summarisedCount += olderMessages.length;
        } else {
          trimmedCount += olderMessages.length;
        }
      } else {
        trimmedCount += olderMessages.length;
      }

      resultMessages.push(...recentMessages);
    }

    const totalTokens = resultMessages.reduce((s, m) => s + (m.tokens || estimateTokens(m.content)), 0);

    return {
      messages: resultMessages,
      totalTokens,
      trimmedCount,
      summarisedCount,
      wasCompacted: trimmedCount > 0 || summarisedCount > 0,
    };
  }

  // ─── Summarisation Helpers ───

  /** Compress a single message to ~20% of original size */
  private summariseMessage(msg: ContextMessage): ContextMessage {
    const content = msg.content;
    const originalTokens = estimateTokens(content);

    if (msg.role === 'tool') {
      // Tool results: keep first 200 chars + truncation marker
      const truncated = content.length > 800
        ? content.slice(0, 800) + `\n[...truncated: ${originalTokens} tokens → ${estimateTokens(content.slice(0, 800))} shown]`
        : content;
      return {
        ...msg,
        content: truncated,
        tokens: estimateTokens(truncated),
      };
    }

    if (msg.role === 'assistant') {
      // Keep first 400 chars as summary
      const summary = content.length > 1600
        ? content.slice(0, 1600) + `\n[...summarised from ${originalTokens} tokens]`
        : content;
      return {
        ...msg,
        content: summary,
        tokens: estimateTokens(summary),
      };
    }

    // User messages: keep as-is (usually short) or truncate
    if (content.length > 2000) {
      const truncated = content.slice(0, 2000) + '\n[...truncated]';
      return { ...msg, content: truncated, tokens: estimateTokens(truncated) };
    }

    return msg;
  }

  /** Summarise a batch of older messages into one summary block */
  private summariseMessageBatch(messages: ContextMessage[]): ContextMessage {
    const totalTokens = messages.reduce((s, m) => s + (m.tokens || estimateTokens(m.content)), 0);
    const userMsgs = messages.filter(m => m.role === 'user');
    const assistantMsgs = messages.filter(m => m.role === 'assistant');
    const toolMsgs = messages.filter(m => m.role === 'tool');

    const lines = [
      `[Earlier Conversation Summary — ${messages.length} messages, ~${totalTokens} tokens]`,
      `User messages: ${userMsgs.length}`,
      `Assistant messages: ${assistantMsgs.length}`,
      `Tool results: ${toolMsgs.length}`,
    ];

    // Add brief excerpts from user messages
    for (const m of userMsgs.slice(-3)) {
      const excerpt = m.content.slice(0, 150).replace(/\n/g, ' ');
      lines.push(`User: ${excerpt}...`);
    }

    // Add brief excerpts from assistant messages
    for (const m of assistantMsgs.slice(-2)) {
      const excerpt = m.content.slice(0, 150).replace(/\n/g, ' ');
      lines.push(`Assistant: ${excerpt}...`);
    }

    const content = lines.join('\n');
    return {
      role: 'system',
      content,
      tokens: estimateTokens(content),
      priority: false,
    };
  }

  /** Public helper for one-click "Summarize this conversation" */
  summariseConversation(messages: ContextMessage[]): ContextMessage {
    return this.summariseMessageBatch(messages);
  }

  /** Public helper for "Compact history" — trim to last N messages + summary */
  compactHistory(messages: ContextMessage[], keepLast = 5): { kept: ContextMessage[]; summary: ContextMessage; trimmedCount: number } {
    if (messages.length <= keepLast) {
      return { kept: messages, summary: { role: 'system', content: '', tokens: 0 }, trimmedCount: 0 };
    }

    const older = messages.slice(0, -keepLast);
    const recent = messages.slice(-keepLast);
    const summary = this.summariseMessageBatch(older);

    return {
      kept: recent,
      summary,
      trimmedCount: older.length,
    };
  }
}

// ─── Singleton ───

let contextManagerInstance: ContextManager | null = null;

export function getContextManager(): ContextManager {
  if (!contextManagerInstance) {
    contextManagerInstance = new ContextManager();
  }
  return contextManagerInstance;
}
