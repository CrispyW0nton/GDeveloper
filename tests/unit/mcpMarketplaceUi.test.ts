import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('MCP marketplace UI wiring', () => {
  const ipcSrc = readSrc('main/ipc/index.ts');
  const mainSrc = readSrc('main/index.ts');
  const preloadSrc = readSrc('preload/index.ts');
  const panelSrc = readSrc('renderer/components/mcp/MCPServersPanel.tsx');

  it('defines marketplace IPC channels', () => {
    expect(ipcSrc).toContain('MCP_MARKETPLACE_SEARCH');
    expect(ipcSrc).toContain('MCP_MARKETPLACE_PREVIEW');
    expect(ipcSrc).toContain('MCP_MARKETPLACE_INSTALL');
  });

  it('registers main-process handlers for search, preview, and install', () => {
    expect(mainSrc).toContain('IPC_CHANNELS.MCP_MARKETPLACE_SEARCH');
    expect(mainSrc).toContain('searchMCPMarketplace');
    expect(mainSrc).toContain('buildMarketplaceInstallPreview');
    expect(mainSrc).toContain('mcp_marketplace_install');
  });

  it('exposes marketplace bridge methods to the renderer', () => {
    expect(preloadSrc).toContain('searchMCPMarketplace');
    expect(preloadSrc).toContain('previewMCPMarketplace');
    expect(preloadSrc).toContain('installMCPMarketplace');
  });

  it('renders marketplace search and preview install controls in the MCP panel', () => {
    expect(panelSrc).toContain('Search MCP registry');
    expect(panelSrc).toContain('previewMarketplaceEntry');
    expect(panelSrc).toContain('installMarketplaceEntry');
    expect(panelSrc).toContain('Permission Preview');
    expect(panelSrc).toContain('Install Config');
  });
});
