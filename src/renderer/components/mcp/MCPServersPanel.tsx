import React, { useState } from 'react';

// MCP types for UI
interface MCPServer {
  id: string;
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  tools: MCPTool[];
}

interface MCPTool {
  name: string;
  description: string;
  enabled: boolean;
}

// Demo data
const INITIAL_SERVERS: MCPServer[] = [
  {
    id: 'mcp-filesystem',
    name: 'Filesystem Server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    enabled: true,
    status: 'disconnected',
    tools: [
      { name: 'fs_read', description: 'Read file contents', enabled: true },
      { name: 'fs_write', description: 'Write content to file', enabled: true },
      { name: 'fs_list', description: 'List directory contents', enabled: true },
      { name: 'fs_search', description: 'Search files by pattern', enabled: true }
    ]
  },
  {
    id: 'mcp-github',
    name: 'GitHub MCP Server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    enabled: false,
    status: 'disconnected',
    tools: [
      { name: 'github_search_repos', description: 'Search GitHub repositories', enabled: true },
      { name: 'github_get_issue', description: 'Get issue details', enabled: true },
      { name: 'github_list_prs', description: 'List pull requests', enabled: true }
    ]
  },
  {
    id: 'mcp-unreal',
    name: 'Unreal MCP Ghost',
    transport: 'stdio',
    command: 'python',
    args: ['-m', 'unreal_mcp_ghost'],
    enabled: false,
    status: 'disconnected',
    tools: [
      { name: 'ue_get_actors', description: 'Get all actors in current level', enabled: true },
      { name: 'ue_spawn_actor', description: 'Spawn an actor in UE', enabled: true },
      { name: 'ue_set_property', description: 'Set actor property', enabled: true },
      { name: 'ue_run_blueprint', description: 'Execute a blueprint function', enabled: true }
    ]
  }
];

