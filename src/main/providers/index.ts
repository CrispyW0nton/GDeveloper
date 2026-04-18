/**
 * LLM Provider Abstraction Layer
 * Real Claude provider with streaming via Anthropic Messages API
 * Supports Claude, OpenAI-compatible, and custom providers
 *
 * Sprint 16: dynamic model discovery, model selection, compatibility checks.
 * Sprint 34: Hardened SSE parsing — CRLF-aware buffer, verbose error logging,
 *            empty-input guard on content_block_stop, no silent drops.
 */

import { ILLMProvider, LLMResponse, LLMStreamChunk } from '../domain/interfaces';
import { ToolDefinition } from '../domain/entities';
import { BrowserWindow } from 'electron';
import { getRateLimiter } from './rateLimiter';
import { getRetryHandler, parseRateLimitHeaders } from './retryHandler';
import { getToolResultBudget } from './toolResultBudget';
import { getContextManager, estimateTokens, type ContextMessage } from './contextManager';

// ─── Sprint 35: Context-window hygiene (ported from Cline) ─────────────────

/**
 * Sprint 35: Maximum safe payload size per model family.
 * Claude models have a 200k context window; we target 160k to leave
 * headroom for the response and avoid silent server-side truncation.
 */
export function getMaxAllowedSize(model: string): number {
  // All current Claude models: 200k window → 160k safe input budget
  if (model.includes('claude')) return 160_000;
  // GPT-4 Turbo / o1: 128k window → 100k
  if (model.includes('gpt-4')) return 100_000;
  // Fallback for unknown models: conservative 80k
  return 80_000;
}

/**
 * Sprint 35 Fix 3: Truncate conversation to fit within the model's input budget.
 *
 * Strategy (half/quarter keep):
 *   1. Always preserve messages[0..1] (first user + first assistant = the original task).
 *   2. Estimate total tokens of system + messages.
 *   3. If under budget → return as-is.
 *   4. First pass: keep first 2 messages + the last HALF of the remaining messages.
 *   5. If still over: keep first 2 + the last QUARTER.
 *   6. Inject a truncation notice so the model knows context was removed.
 *
 * Returns { messages, wasTruncated, originalTokens, truncatedTokens }.
 */
export function truncateIfNeeded(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  model: string,
): { messages: Array<{ role: string; content: string }>; wasTruncated: boolean; originalTokens: number; truncatedTokens: number } {
  const maxTokens = getMaxAllowedSize(model);
  const systemTokens = estimateTokens(systemPrompt);
  const msgTokens = messages.map(m => estimateTokens(m.content));
  const totalTokens = systemTokens + msgTokens.reduce((a, b) => a + b, 0);

  if (totalTokens <= maxTokens) {
    return { messages, wasTruncated: false, originalTokens: totalTokens, truncatedTokens: totalTokens };
  }

  // Sprint 35 Fix 5: Always preserve the first user-assistant pair (the original task)
  const firstChunkSize = Math.min(2, messages.length);
  const firstChunk = messages.slice(0, firstChunkSize);
  const rest = messages.slice(firstChunkSize);

  const firstChunkTokens = firstChunk.reduce((s, m) => s + estimateTokens(m.content), 0);
  const budget = maxTokens - systemTokens - firstChunkTokens - 200; // 200 token buffer for truncation notice

  // Half keep
  const halfIdx = Math.floor(rest.length / 2);
  const halfSlice = rest.slice(halfIdx);
  const halfTokens = halfSlice.reduce((s, m) => s + estimateTokens(m.content), 0);

  let kept: Array<{ role: string; content: string }>;
  if (halfTokens <= budget) {
    kept = halfSlice;
  } else {
    // Quarter keep
    const quarterIdx = Math.floor(rest.length * 3 / 4);
    kept = rest.slice(quarterIdx);
  }

  // Inject truncation notice between firstChunk and kept messages
  const truncationNotice = {
    role: 'user',
    content: '[NOTE] Some previous conversation history has been removed to maintain optimal context window length. The initial user task has been retained for continuity. Pay special attention to the user\'s latest messages.',
  };

  const truncated = [...firstChunk, truncationNotice, ...kept];
  const truncatedTokens = systemTokens + truncated.reduce((s, m) => s + estimateTokens(m.content), 0);

  console.log(`[Sprint35:truncation] ${totalTokens} tokens → ${truncatedTokens} tokens (${messages.length} msgs → ${truncated.length} msgs, model=${model}, maxAllowed=${maxTokens})`);

  return { messages: truncated, wasTruncated: true, originalTokens: totalTokens, truncatedTokens };
}

