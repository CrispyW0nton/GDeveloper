/**
 * MCP (Model Context Protocol) Server Manager
 * Uses the official @modelcontextprotocol/sdk for all transports.
 *
 * Transport selection:
 *   - stdio:  StdioClientTransport (spawns process)
 *   - sse:    SSEClientTransport (GET /sse -> endpoint event -> POST /messages/)
 *   - http:   StreamableHTTPClientTransport (POST /mcp or base URL)
 *
 * For remote URLs (http/sse), the connection logic is:
 *   1. If URL ends in /sse → try SSE first, then Streamable HTTP fallback
 *   2. If URL ends in /mcp → try Streamable HTTP first, then SSE fallback
 *   3. Otherwise → try Streamable HTTP first, then SSE fallback
 *
 * After connection: client.listTools() discovers available tools.
 * Tool execution via client.callTool().
 */

import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCPServerConfig, MCPToolInfo } from '../domain/entities';
import { MCPTransportType, MCPServerStatus } from '../domain/enums';
import { IMCPClientManager } from '../domain/interfaces';
import { getDatabase } from '../db';

export class MCPClientManager implements IMCPClientManager {
  private servers: Map<string, MCPServerConfig> = new Map();
  /** Active MCP SDK Client instances, keyed by server id */
  private mcpClients: Map<string, Client> = new Map();
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

  // --- Add / Remove -------------------------------------------------------

  async addServer(config: MCPServerConfig): Promise<MCPServerConfig> {
    // Dedupe: same name or same transport+endpoint
    for (const existing of this.servers.values()) {
      const sameTransport = existing.transport === config.transport;
      const sameName = existing.name.toLowerCase() === config.name.toLowerCase();
      const sameEndpoint = config.transport === MCPTransportType.STDIO
        ? (existing.command === config.command && JSON.stringify(existing.args) === JSON.stringify(config.args))
        : (existing.url === config.url);

      if (sameName || (sameTransport && sameEndpoint)) {
        console.warn(`[MCP] Duplicate server detected: "${config.name}" matches existing "${existing.name}" (${existing.id})`);
        return existing;
      }
    }

    const server: MCPServerConfig = { ...config, status: MCPServerStatus.DISCONNECTED };
    this.servers.set(config.id, server);
    try {
      const db = getDatabase();
      db.saveMCPServer(config);
    } catch (err) {
      console.error('[MCP] Failed to save server:', err);
    }
    this.emit({ type: 'server_added', serverId: config.id, name: config.name });
    return server;
  }

  async removeServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (server) {
      if (server.status === MCPServerStatus.CONNECTED || server.status === MCPServerStatus.CONNECTING) {
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

  // --- Connect (uses official MCP SDK) ------------------------------------

  async connectServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) throw new Error(`MCP server not found: ${id}`);

    // If already connected, disconnect first
    if (this.mcpClients.has(id)) {
      await this.disconnectServer(id);
    }

    server.status = MCPServerStatus.CONNECTING;
    this.emit({ type: 'server_connecting', serverId: id });

    try {
      let client: Client;

      if (server.transport === MCPTransportType.STDIO && server.command) {
        client = await this.connectStdio(server);
      } else if (server.url) {
        client = await this.connectRemote(server);
      } else {
        throw new Error('No command or URL configured for this server');
      }

      // Discover tools
      console.log(`[MCP:${server.name}] Requesting tool list...`);
      const toolsResult = await client.listTools();

      server.tools = (toolsResult.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        enabled: true,
        serverName: server.name,
      }));

      console.log(`[MCP:${server.name}] ✓ Discovered ${server.tools.length} tools`);

      // Store client for tool execution later
      this.mcpClients.set(id, client);

      server.status = MCPServerStatus.CONNECTED;
      server.lastConnected = new Date().toISOString();
      this.emit({ type: 'server_connected', serverId: id, tools: server.tools });

