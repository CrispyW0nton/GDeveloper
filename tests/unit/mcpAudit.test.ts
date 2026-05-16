import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  clearMCPAuditEvents,
  getMCPAuditEvents,
  previewMCPPayload,
  recordMCPAuditEvent,
} from '../../src/main/mcp/audit';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

beforeEach(() => {
  clearMCPAuditEvents();
});

describe('MCP audit log', () => {
  it('records newest events first with generated ids and timestamps', () => {
    const first = recordMCPAuditEvent({ kind: 'server', action: 'connect', status: 'success', serverName: 'one' });
    const second = recordMCPAuditEvent({ kind: 'tool', action: 'call', status: 'running', serverName: 'two' });

    const events = getMCPAuditEvents();
    expect(events[0].id).toBe(second.id);
    expect(events[1].id).toBe(first.id);
    expect(events[0].timestamp).toBeTruthy();
  });

  it('redacts secret-looking payload keys', () => {
    const preview = previewMCPPayload({
      query: 'hello',
      apiKey: 'sk-secret',
      nested: { authorization: 'Bearer token' },
    });

    expect(preview).toContain('"query":"hello"');
    expect(preview).toContain('[REDACTED]');
    expect(preview).not.toContain('sk-secret');
    expect(preview).not.toContain('Bearer token');
  });

  it('wires MCP audit into manager, IPC, preload, and panel UI', () => {
    const mcpSrc = readSrc('main/mcp/index.ts');
    const ipcSrc = readSrc('main/ipc/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');
    const panelSrc = readSrc('renderer/components/mcp/MCPServersPanel.tsx');

    expect(mcpSrc).toContain('recordMCPAuditEvent');
    expect(mcpSrc).toContain('previewMCPPayload(args)');
    expect(ipcSrc).toContain('MCP_AUDIT_LIST');
    expect(ipcSrc).toContain('MCP_AUDIT_CLEAR');
    expect(mainSrc).toContain('getMCPAuditEvents');
    expect(mainSrc).toContain('clearMCPAuditEvents');
    expect(preloadSrc).toContain('listMCPAudit');
    expect(preloadSrc).toContain('clearMCPAudit');
    expect(panelSrc).toContain('MCP Audit Console');
  });
});