/**
 * Sprint 35 Fix 4: Ensure every tool_use block has a matching tool_result,
 * and strip orphan tool_results that have no preceding tool_use.
 *
 * Ported from Cline's ensureToolResultsFollowToolUse pattern.
 * - Scans messages for assistant messages containing tool_use blocks.
 * - For each tool_use, checks that the NEXT user message contains the tool result.
 * - If a tool_use has no matching tool_result, injects a synthetic one.
 * - If an orphan tool_result exists with no preceding tool_use, strips it.
 *
 * Works on the serialized message format used in GDeveloper where assistant
 * messages with tool calls store JSON-stringified content blocks.
 */
export function ensureToolResultsFollowToolUse(
  messages: Array<{ role: string; content: string }>,
): { messages: Array<{ role: string; content: string }>; orphansFixed: number; orphansStripped: number } {
  let orphansFixed = 0;
  let orphansStripped = 0;
  const result: Array<{ role: string; content: string }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'assistant') {
      // Check if this assistant message contains tool_use blocks
      let toolUseIds: string[] = [];
      try {
        const parsed = JSON.parse(msg.content);
        if (Array.isArray(parsed)) {
          toolUseIds = parsed
            .filter((block: any) => block.type === 'tool_use' && block.id)
            .map((block: any) => block.id);
        }
      } catch {
        // Not JSON content (plain text assistant response) — no tool_use blocks
      }

      result.push(msg);

      if (toolUseIds.length > 0) {
        // Look ahead: the next message should be a user message with tool results
        const nextMsg = messages[i + 1];
        if (!nextMsg || nextMsg.role !== 'user') {
          // Missing tool_result — inject synthetic one for each tool_use
          const syntheticResults = toolUseIds.map(id =>
            `[Tool Result: synthetic]\n{"error": "Tool result was lost due to context truncation.", "tool_use_id": "${id}"}`
          ).join('\n\n');

          result.push({ role: 'user', content: syntheticResults });
          orphansFixed += toolUseIds.length;
          console.log(`[Sprint35:orphan-tool-fixed] Injected ${toolUseIds.length} synthetic tool_results after assistant msg ${i}`);
        } else if (nextMsg.role === 'user') {
          // Verify the user message contains results for all tool_use IDs
          const hasAllResults = toolUseIds.every(id => nextMsg.content.includes(id));
          if (!hasAllResults) {
            // Partial results — still push the next message as-is but log
            console.warn(`[Sprint35:orphan-tool-partial] Assistant msg ${i} had ${toolUseIds.length} tool_use blocks but next user msg may be missing some results`);
          }
        }
      }
    } else if (msg.role === 'user') {
      // Check for orphan tool_result in user messages (tool_result without preceding tool_use)
      const hasToolResult = msg.content.includes('[Tool Result:');
      if (hasToolResult && i > 0) {
        const prevMsg = messages[i - 1];
        if (prevMsg?.role !== 'assistant') {
          // Orphan tool_result — strip it
          orphansStripped++;
          console.log(`[Sprint35:orphan-tool-stripped] Stripped orphan tool_result at msg ${i} (prev msg role=${prevMsg?.role})`);
          continue; // skip adding this message
        }
      }
      result.push(msg);
    } else {
      result.push(msg);
    }
  }

  return { messages: result, orphansFixed, orphansStripped };
}

// Sprint 24: Session-level cumulative token counters
// Sprint 27: Added prompt-caching fields
export interface SessionUsage {
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeRequests: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  contextWindowUsed: number;
  contextWindowMax: number;
  // Sprint 27: Prompt caching metrics
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheHits: number;
  cacheMisses: number;
  estimatedSavings: number; // estimated tokens saved via caching
  promptCachingEnabled: boolean;
}

let sessionUsage: SessionUsage = {
  cumulativeInputTokens: 0,
  cumulativeOutputTokens: 0,
  cumulativeRequests: 0,
  lastInputTokens: 0,
  lastOutputTokens: 0,
  contextWindowUsed: 0,
  contextWindowMax: 200_000,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  cacheHits: 0,
  cacheMisses: 0,
  estimatedSavings: 0,
  promptCachingEnabled: true,
};

