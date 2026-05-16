import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  MCP_REGISTRY_BASE_URL,
  buildMarketplaceInstallPreview,
  getMCPMarketplaceEntry,
  searchMCPMarketplace,
} from '../../src/main/mcp/marketplace';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MCP marketplace registry client', () => {
  it('searches the official registry endpoint and filters results', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      servers: [
        { name: 'io.github/example/github', title: 'GitHub MCP', description: 'Repository tools', packages: [] },
        { name: 'com.example/calendar', title: 'Calendar MCP', description: 'Calendar tools', packages: [] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const results = await searchMCPMarketplace('github', 10);

    expect(fetchMock.mock.calls[0][0]?.toString()).toContain(`${MCP_REGISTRY_BASE_URL}/v0.1/servers`);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('io.github/example/github');
  });

  it('fetches latest server detail by URL-encoded registry name', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      name: 'io.github/example/github',
      title: 'GitHub MCP',
      packages: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const entry = await getMCPMarketplaceEntry('io.github/example/github');

    expect(fetchMock.mock.calls[0][0]?.toString()).toContain('/v0.1/servers/io.github%2Fexample%2Fgithub/versions/latest');
    expect(entry.title).toBe('GitHub MCP');
  });

  it('builds an npm stdio install preview', () => {
    const preview = buildMarketplaceInstallPreview({
      name: 'io.github/example/server',
      title: 'Example Server',
      description: 'Example',
      source: 'official',
      packages: [{ registryType: 'npm', identifier: '@example/mcp-server' }],
      remotes: [],
      raw: {},
    });

    expect(preview.installable).toBe(true);
    expect(preview.config?.transport).toBe('stdio');
    expect(preview.config?.name).toBe('io.github/example/server');
    expect(preview.config?.command).toBe('npx');
    expect(preview.config?.args).toEqual(['-y', '@example/mcp-server']);
  });

  it('builds a remote HTTP install preview', () => {
    const preview = buildMarketplaceInstallPreview({
      name: 'com.example/remote',
      title: 'Remote',
      description: 'Remote server',
      source: 'official',
      packages: [],
      remotes: [{ url: 'https://example.com/mcp', transport: { type: 'streamable-http' } }],
      raw: {},
    });

    expect(preview.installable).toBe(true);
    expect(preview.config?.transport).toBe('http');
    expect(preview.config?.url).toBe('https://example.com/mcp');
  });

  it('wires marketplace commands and autocomplete', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    const dropdownSrc = readSrc('renderer/components/chat/SlashCommandDropdown.tsx');
    expect(commandsSrc).toContain("name: 'mcp-marketplace'");
    expect(commandsSrc).toContain('searchMCPMarketplace');
    expect(commandsSrc).toContain('buildMarketplaceInstallPreview');
    expect(dropdownSrc).toContain('mcp-marketplace');
  });
});
