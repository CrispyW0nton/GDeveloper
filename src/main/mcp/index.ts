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
import { previewMCPPayload, recordMCPAuditEvent } from './audit';
import { buildMCPRemoteTransportOptions, normalizeRemoteAuth, type MCPRemoteTransportOptions } from './remoteAuth';

export interface MCPServerHealthSnapshot {
  id: string;
  name: string;
  status: MCPServerStatus;
  transport: MCPServerConfig['transport'];
  toolCount: number;
  lastConnected: string | null;
  lastHeartbeatAt: string | null;
  healthy: boolean;
  heartbeatFailureCount: number;
  reconnectAttempts: number;
  lastError: string | null;
  url: string | null;
  command: string | null;
}

export class MCPClientManager implements IMCPClientManager {
  private servers: Map<string, MCPServerConfig> = new Map();
  /** Active MCP SDK Client instances, keyed by server id */
  private mcpClients: Map<string, Client> = new Map();
  private listeners: Array<(event: MCPEvent) => void> = [];
  private readonly heartbeatIntervalMs = 30_000;
  private readonly heartbeatTimeoutMs = 7_000;
  private readonly maxReconnectAttempts = 3;
  private readonly reconnectBaseDelayMs = 2_000;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private heartbeatInFlight: Set<string> = new Set();
  private health: Map<string, MCPServerHealthSnapshot> = new Map();

  constructor() {
    this.loadFromDB();
    this.startHeartbeatLoop();
  }

  private loadFromDB(): void {
    try {
      const db = getDatabase();
      const servers = db.getMCPServers();
      for (const server of servers) {
        const hydrated: MCPServerConfig = {
          ...server,
          status: MCPServerStatus.DISCONNECTED,
          autoStart: false
        };
        this.servers.set(server.id, hydrated);
        this.health.set(server.id, {
          id: server.id,
          name: server.name,
          status: MCPServerStatus.DISCONNECTED,
          transport: server.transport,
          toolCount: server.tools?.length || 0,
          lastConnected: server.lastConnected || null,
          lastHeartbeatAt: null,
          healthy: false,
          heartbeatFailureCount: 0,
          reconnectAttempts: 0,
          lastError: null,
          url: server.url || null,
          command: server.command || null,
        });
      }
    } catch (err) {
      console.error('[MCP] Failed to load servers from DB:', err);
    }
  }

  private startHeartbeatLoop(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.runHeartbeatTick();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeatLoop(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async runHeartbeatTick(): Promise<void> {
    for (const [id, server] of this.servers.entries()) {
      if (server.status !== MCPServerStatus.CONNECTED) continue;
      const client = this.mcpClients.get(id);
      if (!client || this.heartbeatInFlight.has(id)) continue;

      this.heartbeatInFlight.add(id);
      try {
        await this.withTimeout(client.listTools(), this.heartbeatTimeoutMs, `Heartbeat timeout after ${this.heartbeatTimeoutMs}ms`);
        this.markServerHealthy(id);
      } catch (error) {
        this.handleHeartbeatFailure(id, error);
      } finally {
        this.heartbeatInFlight.delete(id);
      }
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    return Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
    ]);
  }

  private markServerHealthy(serverId: string): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    const prev = this.health.get(serverId);
    this.health.set(serverId, {
      id: server.id,
      name: server.name,
      status: server.status,
      transport: server.transport,
      toolCount: server.tools.length,
      lastConnected: server.lastConnected || null,
      lastHeartbeatAt: new Date().toISOString(),
      healthy: true,
      heartbeatFailureCount: 0,
      reconnectAttempts: this.reconnectAttempts.get(serverId) || 0,
      lastError: null,
      url: server.url || null,
      command: server.command || null,
    });

    if (prev?.healthy === false) {
      this.emit({ type: 'server_recovered', serverId, status: server.status });
    }
  }

  private handleHeartbeatFailure(serverId: string, error: unknown): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    const message = error instanceof Error ? error.message : String(error);
    const previous = this.health.get(serverId);