export function getSessionUsage(): SessionUsage { return { ...sessionUsage }; }
export function resetSessionUsage(): void {
  sessionUsage = { cumulativeInputTokens: 0, cumulativeOutputTokens: 0, cumulativeRequests: 0, lastInputTokens: 0, lastOutputTokens: 0, contextWindowUsed: 0, contextWindowMax: 200_000, cacheCreationTokens: 0, cacheReadTokens: 0, cacheHits: 0, cacheMisses: 0, estimatedSavings: 0, promptCachingEnabled: true };
}
export function setPromptCachingEnabled(enabled: boolean): void {
  sessionUsage.promptCachingEnabled = enabled;
}
export function isPromptCachingEnabled(): boolean {
  return sessionUsage.promptCachingEnabled;
}

function recordSessionUsage(input: number, output: number, contextMax?: number): void {
  sessionUsage.lastInputTokens = input;
  sessionUsage.lastOutputTokens = output;
  sessionUsage.cumulativeInputTokens += input;
  sessionUsage.cumulativeOutputTokens += output;
  sessionUsage.cumulativeRequests += 1;
  sessionUsage.contextWindowUsed = sessionUsage.cumulativeInputTokens;
  if (contextMax) sessionUsage.contextWindowMax = contextMax;
}

/** Sprint 27: Record prompt caching metrics from Anthropic response usage */
function recordCacheUsage(usage: any): void {
  const cacheCreation = usage?.cache_creation_input_tokens || 0;
  const cacheRead = usage?.cache_read_input_tokens || 0;
  sessionUsage.cacheCreationTokens += cacheCreation;
  sessionUsage.cacheReadTokens += cacheRead;
  if (cacheRead > 0) {
    sessionUsage.cacheHits++;
    // Anthropic caches reduce cost: cache read tokens are 90% cheaper
    sessionUsage.estimatedSavings += Math.round(cacheRead * 0.9);
  } else if (cacheCreation > 0) {
    sessionUsage.cacheMisses++;
  }
}

// Sprint 16: Model metadata
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
  contextWindow?: number;
  maxOutput?: number;
}

/**
 * Sprint 25.5: Safe fallback model list.
 * These IDs are known to exist on the Anthropic API as of 2025.
 * The app dynamically fetches the real list from /v1/models on startup
 * and caches it. This list is ONLY used if the API call fails.
 */
const SAFE_FALLBACK_MODELS: ModelInfo[] = [
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'claude', supportsTools: true, supportsStreaming: true, contextWindow: 200000, maxOutput: 8192 },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'claude', supportsTools: true, supportsStreaming: true, contextWindow: 200000, maxOutput: 8192 },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'claude', supportsTools: true, supportsStreaming: true, contextWindow: 200000, maxOutput: 4096 },
];

// Models that DO NOT support tool use
const NO_TOOL_SUPPORT = new Set(['claude-2.0', 'claude-2.1', 'claude-instant-1.2']);

/**
 * Sprint 25.5: Dynamic model cache with timestamp.
 * Prevents repeated /v1/models calls. TTL = 30 minutes.
 */
interface ModelCache {
  models: ModelInfo[];
  fetchedAt: number;
  apiKeyHash: string; // track which key was used
}

const MODEL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let _modelCache: ModelCache | null = null;

function isModelCacheValid(apiKeyHash: string): boolean {
  if (!_modelCache) return false;
  if (_modelCache.apiKeyHash !== apiKeyHash) return false;
  return (Date.now() - _modelCache.fetchedAt) < MODEL_CACHE_TTL_MS;
}

function setModelCache(models: ModelInfo[], apiKeyHash: string): void {
  _modelCache = { models, fetchedAt: Date.now(), apiKeyHash };
}

function getModelCache(): ModelInfo[] | null {
  return _modelCache?.models || null;
}

function invalidateModelCache(): void {
  _modelCache = null;
}

/** Simple hash for cache keying (not cryptographic) */
function hashKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return 'k' + Math.abs(h).toString(36);
}

/** Convert an API model ID to a human-friendly display name */
function modelIdToDisplayName(id: string): string {
  // e.g. "claude-3-5-sonnet-20241022" -> "Claude 3.5 Sonnet"
  return id
    .replace(/^claude-/, 'Claude ')
    .replace(/-/g, ' ')
    .replace(/(\d{8,})/, '') // strip date suffixes
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/claude (\d) (\d)/i, (_, a, b) => `Claude ${a}.${b}`)
    .replace(/\b\w/g, c => c.toUpperCase())
    || id;
}

// ─── Claude Provider (Real Anthropic API) ───
export class ClaudeProvider implements ILLMProvider {
  name = 'claude';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  // Sprint 36 Fix 2: Track active stream for abort-on-new-request / tab-unmount.
  // Each new streaming request aborts the previous one to prevent duplicate
  // message-delta events and orphaned connections.
  private activeStream: AbortController | null = null;

