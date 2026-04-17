/**
 * LLM Provider Abstraction Layer
 * Real Claude provider with streaming via Anthropic Messages API
 * Supports Claude, OpenAI-compatible, and custom providers
 *
 * Sprint 16: dynamic model discovery, model selection, compatibility checks.
 */

import { ILLMProvider, LLMResponse, LLMStreamChunk } from '../domain/interfaces';
import { ToolDefinition } from '../domain/entities';
import { BrowserWindow } from 'electron';
import { getRateLimiter } from './rateLimiter';
import { getRetryHandler, parseRateLimitHeaders } from './retryHandler';
import { getToolResultBudget } from './toolResultBudget';
import { getContextManager, estimateTokens, type ContextMessage } from './contextManager';

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

  constructor(apiKey: string, model = 'claude-sonnet-4-6', baseUrl = 'https://api.anthropic.com') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
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

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { id: string; name: string; inputJson: string } | null = null;
    let fullStreamContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'content_block_start') {
              if (event.content_block?.type === 'tool_use') {
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
                let input = {};
                try { input = JSON.parse(currentToolCall.inputJson); } catch {}
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
              // Sprint 24: Capture actual usage from message_delta
              if (event.usage) {
                const streamInput = event.usage.input_tokens || 0;
                const streamOutput = event.usage.output_tokens || 0;
                if (streamInput > 0 || streamOutput > 0) {
                  recordSessionUsage(streamInput, streamOutput);
                }
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
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

    yield { type: 'done' };
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
export async function streamChatToRenderer(
  win: BrowserWindow | null,
  provider: ILLMProvider,
  messages: Array<{ role: string; content: string }>,
  sessionId: string,
  systemPrompt?: string,
  tools?: ToolDefinition[]
): Promise<{ content: string; toolCalls?: any[] }> {
  let fullContent = '';
  const toolCalls: any[] = [];

  try {
    for await (const chunk of (provider as ClaudeProvider).streamMessage(messages, tools, systemPrompt)) {
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
        win?.webContents.send('chat:stream-chunk', {
          sessionId,
          type: 'done',
          fullContent
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

  return { content: fullContent, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}