      // Persist updated tools to DB
      try {
        const db = getDatabase();
        db.saveMCPServer(server);
      } catch (err) {
        console.warn('[MCP] Failed to persist server tools to DB:', err);
      }

    } catch (error) {
      console.error(`[MCP:${server.name}] Connection failed:`, error);
      server.status = MCPServerStatus.ERROR;
      this.emit({
        type: 'server_error',
        serverId: id,
        error: `Connection failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }

  // --- STDIO transport (official SDK) -------------------------------------

  private async connectStdio(server: MCPServerConfig): Promise<Client> {
    console.log(`[MCP:${server.name}] Connecting via stdio: ${server.command} ${(server.args || []).join(' ')}`);

    const client = new Client(
      { name: 'GDeveloper', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StdioClientTransport({
      command: server.command!,
      args: server.args || [],
      env: { ...process.env, ...(server.env || {}) } as Record<string, string>,
    });

    await client.connect(transport);
    console.log(`[MCP:${server.name}] Connected via stdio`);
    return client;
  }

  // --- Remote transport (SSE / Streamable HTTP) ---------------------------
  //
  // Strategy:
  //   - URL ends in /sse  → try SSE first (it's an SSE server), fallback to Streamable HTTP
  //   - URL ends in /mcp  → try Streamable HTTP first, fallback to SSE
  //   - Other             → try Streamable HTTP first, fallback to SSE
  //
  // IMPORTANT: Each attempt creates its own Client + Transport. The SDK's
  // Client is stateful and cannot be reused across transport attempts.

  private async connectRemote(server: MCPServerConfig): Promise<Client> {
    const baseUrl = new URL(server.url!);
    const pathname = baseUrl.pathname.replace(/\/+$/, '');
    console.log(`[MCP:${server.name}] Connecting to remote: ${server.url}`);

    const isSSEUrl = pathname.endsWith('/sse');
    const isMCPUrl = pathname.endsWith('/mcp');

    if (isSSEUrl) {
      // URL clearly points to an SSE endpoint — try SSE first
      return this.trySSEThenHTTP(server, baseUrl);
    }

    // URL does NOT end in /sse — try Streamable HTTP first
    return this.tryHTTPThenSSE(server, baseUrl, isMCPUrl);
  }

  /**
   * Try SSE first at the given URL, fallback to Streamable HTTP at /mcp.
   */
  private async trySSEThenHTTP(server: MCPServerConfig, sseUrl: URL): Promise<Client> {
    // --- Attempt 1: SSE ---
    try {
      console.log(`[MCP:${server.name}] URL ends in /sse — trying SSE transport first`);
      const client = new Client(
        { name: 'GDeveloper', version: '1.0.0' },
        { capabilities: {} }
      );
      const sseTransport = new SSEClientTransport(sseUrl);
      await client.connect(sseTransport);
      console.log(`[MCP:${server.name}] ✓ Connected via SSE`);
      return client;
    } catch (sseErr) {
      console.warn(`[MCP:${server.name}] SSE failed: ${sseErr instanceof Error ? sseErr.message : sseErr}`);
      console.log(`[MCP:${server.name}] Falling back to Streamable HTTP...`);
    }

    // --- Attempt 2: Streamable HTTP at /mcp ---
    try {
      const mcpUrl = new URL(sseUrl.href.replace(/\/sse\/?$/, '/mcp'));
      console.log(`[MCP:${server.name}] Trying Streamable HTTP at ${mcpUrl.href}`);
      const client = new Client(
        { name: 'GDeveloper', version: '1.0.0' },
        { capabilities: {} }
      );
      const httpTransport = new StreamableHTTPClientTransport(mcpUrl);
      await client.connect(httpTransport);
      console.log(`[MCP:${server.name}] ✓ Connected via Streamable HTTP (fallback from SSE URL)`);
      return client;
    } catch (httpErr) {
      console.error(`[MCP:${server.name}] Streamable HTTP fallback also failed: ${httpErr instanceof Error ? httpErr.message : httpErr}`);
      throw new Error(`All transports failed for ${sseUrl.href}. SSE and Streamable HTTP both failed.`);
    }
  }

  /**
   * Try Streamable HTTP first, fallback to SSE.
   */
  private async tryHTTPThenSSE(server: MCPServerConfig, baseUrl: URL, isMCPUrl: boolean): Promise<Client> {
    // --- Attempt 1: Streamable HTTP ---
    try {
      const streamableUrl = isMCPUrl ? baseUrl : new URL(baseUrl.href.replace(/\/?$/, '/mcp'));
      console.log(`[MCP:${server.name}] Trying Streamable HTTP at ${streamableUrl.href}`);
      const client = new Client(
        { name: 'GDeveloper', version: '1.0.0' },
        { capabilities: {} }
      );
      const httpTransport = new StreamableHTTPClientTransport(streamableUrl);
      await client.connect(httpTransport);
      console.log(`[MCP:${server.name}] ✓ Connected via Streamable HTTP`);
      return client;
    } catch (httpErr) {
      console.warn(`[MCP:${server.name}] Streamable HTTP failed: ${httpErr instanceof Error ? httpErr.message : httpErr}`);
      console.log(`[MCP:${server.name}] Falling back to SSE...`);
    }

    // --- Attempt 2: SSE ---
    try {
      const sseUrl = baseUrl.pathname.endsWith('/sse')
        ? baseUrl
        : new URL(baseUrl.href.replace(/\/?$/, '/sse'));
      console.log(`[MCP:${server.name}] Trying SSE at ${sseUrl.href}`);
      const client = new Client(
        { name: 'GDeveloper', version: '1.0.0' },
        { capabilities: {} }
      );
      const sseTransport = new SSEClientTransport(sseUrl);
      await client.connect(sseTransport);
      console.log(`[MCP:${server.name}] ✓ Connected via SSE (fallback)`);
      return client;
    } catch (sseErr) {
      console.error(`[MCP:${server.name}] SSE fallback also failed: ${sseErr instanceof Error ? sseErr.message : sseErr}`);
      throw new Error(`All transports failed for ${baseUrl.href}. Streamable HTTP and SSE both failed.`);
    }
  }

  // --- Disconnect ---------------------------------------------------------

  async disconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;

    // Close the SDK client (handles transport cleanup internally)
    const client = this.mcpClients.get(id);
    if (client) {
      try {
        await client.close();
      } catch (err) {
        console.warn(`[MCP:${server.name}] Error closing client:`, err);
      }
      this.mcpClients.delete(id);
    }

    server.status = MCPServerStatus.DISCONNECTED;
    this.emit({ type: 'server_disconnected', serverId: id });
  }

  // --- Tool Execution -----------------------------------------------------

  async executeTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<any> {
    const client = this.mcpClients.get(serverId);
    if (!client) {
      throw new Error(`No active MCP client for server ${serverId}`);
    }

    const server = this.servers.get(serverId);
    console.log(`[MCP:${server?.name || serverId}] Executing tool: ${toolName}`);

    try {
      const result = await client.callTool({ name: toolName, arguments: args });
      console.log(`[MCP:${server?.name || serverId}] Tool ${toolName} completed`);
      return result;
    } catch (error) {
      console.error(`[MCP:${server?.name || serverId}] Tool ${toolName} failed:`, error);
      throw error;
    }
  }

  // --- Queries ------------------------------------------------------------

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

  // --- Test Connection ----------------------------------------------------

  async testConnection(id: string): Promise<{ reachable: boolean; mcpReady: boolean; error?: string }> {
    const server = this.servers.get(id);
    if (!server) return { reachable: false, mcpReady: false, error: 'Server not found' };

    try {
      if (server.transport === MCPTransportType.STDIO && server.command) {
        // Quick check: can we spawn the command?
        const reachable = await new Promise<boolean>((resolve) => {
          const child = spawn(server.command!, ['--version'], {
            shell: true,
            timeout: 5000
          });
          child.on('exit', (code) => resolve(code === 0));
          child.on('error', () => resolve(false));
          setTimeout(() => {
            try { child.kill(); } catch { /* ignore */ }
            resolve(false);
          }, 5000);
        });
        return { reachable, mcpReady: reachable };
      }

      if (server.url) {
        // For remote servers: try a quick GET to see if the server is reachable
        try {
          const res = await fetch(server.url, {
            method: 'GET',
            headers: { 'Accept': 'text/event-stream' },
            signal: AbortSignal.timeout(5000)
          });
          const reachable = res.ok || res.status === 405; // 405 means server exists but doesn't support GET
          // If we got 200, it's likely an SSE endpoint, so MCP is ready
          const mcpReady = res.ok;
          return { reachable, mcpReady };
        } catch (err) {
          return { reachable: false, mcpReady: false, error: err instanceof Error ? err.message : String(err) };
        }
      }

      return { reachable: false, mcpReady: false, error: 'No command or URL configured' };
    } catch (err) {
      return { reachable: false, mcpReady: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // --- Mutation helpers ---------------------------------------------------

  updateServer(id: string, updates: Partial<MCPServerConfig>): void {
    const server = this.servers.get(id);
    if (server) {
      Object.assign(server, updates);
      try {
        const db = getDatabase();
        db.saveMCPServer(server);
      } catch { /* ignore */ }
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

  // --- Lifecycle ----------------------------------------------------------

  cleanup(): void {
    for (const [id] of this.mcpClients) {
      this.disconnectServer(id).catch(() => { /* ignore */ });
    }
  }

  // --- Event system -------------------------------------------------------

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