  constructor(apiKey: string, model = 'claude-sonnet-4-6', baseUrl = 'https://api.anthropic.com') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  /**
   * Sprint 36: Abort the currently active stream (if any).
   * Called before a new request starts, and on component unmount / tab switch.
   * Silently no-ops if no stream is active.
   */
  abortActiveStream(): void {
    if (this.activeStream) {
      console.log('[ClaudeProvider] Aborting active stream');
      this.activeStream.abort();
      this.activeStream = null;
    }
  }

  async sendMessage(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema
    }));

    // Build proper Anthropic messages (system goes in system param, not in messages)
    const filteredMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

    const body: any = {
      model: this.model,
      max_tokens: 4096,
      messages: filteredMessages
    };

    // Extract system messages and combine with systemPrompt
    const systemMessages = messages.filter(m => m.role === 'system').map(m => m.content);
    const allSystem = [systemPrompt, ...systemMessages].filter(Boolean).join('\n\n');
    if (allSystem) {
      body.system = allSystem;
    }

    if (anthropicTools?.length) {
      body.tools = anthropicTools;
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      const err: any = new Error(`Anthropic API error ${response.status}: ${errText}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();

    let content = '';
    const toolCalls: LLMResponse['toolCalls'] = [];

    for (const block of data.content || []) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input
        });
      }
    }

    // Sprint 21 + Sprint 24: Record usage in rate limiter + session counters
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    getRateLimiter().recordUsage(inputTokens, outputTokens);
    recordSessionUsage(inputTokens, outputTokens);

    // Sprint 24: Parse rate-limit headers from response for authoritative tracking
    const responseHeaders: Record<string, string> = {};
    if (response.headers) {
      response.headers.forEach((value: string, key: string) => {
        responseHeaders[key] = value;
      });
    }
    const parsedHeaders = parseRateLimitHeaders(responseHeaders);

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: { inputTokens, outputTokens },
      stopReason: data.stop_reason || 'end_turn',
      rateLimitHeaders: parsedHeaders,
    };
  }

  async *streamMessage(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): AsyncGenerator<LLMStreamChunk> {
    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema
    }));

    const filteredMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

    const body: any = {
      model: this.model,
      max_tokens: 4096,
      messages: filteredMessages,
      stream: true
    };

    const systemMessages = messages.filter(m => m.role === 'system').map(m => m.content);
    const allSystem = [systemPrompt, ...systemMessages].filter(Boolean).join('\n\n');
    if (allSystem) {
      body.system = allSystem;
    }

    if (anthropicTools?.length) {
      body.tools = anthropicTools;
    }

    // Sprint 33: Diagnostic logging for outbound Anthropic payload
    const systemStr = typeof body.system === 'string' ? body.system : '';
    const toolNames = anthropicTools?.map((t: any) => t.name) || [];
    console.log('[ClaudeProvider:stream] outbound-payload', JSON.stringify({
      model: body.model,
      systemLength: systemStr.length,
      systemPreview: systemStr.substring(0, 200),
      systemTail: systemStr.substring(Math.max(0, systemStr.length - 200)),
      toolCount: anthropicTools?.length || 0,
      toolNames,
      toolChoice: body.tool_choice || undefined,
      messageCount: filteredMessages.length,
      lastUserMessagePreview: filteredMessages.length > 0
        ? filteredMessages[filteredMessages.length - 1].content.substring(0, 200)
        : '',
    }));

    // Sprint 36 Fix 2: Abort previous stream before starting a new one.
    // This prevents overlapping SSE connections that cause duplicate message-delta events.
    this.abortActiveStream();
    const streamAbort = new AbortController();
    this.activeStream = streamAbort;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: streamAbort.signal,
    });

    if (!response.ok) {
      this.activeStream = null;
      const errText = await response.text().catch(() => 'Unknown error');
      const err: any = new Error(`Anthropic API error ${response.status}: ${errText}`);
      err.status = response.status;
      throw err;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { id: string; name: string; inputJson: string } | null = null;
    let fullStreamContent = '';
    let streamStopReason = 'end_turn';
    let _firstBlockLogged = false;
    let _toolBlockCount = 0; // Sprint 34: track tool_use blocks seen

    // Sprint 34: Tools that accept empty input (no required properties)
    const EMPTY_INPUT_TOOLS = new Set(['git_status']);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Sprint 34 Fix 2: CRLF-aware SSE line splitter.
        // The SSE spec uses \n, \r\n, or \r as line delimiters.
        // Split on any of these, keeping trailing incomplete bytes in buffer.
        const lines = buffer.split(/\r\n|\r|\n/);
        buffer = lines.pop() || ''; // last element is the incomplete trailing segment

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith('data: ')) continue;
          // Sprint 34 Fix 2: Do not trim the data payload before length check;
          // only strip the 'data: ' prefix. Whitespace in JSON is meaningful.
          const data = trimmedLine.slice(6);
          if (data === '[DONE]' || data.length === 0) continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'content_block_start') {
              // Sprint 33: Log first content block for diagnostics
              if (!_firstBlockLogged) {
                _firstBlockLogged = true;
                console.log('[ClaudeProvider:stream] first-inbound-delta', JSON.stringify({
                  type: event.type,
                  blockType: event.content_block?.type,
                  toolUsePresent: event.content_block?.type === 'tool_use',
                }));
              }
              if (event.content_block?.type === 'tool_use') {
                // Sprint 34: Log every tool_use block start
                _toolBlockCount++;
                console.log('[ClaudeProvider:stream] tool-block-start', JSON.stringify({
                  blockIndex: _toolBlockCount,
                  toolId: event.content_block.id,
                  toolName: event.content_block.name,
                }));
                currentToolCall = {
                  id: event.content_block.id,
                  name: event.content_block.name,
                  inputJson: ''
                };
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta') {
                fullStreamContent += event.delta.text || '';
                yield { type: 'text', content: event.delta.text };
              } else if (event.delta?.type === 'input_json_delta' && currentToolCall) {
                currentToolCall.inputJson += event.delta.partial_json || '';
              }
            } else if (event.type === 'content_block_stop') {
              if (currentToolCall) {
                const toolName = currentToolCall.name;
                const rawJson = currentToolCall.inputJson;

                // Sprint 34 Fix 3: Parse input JSON with detailed error reporting
                let input: Record<string, unknown> | null = null;
                if (rawJson.length > 0) {
                  try {
                    input = JSON.parse(rawJson);
                  } catch (parseErr) {
                    // Sprint 34 Fix 1: Never silently swallow JSON parse errors
                    const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
                    console.error('[ClaudeProvider:stream] tool-input-parse-fail', JSON.stringify({
                      toolName,
                      toolId: currentToolCall.id,
                      rawJsonLength: rawJson.length,
                      rawJsonPreview: rawJson.substring(0, 200),
                      rawJsonTail: rawJson.substring(Math.max(0, rawJson.length - 100)),
                      error: errMsg,
                    }));
                  }
                }

                // Sprint 34 Fix 3: Handle empty or failed input based on tool schema
                if (input === null) {
                  if (EMPTY_INPUT_TOOLS.has(toolName)) {
                    // Tool's schema permits empty input — yield with {}
                    console.log('[ClaudeProvider:stream] tool-input-empty-allowed', JSON.stringify({
                      toolName, toolId: currentToolCall.id,
                    }));
                    input = {};
                  } else {
                    // Sprint 34 Fix 3: Emit tool-input-empty event and SKIP this tool_call
                    // to avoid yielding a broken tool_call that agentLoop would execute
                    // with missing required parameters.
                    console.error('[ClaudeProvider:stream] tool-input-empty', JSON.stringify({
                      toolName, toolId: currentToolCall.id,
                      rawJsonLength: rawJson.length,
                      reason: rawJson.length === 0 ? 'no input_json_delta received' : 'JSON parse failed',
                    }));
                    currentToolCall = null;
                    continue; // skip yielding this broken tool_call
                  }
                }

                // Sprint 34: Log tool_use block stop with input summary
                console.log('[ClaudeProvider:stream] tool-block-stop', JSON.stringify({
                  toolName,
                  toolId: currentToolCall.id,
                  inputKeys: Object.keys(input),
                  inputJsonLength: rawJson.length,
                }));

                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    input
                  }
                };
                currentToolCall = null;
              }
            } else if (event.type === 'message_stop') {
              // End
            } else if (event.type === 'message_delta') {
              // Sprint 28: Capture stop_reason from message_delta
              if (event.delta?.stop_reason) {
                streamStopReason = event.delta.stop_reason;
                // Sprint 33: Log stop_reason for diagnostics
                console.log('[ClaudeProvider:stream] message-delta', JSON.stringify({
                  stopReason: event.delta.stop_reason,
                  toolBlocksSeen: _toolBlockCount,
                }));
              }
              // Sprint 24: Capture actual usage from message_delta
              if (event.usage) {
                const streamInput = event.usage.input_tokens || 0;
                const streamOutput = event.usage.output_tokens || 0;
                if (streamInput > 0 || streamOutput > 0) {
                  recordSessionUsage(streamInput, streamOutput);
                }
              }
            }
          } catch (sseParseErr) {
            // Sprint 34 Fix 1: Never silently swallow SSE parse errors
            const errMsg = sseParseErr instanceof Error ? sseParseErr.message : String(sseParseErr);
            console.error('[ClaudeProvider:stream] sse-parse-fail', JSON.stringify({
              rawDataLength: data.length,
              rawDataPreview: data.substring(0, 200),
              error: errMsg,
            }));
          }
        }
      }
    } finally {
      reader.releaseLock();
      // Sprint 36: Clear active stream reference after completion
      this.activeStream = null;
    }

    // Sprint 24: Record streaming usage with estimates (message_delta may have recorded actuals)
    const streamInputTokens = estimateTokens(filteredMessages.map(m => m.content).join(' '));
    const streamOutputTokens = estimateTokens(fullStreamContent || '');
    getRateLimiter().recordUsage(streamInputTokens, streamOutputTokens);
    recordSessionUsage(streamInputTokens, streamOutputTokens);

    // Sprint 24: Parse rate-limit headers from streaming response
    const streamRespHeaders: Record<string, string> = {};
    if (response.headers) {
      response.headers.forEach((value: string, key: string) => {
        streamRespHeaders[key] = value;
      });
    }

    yield { type: 'done', stopReason: streamStopReason };
  }

  countTokens(text: string): number {
    // Rough estimation: ~4 chars per token for English
    return Math.ceil(text.length / 4);
  }

  getModelId(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
    console.log(`[ClaudeProvider] Model switched to: ${model}`);
  }

  /**
   * Sprint 25.5: Discover available models from the API with caching.
   * Uses cache if fresh; fetches from /v1/models otherwise.
   * Falls back to SAFE_FALLBACK_MODELS only if the API call fails.
   * @param forceRefresh - bypass cache (e.g. user clicked "Refresh models")
   */
  async discoverModels(forceRefresh = false): Promise<ModelInfo[]> {
    const keyHash = hashKey(this.apiKey);

    // Return cache if valid and not forcing refresh
    if (!forceRefresh && isModelCacheValid(keyHash)) {
      const cached = getModelCache();
      if (cached && cached.length > 0) {
        console.log(`[ClaudeProvider] Returning ${cached.length} cached models`);
        return cached;
      }
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const apiModels: ModelInfo[] = (data.data || []).map((m: any) => {
          const fallback = SAFE_FALLBACK_MODELS.find(k => k.id === m.id);
          return {
            id: m.id as string,
            name: (m.display_name || fallback?.name || modelIdToDisplayName(m.id)) as string,
            provider: 'claude',
            supportsTools: !NO_TOOL_SUPPORT.has(m.id),
            supportsStreaming: true,
            contextWindow: m.context_window || fallback?.contextWindow || undefined,
            maxOutput: m.max_output || fallback?.maxOutput || undefined,
          };
        });

        if (apiModels.length > 0) {
          setModelCache(apiModels, keyHash);
          console.log(`[ClaudeProvider] Discovered ${apiModels.length} models from API, cached`);
          return apiModels;
        }
      }
    } catch (err) {
      console.warn('[ClaudeProvider] Model discovery failed, using fallback:', err);
    }

    // Use cached models if available (even if expired) before falling back
    const staleCache = getModelCache();
    if (staleCache && staleCache.length > 0) {
      console.log('[ClaudeProvider] Using stale cache as fallback');
      return staleCache;
    }

    return SAFE_FALLBACK_MODELS;
  }

  /**
   * Check if a model supports tool calling.
   */
  static modelSupportsTools(modelId: string): boolean {
    if (NO_TOOL_SUPPORT.has(modelId)) return false;
    // Check cache first, then fallback list
    const cached = getModelCache();
    const known = cached?.find(m => m.id === modelId) || SAFE_FALLBACK_MODELS.find(m => m.id === modelId);
    if (known) return known.supportsTools;
    // Assume newer models support tools
    return true;
  }

  async validateKey(): Promise<{ valid: boolean; error?: string; models?: string[] }> {
    // Format pre-check
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      return { valid: false, error: 'Please enter an API key.' };
    }
    if (!this.apiKey.startsWith('sk-ant-')) {
      return { valid: false, error: 'Invalid format. Anthropic API keys start with "sk-ant-".\nCheck that you copied the full key from console.anthropic.com.' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        }
      });

      if (response.ok) {
        // Parse available models from response
        try {
          const data = await response.json();
          const modelIds: string[] = (data.data || []).map((m: any) => m.id as string);
          return { valid: true, models: modelIds };
        } catch {
          return { valid: true };
        }
      }

      const bodyText = await response.text().catch(() => '');

      switch (response.status) {
        case 401:
          return {
            valid: false,
            error: 'This API key is not recognized by Anthropic. Please verify:\n\u2022 The key was copied completely from console.anthropic.com\n\u2022 The key has not been revoked or deleted\n\u2022 Your account has active billing configured\n\u2022 Try generating a fresh key if this persists'
          };
        case 403:
          return { valid: false, error: 'API key lacks required permissions. Check workspace settings at console.anthropic.com.' };
        case 402:
          return { valid: true, error: 'Key is valid but your account may have insufficient credits.' };
        case 429:
          return { valid: true, error: 'Key is valid but you are currently rate-limited. Wait a moment.' };
        default:
          return { valid: false, error: `Anthropic returned status ${response.status}: ${bodyText.slice(0, 200)}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `Connection failed: ${msg}. Check your internet and firewall.` };
    }
  }
}

