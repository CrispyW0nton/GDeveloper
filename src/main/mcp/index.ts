/**
 * MCP (Model Context Protocol) Server Manager
 * Real stdio process spawning for MCP servers
 * Manages server lifecycle, tool discovery, enable/disable
 * Persists server configs in SQLite
 */

import { spawn, ChildProcess } from 'child_process';
import { MCPServerConfig, MCPToolInfo } from '../domain/entities';
import { MCPTransportType, MCPServerStatus } from '../domain/enums';
import { IMCPClientManager } from '../domain/interfaces';
import { getDatabase } from '../db';

interface MCPProcess {
  process: ChildProcess;
  serverId: string;
}

export class MCPClientManager implements IMCPClientManager {
  private servers: Map<string, MCPServerConfig> = new Map();
  private processes: Map<string, MCPProcess> = new Map();
  private listeners: Array<(event: MCPEvent) => void> = [];

  constructor() {
    this.loadFromDB();
  }

  private loadFromDB(): void {
    try {
      const db = getDatabase();
      const servers = db.getMCPServers();
      for (const server of servers) {
        this.servers.set(server.id, {
          ...server,
          status: MCPServerStatus.DISCONNECTED,
          autoStart: false
        });
      }
    } catch (err) {
      console.error('[MCP] Failed to load servers from DB:', err);
    }
  }

  async addServer(config: MCPServerConfig): Promise<void> {
    const server = { ...config, status: MCPServerStatus.DISCONNECTED };
    this.servers.set(config.id, server);
    // Persist to DB
    try {
      const db = getDatabase();
      db.saveMCPServer(config);
    } catch (err) {
      console.error('[MCP] Failed to save server:', err);
    }
    this.emit({ type: 'server_added', serverId: config.id, name: config.name });
  }

  async removeServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (server) {
      if (server.status === MCPServerStatus.CONNECTED) {
        await this.disconnectServer(id);
      }
      this.servers.delete(id);
      try {
        const db = getDatabase();
        db.removeMCPServer(id);
      } catch (err) {
        console.error('[MCP] Failed to remove server from DB:', err);
      }
      this.emit({ type: 'server_removed', serverId: id });
    }
  }

  async connectServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) throw new Error(`MCP server not found: ${id}`);

    server.status = MCPServerStatus.CONNECTING;
    this.emit({ type: 'server_connecting', serverId: id });

    try {
      if (server.transport === MCPTransportType.STDIO && server.command) {
        // Spawn the MCP server process
        const env = { ...process.env, ...(server.env || {}) };
        const child = spawn(server.command, server.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
          shell: true
        });

        // Track the process
        this.processes.set(id, { process: child, serverId: id });

        // Handle process events
        child.on('error', (err) => {
          console.error(`[MCP:${server.name}] Process error:`, err);
          server.status = MCPServerStatus.ERROR;
          this.emit({ type: 'server_error', serverId: id, error: err.message });
        });

        child.on('exit', (code) => {
          console.log(`[MCP:${server.name}] Process exited with code ${code}`);
          this.processes.delete(id);
          if (server.status !== MCPServerStatus.DISCONNECTED) {
            server.status = MCPServerStatus.DISCONNECTED;
            this.emit({ type: 'server_disconnected', serverId: id });
          }
        });

        // Collect initial output for tool discovery
        let stdoutBuffer = '';
        child.stdout?.on('data', (data: Buffer) => {
          stdoutBuffer += data.toString();
          // Try to parse JSON-RPC messages for tool discovery
          this.tryParseToolDiscovery(id, stdoutBuffer);
        });

        child.stderr?.on('data', (data: Buffer) => {
          console.log(`[MCP:${server.name}] stderr:`, data.toString().trim());
        });

        // Send initialize request (MCP protocol)
        const initRequest = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'GDeveloper', version: '1.0.0' }
          }
        });
        child.stdin?.write(initRequest + '\n');

        // Wait briefly for initialization
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Send tools/list request
        const toolsRequest = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {}
        });
        child.stdin?.write(toolsRequest + '\n');

        // Wait for tool discovery
        await new Promise(resolve => setTimeout(resolve, 1500));

        server.status = MCPServerStatus.CONNECTED;
        server.lastConnected = new Date().toISOString();
        this.emit({ type: 'server_connected', serverId: id, tools: server.tools });
      } else {
        // HTTP/SSE transport - attempt basic connectivity check
        if (server.url) {
          try {
            const response = await fetch(server.url, { method: 'GET', signal: AbortSignal.timeout(5000) });
            if (response.ok) {
              server.status = MCPServerStatus.CONNECTED;
              server.lastConnected = new Date().toISOString();
              this.emit({ type: 'server_connected', serverId: id, tools: server.tools });
            } else {
              throw new Error(`HTTP ${response.status}`);
            }
          } catch (err) {
            server.status = MCPServerStatus.ERROR;
            this.emit({ type: 'server_error', serverId: id, error: String(err) });
            throw err;
          }
        }
      }
    } catch (error) {
      if ((server.status as string) !== MCPServerStatus.ERROR) {
        server.status = MCPServerStatus.ERROR;
        this.emit({ type: 'server_error', serverId: id, error: String(error) });
      }
      throw error;
    }
  }

  private tryParseToolDiscovery(serverId: string, buffer: string): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    // Try to parse JSON-RPC responses from the buffer
    const lines = buffer.split('\n');
    for (const line of lines) {
      try {
        const msg = JSON.parse(line.trim());
        if (msg.result?.tools && Array.isArray(msg.result.tools)) {
          server.tools = msg.result.tools.map((t: any) => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
            enabled: true,
            serverName: server.name
          }));
          console.log(`[MCP:${server.name}] Discovered ${server.tools.length} tools`);
          this.emit({ type: 'tools_discovered', serverId, tools: server.tools });
        }
      } catch {
        // Not a complete JSON line, skip
      }
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;

    // Kill the process if running
    const proc = this.processes.get(id);
    if (proc) {
      try {
        proc.process.kill('SIGTERM');
        // Force kill after 3 seconds
        setTimeout(() => {
          try { proc.process.kill('SIGKILL'); } catch {}
        }, 3000);
      } catch {}
      this.processes.delete(id);
    }

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
      if (server.transport === MCPTransportType.STDIO && server.command) {
        // Test by spawning briefly
        return new Promise((resolve) => {
          const child = spawn(server.command!, ['--version'], {
            shell: true,
            timeout: 5000
          });
          child.on('exit', (code) => resolve(code === 0));
          child.on('error', () => resolve(false));
          setTimeout(() => {
            try { child.kill(); } catch {}
            resolve(false);
          }, 5000);
        });
      }
      if (server.url) {
        const res = await fetch(server.url, { signal: AbortSignal.timeout(5000) });
        return res.ok;
      }
      return false;
    } catch {
      return false;
    }
  }

  updateServer(id: string, updates: Partial<MCPServerConfig>): void {
    const server = this.servers.get(id);
    if (server) {
      Object.assign(server, updates);
      try {
        const db = getDatabase();
        db.saveMCPServer(server);
      } catch {}
    }
  }

  toggleTool(serverId: string, toolName: string, enabled: boolean): void {
    const server = this.servers.get(serverId);
    if (server) {
      const tool = server.tools.find(t => t.name === toolName);
      if (tool) {
        tool.enabled = enabled;
      }
    }
  }

  // Cleanup all processes on app quit
  cleanup(): void {
    for (const [id] of this.processes) {
      this.disconnectServer(id).catch(() => {});
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
