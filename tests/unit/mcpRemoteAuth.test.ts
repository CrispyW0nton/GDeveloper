import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MCPTransportType, MCPServerStatus } from '../../src/main/domain/enums';
import { buildMCPRemoteTransportOptions, normalizeRemoteAuth } from '../../src/main/mcp/remoteAuth';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('MCP remote auth transport hardening', () => {
  it('sanitizes custom headers and rejects non-http resource indicators', () => {
    const normalized = normalizeRemoteAuth({
      headers: {
        Authorization: 'Bearer should-not-persist',
        Host: 'example.com',
        'X-Team': 'platform',
      },
      resourceIndicator: 'https://api.example.com/resource',
    });

    expect(normalized.headers).toEqual({ 'X-Team': 'platform' });
    expect(normalized.resourceIndicator).toBe('https://api.example.com/resource');
    expect(() => normalizeRemoteAuth({ resourceIndicator: 'file:///tmp/token' })).toThrow(/http\(s\)/);
  });

  it('injects bearer tokens from environment variables without storing token values', async () => {
    vi.stubEnv('MCP_TEST_TOKEN', 'super-secret-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const options = buildMCPRemoteTransportOptions({
      id: 'srv',
      name: 'Remote',
      transport: MCPTransportType.HTTP,
      url: 'https://example.com/mcp',
      remoteAuth: {
        bearerTokenEnvVar: 'MCP_TEST_TOKEN',
        headers: { 'X-Team': 'platform' },
      },
      enabled: true,
      autoStart: false,
      status: MCPServerStatus.DISCONNECTED,
      tools: [],
    });

    await options.fetch('https://example.com/mcp', { headers: { 'X-Request': '1' } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);

    expect(headers.get('Authorization')).toBe('Bearer super-secret-token');
    expect(headers.get('X-Team')).toBe('platform');
    expect(headers.get('X-Request')).toBe('1');
    expect(options.authPreview.bearerTokenEnvVar).toBe('MCP_TEST_TOKEN');
  });

  it('wires remote auth options into SSE and Streamable HTTP transports plus UI', () => {
    const mcpSrc = readSrc('main/mcp/index.ts');
    const dbSrc = readSrc('main/db/index.ts');
    const validatorSrc = readSrc('main/ipc/validators.ts');
    const panelSrc = readSrc('renderer/components/mcp/MCPServersPanel.tsx');

    expect(mcpSrc).toContain('buildMCPRemoteTransportOptions');
    expect(mcpSrc).toContain('new StreamableHTTPClientTransport(streamableUrl, {');
    expect(mcpSrc).toContain('new SSEClientTransport(sseUrl, {');
    expect(dbSrc).toContain('remote_auth TEXT DEFAULT');
    expect(validatorSrc).toContain('remoteAuth: z.object');
    expect(panelSrc).toContain('Bearer Token Env');
    expect(panelSrc).toContain('Resource Indicator');
  });
});