export default function MCPServersPanel() {
  const [servers, setServers] = useState<MCPServer[]>(INITIAL_SERVERS);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', transport: 'stdio' as const, command: '', args: '', url: '' });
  const [testing, setTesting] = useState<string | null>(null);

  const selected = servers.find(s => s.id === selectedServer);

  const handleConnect = async (id: string) => {
    setServers(prev => prev.map(s => s.id === id ? { ...s, status: 'connecting' as const } : s));
    await new Promise(resolve => setTimeout(resolve, 1500));
    setServers(prev => prev.map(s => s.id === id ? { ...s, status: 'connected' as const } : s));
  };

  const handleDisconnect = (id: string) => {
    setServers(prev => prev.map(s => s.id === id ? { ...s, status: 'disconnected' as const } : s));
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    await new Promise(resolve => setTimeout(resolve, 800));
    setTesting(null);
  };

  const handleToggleTool = (serverId: string, toolName: string) => {
    setServers(prev => prev.map(s => {
      if (s.id !== serverId) return s;
      return { ...s, tools: s.tools.map(t => t.name === toolName ? { ...t, enabled: !t.enabled } : t) };
    }));
  };

  const handleRemove = (id: string) => {
    setServers(prev => prev.filter(s => s.id !== id));
    if (selectedServer === id) setSelectedServer(null);
  };

  const handleAddServer = () => {
    const server: MCPServer = {
      id: `mcp-${Date.now()}`,
      name: newServer.name,
      transport: newServer.transport,
      command: newServer.transport === 'stdio' ? newServer.command : undefined,
      args: newServer.transport === 'stdio' ? newServer.args.split(' ').filter(Boolean) : undefined,
      url: newServer.transport !== 'stdio' ? newServer.url : undefined,
      enabled: true,
      status: 'disconnected',
      tools: []
    };
    setServers(prev => [...prev, server]);
    setShowAddDialog(false);
    setNewServer({ name: '', transport: 'stdio', command: '', args: '', url: '' });
  };

  const statusColors: Record<string, string> = {
    connected: 'bg-matrix-green',
    connecting: 'bg-matrix-warning animate-pulseDot',
    disconnected: 'bg-matrix-text-muted/20',
    error: 'bg-matrix-danger'
  };

  return (
    <div className="h-full flex">
      {/* Server List */}
      <div className="w-80 border-r border-matrix-border flex flex-col">
        <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-matrix-green glow-text-dim flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="6" rx="1"/><rect x="2" y="15" width="20" height="6" rx="1"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></svg>
            MCP Servers
          </h2>
          <button onClick={() => setShowAddDialog(true)} className="matrix-btn px-2 py-1 text-[10px]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {servers.map(server => (
            <button
              key={server.id}
              onClick={() => setSelectedServer(server.id)}
              className={`w-full px-4 py-3 text-left border-b border-matrix-border/30 transition-all ${
                selectedServer === server.id ? 'bg-matrix-green/5 border-l-2 border-l-matrix-green' : 'hover:bg-matrix-bg-hover'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-matrix-green font-bold">{server.name}</span>
                <span className={`w-2 h-2 rounded-full ${statusColors[server.status]}`} />
              </div>
              <div className="flex items-center gap-2 text-[10px] text-matrix-text-muted/40">
                <span className="badge badge-planned text-[8px] py-0">{server.transport}</span>
                <span>{server.tools.length} tools</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Server Detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-matrix-green">{selected.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`badge ${selected.status === 'connected' ? 'badge-connected' : selected.status === 'error' ? 'badge-error' : 'badge-disconnected'}`}>
                    {selected.status}
                  </span>
                  <span className="badge badge-planned text-[9px]">{selected.transport}</span>
                </div>
              </div>
              <div className="flex gap-2">
                {selected.status === 'connected' ? (
                  <button onClick={() => handleDisconnect(selected.id)} className="matrix-btn matrix-btn-danger text-xs">Disconnect</button>
                ) : (
                  <button onClick={() => handleConnect(selected.id)} disabled={selected.status === 'connecting'} className="matrix-btn matrix-btn-primary text-xs">
                    {selected.status === 'connecting' ? (
                      <><span className="w-3 h-3 border border-matrix-green/50 border-t-matrix-green rounded-full animate-spin" /> Connecting...</>
                    ) : 'Connect'}
                  </button>
                )}
                <button onClick={() => handleTest(selected.id)} disabled={testing === selected.id} className="matrix-btn text-xs">
                  {testing === selected.id ? 'Testing...' : 'Test'}
                </button>
                <button onClick={() => handleRemove(selected.id)} className="matrix-btn matrix-btn-danger text-xs">Remove</button>
              </div>
            </div>

            {/* Connection Info */}
            <div className="glass-panel p-4 space-y-2">
              <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-2">Connection Details</h4>
              {selected.transport === 'stdio' ? (
                <>
                  <div className="flex gap-2 text-xs">
                    <span className="text-matrix-text-muted/40 w-16">Command:</span>
                    <code className="text-matrix-green">{selected.command}</code>
                  </div>
                  {selected.args && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-matrix-text-muted/40 w-16">Args:</span>
                      <code className="text-matrix-green">{selected.args.join(' ')}</code>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex gap-2 text-xs">
                  <span className="text-matrix-text-muted/40 w-16">URL:</span>
                  <code className="text-matrix-green">{selected.url || 'Not configured'}</code>
                </div>
              )}
            </div>

            {/* Tools Browser */}
            <div className="glass-panel p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider">Discovered Tools ({selected.tools.length})</h4>
              </div>
              <div className="space-y-2">
                {selected.tools.map(tool => (
                  <div key={tool.name} className="flex items-center justify-between p-2 bg-matrix-bg-hover/30 rounded">
                    <div className="flex-1">
                      <div className="text-xs text-matrix-green font-bold">{tool.name}</div>
                      <div className="text-[10px] text-matrix-text-muted/40">{tool.description}</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tool.enabled}
                        onChange={() => handleToggleTool(selected.id, tool.name)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-matrix-border rounded-full peer-checked:bg-matrix-green/30 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-matrix-text-muted/40 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4 peer-checked:after:bg-matrix-green" />
                    </label>
                  </div>
                ))}
                {selected.tools.length === 0 && (
                  <p className="text-xs text-matrix-text-muted/30 text-center py-4">
                    {selected.status === 'connected' ? 'No tools discovered' : 'Connect to discover tools'}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-matrix-text-muted/20 mb-3"><rect x="2" y="3" width="20" height="6" rx="1"/><rect x="2" y="15" width="20" height="6" rx="1"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></svg>
              <p className="text-xs text-matrix-text-muted/30">Select a server to view details</p>
              <p className="text-[10px] text-matrix-text-muted/20 mt-1">
                MCP Spec: <a href="https://modelcontextprotocol.io/specification/2025-06-18" target="_blank" className="text-matrix-info/40 hover:text-matrix-info underline">modelcontextprotocol.io</a>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Add Server Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-panel-solid p-6 w-[480px] animate-fadeIn">
            <h3 className="text-sm font-bold text-matrix-green mb-4 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add MCP Server
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">Server Name</label>
                <input value={newServer.name} onChange={e => setNewServer(p => ({ ...p, name: e.target.value }))} className="matrix-input" placeholder="My MCP Server" />
              </div>
              <div>
                <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">Transport</label>
                <select value={newServer.transport} onChange={e => setNewServer(p => ({ ...p, transport: e.target.value as any }))} className="matrix-select">
                  <option value="stdio">stdio (local process)</option>
                  <option value="http">HTTP (remote)</option>
                  <option value="sse">SSE (Server-Sent Events)</option>
                </select>
              </div>
              {newServer.transport === 'stdio' ? (
                <>
                  <div>
                    <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">Command</label>
                    <input value={newServer.command} onChange={e => setNewServer(p => ({ ...p, command: e.target.value }))} className="matrix-input" placeholder="npx" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">Arguments (space-separated)</label>
                    <input value={newServer.args} onChange={e => setNewServer(p => ({ ...p, args: e.target.value }))} className="matrix-input" placeholder="-y @modelcontextprotocol/server-filesystem /path" />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">URL</label>
                  <input value={newServer.url} onChange={e => setNewServer(p => ({ ...p, url: e.target.value }))} className="matrix-input" placeholder="http://localhost:3001" />
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setShowAddDialog(false)} className="matrix-btn text-xs">Cancel</button>
              <button onClick={handleAddServer} disabled={!newServer.name.trim()} className="matrix-btn matrix-btn-primary text-xs">Add Server</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