// ─── Provider Registry (Sprint 16 + Sprint 25.5: dynamic model state) ───
class ProviderRegistry {
  private providers: Map<string, ILLMProvider> = new Map();
  private _selectedModel: string = 'claude-3-5-sonnet-20241022';
  private _availableModels: ModelInfo[] = SAFE_FALLBACK_MODELS;
  private _modelDiscovered: boolean = false;

  register(provider: ILLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): ILLMProvider | undefined {
    return this.providers.get(name);
  }

  getDefault(): ILLMProvider | undefined {
    return this.providers.values().next().value;
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }

  remove(name: string): void {
    this.providers.delete(name);
  }

  // Sprint 16 + Sprint 25.5: Model selection with validation
  get selectedModel(): string { return this._selectedModel; }
  set selectedModel(model: string) {
    this._selectedModel = model;
    // Update the provider's model
    const provider = this.getDefault() as ClaudeProvider | undefined;
    if (provider && typeof provider.setModel === 'function') {
      provider.setModel(model);
    }
  }

  get availableModels(): ModelInfo[] { return this._availableModels; }
  set availableModels(models: ModelInfo[]) { this._availableModels = models; }

  get modelDiscovered(): boolean { return this._modelDiscovered; }

  /**
   * Sprint 25.5: Discover models with caching and refresh support.
   * @param forceRefresh - bypass cache (user clicked "Refresh models")
   */
  async discoverModels(forceRefresh = false): Promise<ModelInfo[]> {
    const provider = this.getDefault() as ClaudeProvider | undefined;
    if (provider && typeof provider.discoverModels === 'function') {
      this._availableModels = await provider.discoverModels(forceRefresh);
      this._modelDiscovered = true;
    }
    return this._availableModels;
  }

