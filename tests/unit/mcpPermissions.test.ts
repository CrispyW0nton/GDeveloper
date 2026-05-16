import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('MCP tool permission matrix', () => {
  it('defines workspace-scoped allow/ask/deny rules', () => {
    const permissionsSrc = readSrc('main/mcp/permissions.ts');

    expect(permissionsSrc).toContain("export type MCPToolPermissionMode = 'allow' | 'ask' | 'deny'");
    expect(permissionsSrc).toContain('getMCPPermissionStoreKey');
    expect(permissionsSrc).toContain('setMCPToolPermissionRule');
    expect(permissionsSrc).toContain('getMCPToolPermission(');
    expect(permissionsSrc).toContain('mcp.tool_permissions');
  });

  it('enforces permissions before both agent and direct MCP tool execution', () => {
    const mainSrc = readSrc('main/index.ts');
    const agentExecIdx = mainSrc.indexOf('executeTool: async (tc)');
    const directExecIdx = mainSrc.indexOf('IPC_CHANNELS.TOOL_EXECUTE');
    const permissionHelperIdx = mainSrc.indexOf('function checkMCPToolPermission');

    expect(permissionHelperIdx).toBeGreaterThan(-1);
    expect(mainSrc.indexOf('checkMCPToolPermission(toolMeta.serverId, tc.name)', agentExecIdx)).toBeGreaterThan(agentExecIdx);
    expect(mainSrc.indexOf('mcp.executeTool(toolMeta.serverId, tc.name', agentExecIdx)).toBeGreaterThan(agentExecIdx);
    expect(mainSrc.indexOf('checkMCPToolPermission(targetServerId, name)', directExecIdx)).toBeGreaterThan(directExecIdx);
    expect(mainSrc.indexOf('mcp.executeTool(targetServerId, name', directExecIdx)).toBeGreaterThan(directExecIdx);
    expect(mainSrc).toContain('permission_denied');
    expect(mainSrc).toContain('permission_required');
  });

  it('exposes permission list/set over IPC and preload', () => {
    const ipcSrc = readSrc('main/ipc/index.ts');
    const preloadSrc = readSrc('preload/index.ts');
    const mainSrc = readSrc('main/index.ts');

    expect(ipcSrc).toContain('MCP_PERMISSION_LIST');
    expect(ipcSrc).toContain('MCP_PERMISSION_SET');
    expect(preloadSrc).toContain('listMCPPermissions');
    expect(preloadSrc).toContain('setMCPPermission');
    expect(mainSrc).toContain('IPC_CHANNELS.MCP_PERMISSION_LIST');
    expect(mainSrc).toContain('IPC_CHANNELS.MCP_PERMISSION_SET');
  });

  it('renders Allow Ask Deny controls in the MCP server panel', () => {
    const panelSrc = readSrc('renderer/components/mcp/MCPServersPanel.tsx');

    expect(panelSrc).toContain('MCPToolPermissionMode');
    expect(panelSrc).toContain('handleSetToolPermission');
    expect(panelSrc).toContain('<option value="allow">Allow</option>');
    expect(panelSrc).toContain('<option value="ask">Ask</option>');
    expect(panelSrc).toContain('<option value="deny">Deny</option>');
  });
});
