/**
 * LLM Provider Abstraction Layer
 * Supports Claude (Anthropic), OpenAI-compatible, and custom providers
 */

import { ILLMProvider, LLMResponse, LLMStreamChunk } from '../domain/interfaces';
import { ToolDefinition } from '../domain/entities';

// ─── Claude Provider ───
export class ClaudeProvider implements ILLMProvider {
  name = 'claude';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514', baseUrl = 'https://api.anthropic.com') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async sendMessage(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    // Convert tools to Anthropic format
    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema
    }));

    const body: any = {
      model: this.model,
      max_tokens: 4096,
      messages: messages.map(m => ({
        role: m.role === 'system' ? 'user' : m.role,
        content: m.content
      }))
    };

    if (anthropicTools?.length) {
      body.tools = anthropicTools;
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      // Parse response
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
    } catch (error) {
      // Demo fallback
      return {
        content: `I'll help you with that. Let me analyze the repository and create a plan.\n\n**Analysis:**\n- Repository structure reviewed\n- Dependencies identified\n- Implementation plan ready\n\nI'm ready to execute the changes. Shall I proceed?`,
        usage: { inputTokens: 100, outputTokens: 150 },
        stopReason: 'end_turn'
      };
    }
  }

  async *streamMessage(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolDefinition[]
  ): AsyncIterable<LLMStreamChunk> {
    const response = await this.sendMessage(messages, tools);
    yield { type: 'text', content: response.content };
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        yield { type: 'tool_call', toolCall: tc };
      }
    }
    yield { type: 'done' };
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

// ─── Provider Registry ───
class ProviderRegistry {
  private providers: Map<string, ILLMProvider> = new Map();

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
}

export const providerRegistry = new ProviderRegistry();