  /**
   * Sprint 25.5: Force-refresh the model cache (e.g. from "Refresh" button).
   */
  async refreshModels(): Promise<ModelInfo[]> {
    invalidateModelCache();
    return this.discoverModels(true);
  }

  /**
   * Sprint 25.5: Validate that the selected model exists in available models.
   * If not, auto-switch to the best available model.
   * Returns the validated model ID.
   */
  validateSelectedModel(): string {
    const current = this._selectedModel;
    const isValid = this._availableModels.some(m => m.id === current);
    if (isValid) return current;

    // Auto-switch: prefer sonnet, then haiku, then first available
    const sonnet = this._availableModels.find(m => m.id.includes('sonnet'));
    const haiku = this._availableModels.find(m => m.id.includes('haiku'));
    const best = sonnet || haiku || this._availableModels[0];

    if (best) {
      console.warn(`[ProviderRegistry] Model "${current}" not available. Auto-switching to "${best.id}".`);
      this.selectedModel = best.id;
      return best.id;
    }

    console.warn(`[ProviderRegistry] No available models. Keeping "${current}".`);
    return current;
  }

  checkModelToolSupport(modelId?: string): boolean {
    const id = modelId || this._selectedModel;
    return ClaudeProvider.modelSupportsTools(id);
  }
}

