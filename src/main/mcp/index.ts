/**
 * MCP (Model Context Protocol) Server Manager
 * Supports stdio, http, sse transports
 * Manages server lifecycle, tool discovery, enable/disable
 * Uses @modelcontextprotocol/sdk TypeScript SDK patterns
 */

import { MCPServerConfig, MCPToolInfo } from '../domain/entities';
import { MCPTransportType, MCPServerStatus } from '../domain/enums';
import { IMCPClientManager } from '../domain/interfaces';
import { getToolRegistry } from '../tools';

// Demo MCP Servers
const DEMO_MCP_SERVERS: MCPServerConfig[] = [
  {
    id: 'mcp-filesystem',
    name: 'Filesystem Server',
    transport: MCPTransportType.STDIO,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    enabled: true,
    autoStart: true,
    status: MCPServerStatus.DISCONNECTED,
    tools: [
      {
        name: 'fs_read',
        description: 'Read file contents from the filesystem',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        enabled: true,
        serverName: 'Filesystem Server'
      },
      {
        name: 'fs_write',
        description: 'Write content to a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
        enabled: true,
        serverName: 'Filesystem Server'
      },
      {
        name: 'fs_list',
        description: 'List directory contents',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        enabled: true,
        serverName: 'Filesystem Server'
      }
    ]
  },
  {
    id: 'mcp-github',
    name: 'GitHub MCP Server',
    transport: MCPTransportType.STDIO,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    enabled: false,
    autoStart: false,
    status: MCPServerStatus.DISCONNECTED,
    tools: [
      {
        name: 'github_search_repos',
        description: 'Search GitHub repositories',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        enabled: true,
        serverName: 'GitHub MCP Server'
      },
      {
        name: 'github_get_issue',
        description: 'Get issue details',
        inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, number: { type: 'number' } }, required: ['owner', 'repo', 'number'] },
        enabled: true,
        serverName: 'GitHub MCP Server'
      }
    ]
  },
  {
    id: 'mcp-unreal-ghost',
    name: 'Unreal MCP Ghost',
    transport: MCPTransportType.STDIO,
    command: 'python',
    args: ['-m', 'unreal_mcp_ghost'],
    enabled: false,
    autoStart: false,
    status: MCPServerStatus.DISCONNECTED,
    tools: [
      {
        name: 'ue_get_actors',
        description: 'Get all actors in the current Unreal Engine level',
        inputSchema: { type: 'object', properties: {} },
        enabled: true,
        serverName: 'Unreal MCP Ghost'
      },
      {
        name: 'ue_spawn_actor',
        description: 'Spawn an actor in Unreal Engine',
        inputSchema: { type: 'object', properties: { class_name: { type: 'string' }, location: { type: 'object' } }, required: ['class_name'] },
        enabled: true,
        serverName: 'Unreal MCP Ghost'
      }
    ]
  }
];

export class MCPClientManager implements IMCPClientManager {
  private servers: Map<string, MCPServerConfig> = new Map();
  private listeners: Array<(event: MCPEvent) => void> = [];

  constructor() {
    // Load demo servers
    DEMO_MCP_SERVERS.forEach(s => this.servers.set(s.id, { ...s }));
  }

  async addServer(config: MCPServerConfig): Promise<void> {
    this.servers.set(config.id, { ...config, status: MCPServerStatus.DISCONNECTED });
    this.emit({ type: 'server_added', serverId: config.id, name: config.name });
  }

  async removeServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (server) {
      if (server.status === MCPServerStatus.CONNECTED) {
        await this.disconnectServer(id);
      }
      // Unregister tools from global registry
      const toolRegistry = getToolRegistry();
      server.tools.forEach(t => toolRegistry.unregister(t.name));
      this.servers.delete(id);
      this.emit({ type: 'server_removed', serverId: id });
    }
  }

  async connectServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) throw new Error(`MCP server not found: ${id}`);

    server.status = MCPServerStatus.CONNECTING;
    this.emit({ type: 'server_connecting', serverId: id });

    try {
      // In Electron: use @modelcontextprotocol/client with appropriate transport
      // stdio: spawn child process with server.command + server.args
      // http/sse: connect to server.url
      await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate connection

      server.status = MCPServerStatus.CONNECTED;
      server.lastConnected = new Date().toISOString();

      // Register MCP tools in the global tool registry
      const toolRegistry = getToolRegistry();
      server.tools.filter(t => t.enabled).forEach(tool => {
        toolRegistry.register({
          name: tool.name,
          description: `[MCP:${server.name}] ${tool.description}`,
          category: 'mcp' as any,
          permissionTier: 'write' as any,
          inputSchema: tool.inputSchema,
          source: 'mcp',
          mcpServerName: server.name,
          execute: async (input) => ({
            success: true,
            output: `[MCP:${server.name}/${tool.name}] Executed with input: ${JSON.stringify(input)}`
          })
        });
      });

      this.emit({ type: 'server_connected', serverId: id, tools: server.tools });
    } catch (error) {
      server.status = MCPServerStatus.ERROR;
      this.emit({ type: 'server_error', serverId: id, error: String(error) });
      throw error;
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;

    // Unregister MCP tools
    const toolRegistry = getToolRegistry();
    server.tools.forEach(t => toolRegistry.unregister(t.name));

    server.status = MCPServerStatus.DISCONNECTED;
    this.emit({ type: 'server_disconnected', serverId: id });
  }

  getServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  getServer(id: string): MCPServerConfig | undefined {
    return this.servers.get(id);
  }

  async getServerTools(id: string): Promise<MCPToolInfo[]> {
    const server = this.servers.get(id);
    return server?.tools || [];
  }

  async testConnection(id: string): Promise<boolean> {
    const server = this.servers.get(id);
    if (!server) return false;

    try {
      // Simulate connection test
      await new Promise(resolve => setTimeout(resolve, 800));
      return true;
    } catch {
      return false;
    }
  }

  updateServer(id: string, updates: Partial<MCPServerConfig>): void {
    const server = this.servers.get(id);
    if (server) {
      Object.assign(server, updates);
    }
  }

  toggleTool(serverId: string, toolName: string, enabled: boolean): void {
    const server = this.servers.get(serverId);
    if (server) {
      const tool = server.tools.find(t => t.name === toolName);
      if (tool) {
        tool.enabled = enabled;
        // Update in tool registry
        const toolRegistry = getToolRegistry();
        if (enabled && server.status === MCPServerStatus.CONNECTED) {
          toolRegistry.register({
            name: tool.name,
            description: `[MCP:${server.name}] ${tool.description}`,
            category: 'mcp' as any,
            permissionTier: 'write' as any,
            inputSchema: tool.inputSchema,
            source: 'mcp',
            mcpServerName: server.name,
            execute: async (input) => ({
              success: true,
              output: `[MCP:${server.name}/${tool.name}] Executed`
            })
          });
        } else {
          toolRegistry.unregister(tool.name);
        }
      }
    }
  }

  // Event system
  onEvent(listener: (event: MCPEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: MCPEvent): void {
    this.listeners.forEach(l => l(event));
  }
}

export interface MCPEvent {
  type: string;
  serverId?: string;
  [key: string]: unknown;
}

// Singleton
let mcpInstance: MCPClientManager | null = null;

export function getMCPManager(): MCPClientManager {
  if (!mcpInstance) {
    mcpInstance = new MCPClientManager();
  }
  return mcpInstance;
}
