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

// Known Anthropic models with tool support
const KNOWN_CLAUDE_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'claude', supportsTools: true, supportsStreaming: true, contextWindow: 200000, maxOutput: 4096 },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'claude', supportsTools: true, supportsStreaming: true, contextWindow: 200000, maxOutput: 16384 },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'claude', supportsTools: true, supportsStreaming: true, contextWindow: 200000, maxOutput: 32768 },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'claude', supportsTools: true, supportsStreaming: true, contextWindow: 200000, maxOutput: 8192 },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'claude', supportsTools: true, supportsStreaming: true, contextWindow: 200000, maxOutput: 8192 },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'claude', supportsTools: true, supportsStreaming: true, contextWindow: 200000, maxOutput: 4096 },
];

// Models that DO NOT support tool use
const NO_TOOL_SUPPORT = new Set(['claude-2.0', 'claude-2.1', 'claude-instant-1.2']);

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
      throw new Error(`Anthropic API error ${response.status}: ${errText}`);
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

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0
      },
      stopReason: data.stop_reason || 'end_turn'
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
      throw new Error(`Anthropic API error ${response.status}: ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { id: string; name: string; inputJson: string } | null = null;

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
              // Contains usage info
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
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
   * Sprint 16: Discover available models from the API.
   * Falls back to known models if the API call fails.
   */
  async discoverModels(): Promise<ModelInfo[]> {
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
          const known = KNOWN_CLAUDE_MODELS.find(k => k.id === m.id);
          return known || {
            id: m.id as string,
            name: (m.display_name || m.id) as string,
            provider: 'claude',
            supportsTools: !NO_TOOL_SUPPORT.has(m.id),
            supportsStreaming: true,
            contextWindow: m.context_window || undefined,
            maxOutput: m.max_output || undefined,
          };
        });
        return apiModels.length > 0 ? apiModels : KNOWN_CLAUDE_MODELS;
      }
    } catch {
      // Fall back to known models
    }
    return KNOWN_CLAUDE_MODELS;
  }

  /**
   * Check if a model supports tool calling.
   */
  static modelSupportsTools(modelId: string): boolean {
    if (NO_TOOL_SUPPORT.has(modelId)) return false;
    const known = KNOWN_CLAUDE_MODELS.find(m => m.id === modelId);
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

// ─── Provider Registry (Sprint 16: model state) ───
class ProviderRegistry {
  private providers: Map<string, ILLMProvider> = new Map();
  private _selectedModel: string = 'claude-sonnet-4-6';
  private _availableModels: ModelInfo[] = KNOWN_CLAUDE_MODELS;
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

  // Sprint 16: Model selection
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

  async discoverModels(): Promise<ModelInfo[]> {
    const provider = this.getDefault() as ClaudeProvider | undefined;
    if (provider && typeof provider.discoverModels === 'function') {
      this._availableModels = await provider.discoverModels();
      this._modelDiscovered = true;
    }
    return this._availableModels;
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