export const providerRegistry = new ProviderRegistry();

/**
 * Send a streaming chat response and emit chunks to the renderer via IPC
 */
/**
 * Sprint 28: Return type now includes stopReason from Anthropic's message_delta.
 * The stopReason drives the agent loop: 'tool_use' means continue, 'end_turn' means stop.
 */
export async function streamChatToRenderer(
  win: BrowserWindow | null,
  provider: ILLMProvider,
  messages: Array<{ role: string; content: string }>,
  sessionId: string,
  systemPrompt?: string,
  tools?: ToolDefinition[]
): Promise<{ content: string; toolCalls?: any[]; stopReason: string }> {
  let fullContent = '';
  const toolCalls: any[] = [];
  let stopReason = 'end_turn';

  // ─── Sprint 35: Context-window hygiene before sending to Anthropic ───
  const modelId = (provider as ClaudeProvider).getModelId();

  // Sprint 35 Fix 4: Ensure tool_use/tool_result pairing is valid
  const pairingResult = ensureToolResultsFollowToolUse(messages);
  let cleanedMessages = pairingResult.messages;
  if (pairingResult.orphansFixed > 0 || pairingResult.orphansStripped > 0) {
    console.log(`[Sprint35:pairing] Fixed ${pairingResult.orphansFixed} orphan tool_use, stripped ${pairingResult.orphansStripped} orphan tool_result`);
  }

  // Sprint 35 Fix 3 + Fix 5: Truncate if payload exceeds model limit, preserving first user-assistant pair
  const truncResult = truncateIfNeeded(cleanedMessages, systemPrompt || '', modelId);
  cleanedMessages = truncResult.messages;
  if (truncResult.wasTruncated) {
    console.log(`[Sprint35:truncation] Conversation truncated: ${truncResult.originalTokens} → ${truncResult.truncatedTokens} tokens`);
  }

  // Sprint 33: Emit outbound payload metadata to Dev Console for invariant verification
  try {
    const toolNames = tools?.map((t: any) => t.name) || [];
    win?.webContents.send('devconsole:api-traffic', {
      timestamp: Date.now(),
      sessionId,
      direction: 'outbound-payload',
      model: modelId,
      toolCount: tools?.length || 0,
      toolNames,
      systemPromptLength: systemPrompt?.length || 0,
      hasToolUseContract: (systemPrompt || '').includes('attempt_completion'),
      messageCount: cleanedMessages.length,
      // Sprint 35: context-window event data
      originalMessageCount: messages.length,
      wasTruncated: truncResult.wasTruncated,
      originalTokens: truncResult.originalTokens,
      truncatedTokens: truncResult.truncatedTokens,
      orphansFixed: pairingResult.orphansFixed,
      orphansStripped: pairingResult.orphansStripped,
    });
  } catch { /* ignore devconsole errors */ }

  try {
    for await (const chunk of (provider as ClaudeProvider).streamMessage(cleanedMessages, tools, systemPrompt)) {
      if (chunk.type === 'text' && chunk.content) {
        fullContent += chunk.content;
        win?.webContents.send('chat:stream-chunk', {
          sessionId,
          type: 'text',
          content: chunk.content,
          fullContent
        });
      } else if (chunk.type === 'tool_call' && chunk.toolCall) {
        toolCalls.push(chunk.toolCall);
        win?.webContents.send('chat:stream-chunk', {
          sessionId,
          type: 'tool_call',
          toolCall: chunk.toolCall
        });
      } else if (chunk.type === 'done') {
        // Sprint 28: Capture stopReason from done chunk
        if ((chunk as any).stopReason) {
          stopReason = (chunk as any).stopReason;
        }
        win?.webContents.send('chat:stream-chunk', {
          sessionId,
          type: 'done',
          fullContent,
          stopReason,
        });
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    win?.webContents.send('chat:stream-chunk', {
      sessionId,
      type: 'error',
      error: errMsg
    });
    throw error;
  }

  // Infer stopReason from tool calls if streaming didn't provide it
  if (toolCalls.length > 0 && stopReason === 'end_turn') {
    stopReason = 'tool_use';
  }

  // Sprint 30 + Sprint 34: Emit API response event to Dev Console
  try {
    const usage = getSessionUsage();
    win?.webContents.send('devconsole:api-traffic', {
      timestamp: Date.now(),
      sessionId,
      direction: 'response',
      stopReason,
      inputTokens: usage.lastInputTokens,
      outputTokens: usage.lastOutputTokens,
      toolCount: toolCalls.length,
      // Sprint 34: Include tool call names for diagnostics
      toolNames: toolCalls.map((tc: any) => tc.name),
    });
  } catch { /* ignore devconsole errors */ }

  return { content: fullContent, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, stopReason };
}
