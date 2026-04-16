/**
 * MCP Forge — One-Click Register + Connect
 * Sprint 14, Task 5
 *
 * Registers a generated adapter as an MCP server in GDeveloper,
 * then connects and discovers tools.
 */

import { join } from 'path';
import { v4 as uuid } from 'uuid';
import { getDatabase } from '../db';
import { getMCPManager } from '../mcp';
import type { AdapterProject } from './types';
import { updateAdapterProject } from './storage';

/**
 * Register a generated adapter as an MCP server and connect it.
 *
 * Steps:
 * 1. Save MCP server config with the adapter's command
 * 2. Register in MCP manager
 * 3. Connect
 * 4. Discover tools
 * 5. Update adapter project status
 */
export async function registerAndConnectAdapter(
  project: AdapterProject
): Promise<{ success: boolean; serverId?: string; toolCount?: number; error?: string }> {
  const db = getDatabase();
  const mcp = getMCPManager();

  const serverFile = join(project.adapterPath, 'server.ts');
  const serverId = project.mcpServerId || uuid();

  db.logActivity('system', 'forge_register_start', `Registering adapter: ${project.name}`, project.adapterPath, {
    adapterId: project.id, serverId,
  });

  try {
    // Step 1: Build MCP server config
    const serverConfig = {
      id: serverId,
      name: `[Forge] ${project.appName}`,
      transport: 'stdio' as const,
      command: 'npx',
      args: ['tsx', serverFile],
      env: {},
      url: undefined,
      enabled: true,
      autoStart: false,
      status: 'disconnected' as any,
      tools: [],
      lastConnected: undefined,
    };

    // Step 2: Register in MCP manager
    const registeredServer = await mcp.addServer(serverConfig as any);

    // Step 3: Connect
    await mcp.connectServer(registeredServer.id);

    // Step 4: Get discovered tools
    const server = mcp.getServer(registeredServer.id);
    const toolCount = server?.tools.length || 0;

    // Step 5: Update adapter project
    updateAdapterProject(project.id, {
      status: 'registered',
      mcpServerId: registeredServer.id,
    });

    db.logActivity('system', 'forge_register_done',
      `Adapter registered: ${project.name}`,
      `Server: ${registeredServer.id}, Tools: ${toolCount}`, {
        adapterId: project.id,
        serverId: registeredServer.id,
        toolCount,
      });

    return { success: true, serverId: registeredServer.id, toolCount };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Update adapter status to error
    updateAdapterProject(project.id, { status: 'error' });

    db.logActivity('system', 'forge_register_fail',
      `Registration failed: ${project.name}`, errMsg, {
        adapterId: project.id, error: errMsg,
      }, 'error');

    return { success: false, error: errMsg };
  }
}

/**
 * Disconnect and unregister a generated adapter from MCP.
 */
export async function unregisterAdapter(
  project: AdapterProject
): Promise<boolean> {
  if (!project.mcpServerId) return false;

  const mcp = getMCPManager();
  const db = getDatabase();

  try {
    await mcp.disconnectServer(project.mcpServerId);
    await mcp.removeServer(project.mcpServerId);

    updateAdapterProject(project.id, {
      status: 'approved',
      mcpServerId: null,
    });

    db.logActivity('system', 'forge_unregister',
      `Adapter unregistered: ${project.name}`, '', {
        adapterId: project.id, serverId: project.mcpServerId,
      });

    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    db.logActivity('system', 'forge_unregister_fail',
      `Unregister failed: ${project.name}`, errMsg, {}, 'error');
    return false;
  }
}
