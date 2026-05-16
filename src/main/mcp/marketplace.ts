import { MCPTransportType, MCPServerStatus } from '../domain/enums';
import type { MCPServerConfig } from '../domain/entities';

export const MCP_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';

export interface MCPMarketplaceEntry {
  name: string;
  title: string;
  description: string;
  version?: string;
  status?: string;
  source: 'official';
  packages: any[];
  remotes: any[];
  raw: any;
}

export interface MCPMarketplaceInstallPreview {
  entry: MCPMarketplaceEntry;
  installable: boolean;
  reason?: string;
  config?: MCPServerConfig;
  permissionPreview: string[];
}

export async function searchMCPMarketplace(query = '', limit = 20): Promise<MCPMarketplaceEntry[]> {
  const url = new URL('/v0.1/servers', MCP_REGISTRY_BASE_URL);
  url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 100))));
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MCP registry request failed: ${response.status}`);
  }
  const payload = await response.json();
  const servers = Array.isArray(payload?.servers) ? payload.servers : [];
  const entries = servers.map(normalizeMarketplaceEntry).filter(Boolean) as MCPMarketplaceEntry[];
  const needle = query.trim().toLowerCase();
  if (!needle) return entries.slice(0, limit);
  return entries.filter(entry =>
    entry.name.toLowerCase().includes(needle) ||
    entry.title.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle)
  ).slice(0, limit);
}

export async function getMCPMarketplaceEntry(serverName: string): Promise<MCPMarketplaceEntry> {
  const encoded = encodeURIComponent(serverName);
  const url = new URL(`/v0.1/servers/${encoded}/versions/latest`, MCP_REGISTRY_BASE_URL);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MCP registry detail request failed: ${response.status}`);
  }
  return normalizeMarketplaceEntry(await response.json()) || {
    name: serverName,
    title: serverName,
    description: '',
    source: 'official',
    packages: [],
    remotes: [],
    raw: {},
  };
}

export function buildMarketplaceInstallPreview(entry: MCPMarketplaceEntry): MCPMarketplaceInstallPreview {
  const remote = entry.remotes.find(r => r?.url && ['streamable-http', 'http', 'sse'].includes(String(r?.transport?.type || r?.transport || '').toLowerCase()));
  if (remote?.url) {
    const transportType = String(remote?.transport?.type || remote.transport || '').toLowerCase();
    const transport = transportType === 'sse' ? MCPTransportType.SSE : MCPTransportType.HTTP;
    const config = baseConfig(entry, transport);
    config.url = remote.url;
    return {
      entry,
      installable: true,
      config,
      permissionPreview: [
        `Remote MCP endpoint: ${remote.url}`,
        'Network access is controlled by the remote server.',
        'Tools will remain disabled until the server is connected and tool list is discovered.',
      ],
    };
  }

  const pkg = entry.packages.find(p => p?.identifier || p?.name);
  if (!pkg) {
    return {
      entry,
      installable: false,
      reason: 'No package or remote endpoint metadata found in registry entry.',
      permissionPreview: ['No install method could be inferred.'],
    };
  }

  const registryType = String(pkg.registryType || pkg.registry || '').toLowerCase();
  const identifier = String(pkg.identifier || pkg.name || '').trim();
  const config = baseConfig(entry, MCPTransportType.STDIO);

  if (registryType === 'npm') {
    config.command = 'npx';
    config.args = ['-y', identifier];
  } else if (registryType === 'pypi') {
    config.command = 'uvx';
    config.args = [identifier];
  } else if (registryType === 'oci' || registryType === 'docker') {
    config.command = 'docker';
    config.args = ['run', '--rm', '-i', identifier];
  } else {
    return {
      entry,
      installable: false,
      reason: `Unsupported package registry type: ${registryType || '(unknown)'}.`,
      permissionPreview: [`Package identifier: ${identifier || '(missing)'}`],
    };
  }

  return {
    entry,
    installable: true,
    config,
    permissionPreview: [
      `Local command: ${[config.command, ...(config.args || [])].filter(Boolean).join(' ')}`,
      'Runs as a local stdio MCP server when connected.',
      'Review package provenance and required environment variables before connecting.',
    ],
  };
}

function baseConfig(entry: MCPMarketplaceEntry, transport: MCPTransportType): MCPServerConfig {
  return {
    id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: entry.name,
    transport,
    enabled: true,
    autoStart: false,
    status: MCPServerStatus.DISCONNECTED,
    tools: [],
  };
}

function normalizeMarketplaceEntry(raw: any): MCPMarketplaceEntry | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return {
      name: raw,
      title: raw,
      description: '',
      source: 'official',
      packages: [],
      remotes: [],
      raw,
    };
  }

  const name = String(raw.name || raw.serverName || raw.id || '').trim();
  if (!name) return null;
  return {
    name,
    title: String(raw.title || raw.displayName || name),
    description: String(raw.description || raw.summary || ''),
    version: raw.version ? String(raw.version) : undefined,
    status: raw.status ? String(raw.status) : undefined,
    source: 'official',
    packages: Array.isArray(raw.packages) ? raw.packages : [],
    remotes: Array.isArray(raw.remotes) ? raw.remotes : Array.isArray(raw.remote) ? raw.remote : [],
    raw,
  };
}