    server.status = MCPServerStatus.ERROR;
    this.health.set(serverId, {
      id: server.id,
      name: server.name,
      status: MCPServerStatus.ERROR,
      transport: server.transport,
      toolCount: server.tools.length,
      lastConnected: server.lastConnected || null,
      lastHeartbeatAt: new Date().toISOString(),
      healthy: false,
      heartbeatFailureCount: (previous?.heartbeatFailureCount || 0) + 1,
      reconnectAttempts: this.reconnectAttempts.get(serverId) || 0,
      lastError: message,
      url: server.url || null,
      command: server.command || null,
    });

    const client = this.mcpClients.get(serverId);
    if (client) {
      client.close().catch(() => { /* ignore */ });
      this.mcpClients.delete(serverId);
    }

    this.persistServer(server);
    this.emit({ type: 'server_error', serverId, error: `Heartbeat failed: ${message}` });
    this.scheduleReconnect(serverId);
  }

  private clearReconnectTimer(serverId: string): void {
    const timer = this.reconnectTimers.get(serverId);
    if (!timer) return;
    clearTimeout(timer);
    this.reconnectTimers.delete(serverId);
  }

  private clearReconnectState(serverId: string): void {
    this.clearReconnectTimer(serverId);
    this.reconnectAttempts.delete(serverId);
  }

  private scheduleReconnect(serverId: string): void {
    const server = this.servers.get(serverId);
    if (!server || !server.enabled) return;

    const attempt = (this.reconnectAttempts.get(serverId) || 0) + 1;
    this.reconnectAttempts.set(serverId, attempt);

    if (attempt > this.maxReconnectAttempts) {
      this.emit({
        type: 'server_error',
        serverId,
        error: `Auto-reconnect exhausted after ${this.maxReconnectAttempts} attempts`,
      });
      return;
    }

    this.clearReconnectTimer(serverId);
    const delayMs = Math.min(this.reconnectBaseDelayMs * (2 ** (attempt - 1)), 30_000);

    this.reconnectTimers.set(serverId, setTimeout(() => {
      this.reconnectTimers.delete(serverId);
      void this.attemptReconnect(serverId, attempt);
    }, delayMs));

    this.emit({ type: 'server_reconnect_scheduled', serverId, attempt, delayMs });
  }

  private async attemptReconnect(serverId: string, attempt: number): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server || !server.enabled) return;

    try {
      await this.connectServer(serverId);
      this.clearReconnectState(serverId);
      this.emit({ type: 'server_reconnected', serverId, attempt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'server_reconnect_failed', serverId, attempt, error: message });
      this.scheduleReconnect(serverId);
    }
  }

  private persistServer(server: MCPServerConfig): void {
    try {
      const db = getDatabase();
      db.saveMCPServer(server);
    } catch (err) {
      console.warn(`[MCP:${server.name}] Failed to persist server state:`, err);
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

    const server: MCPServerConfig = {
      ...config,
      remoteAuth: config.transport === MCPTransportType.STDIO ? undefined : normalizeRemoteAuth(config.remoteAuth),
      status: MCPServerStatus.DISCONNECTED,
    };
    this.servers.set(config.id, server);
    this.health.set(config.id, {
      id: config.id,
      name: config.name,
      status: MCPServerStatus.DISCONNECTED,
      transport: config.transport,
      toolCount: 0,
      lastConnected: null,
      lastHeartbeatAt: null,
      healthy: false,
      heartbeatFailureCount: 0,
      reconnectAttempts: 0,
      lastError: null,
      url: config.url || null,
      command: config.command || null,
    });
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
      this.clearReconnectState(id);
      this.servers.delete(id);
      this.health.delete(id);
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

    this.clearReconnectTimer(id);
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
      this.markServerHealthy(id);
      this.emit({ type: 'server_connected', serverId: id, tools: server.tools });

      // Persist updated tools to DB
      this.persistServer(server);

    } catch (error) {
      console.error(`[MCP:${server.name}] Connection failed:`, error);
      const message = error instanceof Error ? error.message : String(error);
      server.status = MCPServerStatus.ERROR;
      const existing = this.health.get(id);
      this.health.set(id, {
        id: server.id,
        name: server.name,
        status: MCPServerStatus.ERROR,
        transport: server.transport,
        toolCount: server.tools.length,
        lastConnected: server.lastConnected || null,
        lastHeartbeatAt: new Date().toISOString(),
        healthy: false,
        heartbeatFailureCount: existing?.heartbeatFailureCount || 0,
        reconnectAttempts: this.reconnectAttempts.get(id) || 0,
        lastError: `Connection failed: ${message}`,
        url: server.url || null,
        command: server.command || null,
      });
      this.persistServer(server);
      this.emit({
        type: 'server_error',
        serverId: id,
        error: `Connection failed: ${message}`
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
    const transportOptions = buildMCPRemoteTransportOptions(server);
    recordMCPAuditEvent({
      kind: 'server',
      action: 'remote_auth_preflight',
      status: 'success',
      serverId: server.id,
      serverName: server.name,
      transport: server.transport,
      inputPreview: previewMCPPayload(transportOptions.authPreview),
    });

    const isSSEUrl = pathname.endsWith('/sse');
    const isMCPUrl = pathname.endsWith('/mcp');

    if (isSSEUrl) {
      // URL clearly points to an SSE endpoint — try SSE first
      return this.trySSEThenHTTP(server, baseUrl, transportOptions);
    }

    // URL does NOT end in /sse — try Streamable HTTP first
    return this.tryHTTPThenSSE(server, baseUrl, isMCPUrl, transportOptions);
  }

  /**
   * Try SSE first at the given URL, fallback to Streamable HTTP at /mcp.
   */
  private async trySSEThenHTTP(server: MCPServerConfig, sseUrl: URL, options: MCPRemoteTransportOptions): Promise<Client> {
    // --- Attempt 1: SSE ---
    try {
      console.log(`[MCP:${server.name}] URL ends in /sse — trying SSE transport first`);
      const client = new Client(
        { name: 'GDeveloper', version: '1.0.0' },
        { capabilities: {} }
      );
      const sseTransport = new SSEClientTransport(sseUrl, {
        requestInit: options.requestInit,
        eventSourceInit: { fetch: options.fetch },
        fetch: options.fetch,
      });
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
      const httpTransport = new StreamableHTTPClientTransport(mcpUrl, {
        requestInit: options.requestInit,
        fetch: options.fetch,
        reconnectionOptions: {
          initialReconnectionDelay: 1_000,
          maxReconnectionDelay: 30_000,
          reconnectionDelayGrowFactor: 1.5,
          maxRetries: 2,
        },
      });
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
  private async tryHTTPThenSSE(server: MCPServerConfig, baseUrl: URL, isMCPUrl: boolean, options: MCPRemoteTransportOptions): Promise<Client> {
    // --- Attempt 1: Streamable HTTP ---
    try {
      const streamableUrl = isMCPUrl ? baseUrl : new URL(baseUrl.href.replace(/\/?$/, '/mcp'));
      console.log(`[MCP:${server.name}] Trying Streamable HTTP at ${streamableUrl.href}`);
      const client = new Client(
        { name: 'GDeveloper', version: '1.0.0' },
        { capabilities: {} }
      );
      const httpTransport = new StreamableHTTPClientTransport(streamableUrl, {
        requestInit: options.requestInit,
        fetch: options.fetch,
        reconnectionOptions: {
          initialReconnectionDelay: 1_000,
          maxReconnectionDelay: 30_000,
          reconnectionDelayGrowFactor: 1.5,
          maxRetries: 2,
        },
      });
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
      const sseTransport = new SSEClientTransport(sseUrl, {
        requestInit: options.requestInit,
        eventSourceInit: { fetch: options.fetch },
        fetch: options.fetch,
      });
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

    this.clearReconnectState(id);

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
    const existing = this.health.get(id);
    this.health.set(id, {
      id: server.id,
      name: server.name,
      status: MCPServerStatus.DISCONNECTED,
      transport: server.transport,
      toolCount: server.tools.length,
      lastConnected: server.lastConnected || null,
      lastHeartbeatAt: existing?.lastHeartbeatAt || null,
      healthy: false,
      heartbeatFailureCount: 0,
      reconnectAttempts: 0,
      lastError: null,
      url: server.url || null,
      command: server.command || null,
    });
    this.persistServer(server);
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
    const startedAt = Date.now();
    recordMCPAuditEvent({
      kind: 'tool',
      action: 'call',
      status: 'running',
      serverId,
      serverName: server?.name,
      toolName,
      transport: server?.transport,
      inputPreview: previewMCPPayload(args),
    });

    try {
      const result = await client.callTool({ name: toolName, arguments: args });
      console.log(`[MCP:${server?.name || serverId}] Tool ${toolName} completed`);
      recordMCPAuditEvent({
        kind: 'tool',
        action: 'result',
        status: 'success',
        serverId,
        serverName: server?.name,
        toolName,
        transport: server?.transport,
        latencyMs: Date.now() - startedAt,
        outputPreview: previewMCPPayload(result),
      });
      return result;
    } catch (error) {
      console.error(`[MCP:${server?.name || serverId}] Tool ${toolName} failed:`, error);
      recordMCPAuditEvent({
        kind: 'tool',
        action: 'error',
        status: 'error',
        serverId,
        serverName: server?.name,
        toolName,
        transport: server?.transport,
        latencyMs: Date.now() - startedAt,
        inputPreview: previewMCPPayload(args),
        error: error instanceof Error ? error.message : String(error),
      });
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

  getHealthStatus(): MCPServerHealthSnapshot[] {
    return Array.from(this.servers.values()).map((server) => {
      const existing = this.health.get(server.id);
      return {
        id: server.id,
        name: server.name,
        status: server.status,
        transport: server.transport,
        toolCount: server.tools.length,
        lastConnected: server.lastConnected || null,
        lastHeartbeatAt: existing?.lastHeartbeatAt || null,
        healthy: existing?.healthy || false,
        heartbeatFailureCount: existing?.heartbeatFailureCount || 0,
        reconnectAttempts: this.reconnectAttempts.get(server.id) || existing?.reconnectAttempts || 0,
        lastError: existing?.lastError || null,
        url: server.url || null,
        command: server.command || null,
      };
    });
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
            shell: false,
            timeout: 5000,
            stdio: 'ignore',
            windowsHide: true,
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
          const remoteOptions = buildMCPRemoteTransportOptions(server);
          const res = await fetch(server.url, {
            method: 'GET',
            headers: remoteOptions.requestInit.headers,
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
      this.persistServer(server);
    }
  }

  toggleTool(serverId: string, toolName: string, enabled: boolean): void {
    const server = this.servers.get(serverId);
    if (server) {
      const tool = server.tools.find(t => t.name === toolName);
      if (tool) {
        tool.enabled = enabled;
        try {
          const db = getDatabase();
          db.saveMCPServer(server);
        } catch (err) {
          console.warn(`[MCP:${server.name}] Failed to persist tool toggle for ${toolName}:`, err);
        }
        this.emit({ type: 'tool_toggled', serverId, toolName, enabled });
        recordMCPAuditEvent({
          kind: 'permission',
          action: enabled ? 'tool_enabled' : 'tool_disabled',
          status: 'success',
          serverId,
          serverName: server.name,
          toolName,
          transport: server.transport,
        });
      }
    }
  }

  // --- Lifecycle ----------------------------------------------------------

  cleanup(): void {
    this.stopHeartbeatLoop();
    for (const [id] of this.reconnectTimers) {
      this.clearReconnectTimer(id);
    }
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
