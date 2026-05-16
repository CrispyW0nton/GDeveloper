import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  createProviderForKey,
  DEFAULT_OPENAI_COMPATIBLE_MODEL,
  OpenAICompatibleProvider,
  providerRegistry,
} from '../../src/main/providers';

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.restoreAllMocks();
  providerRegistry.remove('openai');
  providerRegistry.remove('openrouter');
  providerRegistry.remove('custom');
});

describe('OpenAI-compatible provider', () => {
  it('creates OpenAI-compatible providers from provider names', () => {
    const openai = createProviderForKey('openai', 'sk-test');
    const openrouter = createProviderForKey('openrouter', 'sk-or-test');

    expect(openai).toBeInstanceOf(OpenAICompatibleProvider);
    expect(openai.name).toBe('openai');
    expect(openai.getModelId?.()).toBe(DEFAULT_OPENAI_COMPATIBLE_MODEL);
    expect(openrouter).toBeInstanceOf(OpenAICompatibleProvider);
    expect(openrouter.name).toBe('openrouter');
  });

  it('streams text and OpenAI tool calls through the common chunk contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\""}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"src/main/index.ts\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ]));

    const provider = new OpenAICompatibleProvider('sk-test', 'openai');
    const chunks = [];
    for await (const chunk of provider.streamMessage(
      [{ role: 'user', content: 'read the main file' }],
      [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } } as any],
      'System prompt'
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'text', content: 'Hello' },
      { type: 'tool_call', toolCall: { id: 'call_1', name: 'read_file', input: { path: 'src/main/index.ts' } } },
      { type: 'done', stopReason: 'tool_use' },
    ]);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.messages[0]).toEqual({ role: 'system', content: 'System prompt' });
    expect(requestBody.tools[0].function.name).toBe('read_file');
    expect(requestBody.stream_options).toEqual({ include_usage: true });
  });

  it('parses non-streaming OpenAI tool calls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: '',
          tool_calls: [{
            id: 'call_2',
            function: { name: 'search_files', arguments: '{"query":"provider"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = new OpenAICompatibleProvider('sk-test', 'openai');
    const response = await provider.sendMessage([{ role: 'user', content: 'find provider' }]);

    expect(response.stopReason).toBe('tool_use');
    expect(response.toolCalls?.[0]).toEqual({
      id: 'call_2',
      name: 'search_files',
      input: { query: 'provider' },
    });
  });
});

describe('provider gateway wiring', () => {
  it('provider registry tracks an active provider and selected model generically', () => {
    const provider = new OpenAICompatibleProvider('sk-test', 'openai', 'gpt-4o');
    providerRegistry.register(provider);

    expect(providerRegistry.activeProvider).toBe('openai');
    expect(providerRegistry.getDefault()?.name).toBe('openai');
    expect(providerRegistry.selectedModel).toBe('gpt-4o');

    providerRegistry.selectedModel = 'gpt-4o-mini';
    expect(provider.getModelId()).toBe('gpt-4o-mini');
    expect(providerRegistry.checkModelToolSupport('gpt-4o-mini')).toBe(true);
  });

  it('chat streaming path no longer casts providers to Claude', () => {
    const providerSource = readFileSync(resolve(__dirname, '../../src/main/providers/index.ts'), 'utf-8');
    const streamIdx = providerSource.indexOf('export async function streamChatToRenderer');
    const streamBody = providerSource.slice(streamIdx, streamIdx + 5000);

    expect(streamBody).toContain('provider.getModelId?.()');
    expect(streamBody).toContain('provider.streamMessage(cleanedMessages, tools, systemPrompt)');
    expect(streamBody).not.toContain('provider as ClaudeProvider');
  });
});
