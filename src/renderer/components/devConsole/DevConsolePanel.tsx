/**
 * Dev Console Panel — Sprint 30
 *
 * Left-sidebar observability panel with 5 tabs:
 *   1. API Traffic — chronological Anthropic API calls
 *   2. Agent Loop Events — agentLoop.ts events
 *   3. Tool Registry — live tool definition view
 *   4. Settings Snapshot — current config
 *   5. Export — write debug JSON
 */

import React, { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import {
  getState, subscribe,
  addApiTraffic, addAgentLoopEvent, setToolRegistry, setSettingsSnapshot,
  setActivePlan as setDevConsoleActivePlan,
  buildExportPayload, clearDevConsole,
  type ApiTrafficEntry, type AgentLoopEventEntry,
  type ToolRegistrySnapshot, type SettingsSnapshot,
} from './devConsoleStore';

const api = (window as any).electronAPI;

type DevTab = 'traffic' | 'events' | 'tools' | 'settings' | 'export';

interface DevConsolePanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function DevConsolePanel({ visible, onClose }: DevConsolePanelProps) {
  const [activeTab, setActiveTab] = useState<DevTab>('traffic');
  const state = useSyncExternalStore(subscribe, getState);

  // Subscribe to IPC events from main process
  useEffect(() => {
    if (!api) return;
    const unsubs: Array<() => void> = [];

    // API traffic events
    if (api.onDevConsoleApiTraffic) {
      unsubs.push(api.onDevConsoleApiTraffic((data: any) => {
        addApiTraffic({
          id: `api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: data.timestamp || Date.now(),
          sessionId: data.sessionId || '',
          turn: data.turn || 0,
          direction: data.direction || 'request',
          model: data.model,
          toolCount: data.toolCount,
          toolNames: data.toolNames,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          stopReason: data.stopReason,
          durationMs: data.durationMs,
          error: data.error,
        });
      }));
    }

    // Agent loop events (reuse existing agent:loop-event channel)
    if (api.onAgentLoopEvent) {
      unsubs.push(api.onAgentLoopEvent((data: any) => {
        addAgentLoopEvent({
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          event: data.event || 'unknown',
          turn: data.turn,
          consecutiveMistakes: data.consecutiveMistakes,
          maxConsecutiveMistakes: data.maxConsecutiveMistakes,
          tool: data.tool,
          detail: data.detail,
        });
      }));
    }

    // Tool registry snapshot
    if (api.onDevConsoleToolRegistry) {
      unsubs.push(api.onDevConsoleToolRegistry((data: ToolRegistrySnapshot) => {
        setToolRegistry(data);
      }));
    }

    // Settings snapshot
    if (api.onDevConsoleSettingsSnapshot) {
      unsubs.push(api.onDevConsoleSettingsSnapshot((data: SettingsSnapshot) => {
        setSettingsSnapshot(data);
      }));
    }

    // Sprint 32: Capture active plan updates for export
    if (api.onActivePlanUpdate) {
      unsubs.push(api.onActivePlanUpdate((data: any) => {
        if (data?.plan?.tasks?.length) {
          setDevConsoleActivePlan(data.plan);
        }
      }));
    }

    return () => unsubs.forEach(fn => fn());
  }, []);

  // Fetch tool registry and settings on mount and periodically
  useEffect(() => {
    if (!api || !visible) return;

    const fetchSnapshots = async () => {
      try {
        if (api.getDevConsoleToolRegistry) {
          const reg = await api.getDevConsoleToolRegistry();
          if (reg) setToolRegistry(reg);
        }
        if (api.getDevConsoleSettingsSnapshot) {
          const snap = await api.getDevConsoleSettingsSnapshot();
          if (snap) setSettingsSnapshot(snap);
        }
      } catch { /* ignore */ }
    };

    fetchSnapshots();
    const interval = setInterval(fetchSnapshots, 5000);
    return () => clearInterval(interval);
  }, [visible]);

  const handleExport = useCallback(async () => {
    const payload = buildExportPayload();
    try {
      if (api?.exportDevConsole) {
        const result = await api.exportDevConsole(payload);
        if (result?.path) {
          alert(`Debug snapshot saved to:\n${result.path}`);
        }
      } else {
        // Fallback: download as JSON
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `GDeveloper-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('[DevConsole] Export failed:', err);
    }
  }, []);

  if (!visible) return null;

  const TABS: Array<{ id: DevTab; label: string; icon: string }> = [
    { id: 'traffic', label: 'API Traffic', icon: '📡' },
    { id: 'events', label: 'Loop Events', icon: '🔄' },
    { id: 'tools', label: 'Tool Registry', icon: '🔧' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
    { id: 'export', label: 'Export', icon: '📤' },
  ];

  return (
    <div className="h-full flex flex-col bg-matrix-bg-primary border-r border-matrix-border/30 text-matrix-text-primary" style={{ width: 380 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-matrix-border/30 bg-matrix-bg-elevated/50">
        <span className="text-sm font-semibold text-matrix-green">🖥️ Dev Console</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => clearDevConsole()}
            className="text-xs text-matrix-text-muted hover:text-matrix-text-primary transition-colors"
            title="Clear all entries"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="text-xs text-matrix-text-muted hover:text-matrix-text-primary transition-colors"
            title="Close Dev Console"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-matrix-border/20 bg-matrix-bg-elevated/30">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-1 py-1.5 text-[10px] text-center transition-colors ${
              activeTab === tab.id
                ? 'text-matrix-green border-b-2 border-matrix-green bg-matrix-bg-elevated/50'
                : 'text-matrix-text-muted hover:text-matrix-text-primary'
            }`}
          >
            <span className="block">{tab.icon}</span>
            <span className="block mt-0.5">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto text-xs p-2 font-mono">
        {activeTab === 'traffic' && <ApiTrafficTab entries={state.apiTraffic} />}
        {activeTab === 'events' && <AgentLoopEventsTab entries={state.agentLoopEvents} />}
        {activeTab === 'tools' && <ToolRegistryTab snapshot={state.toolRegistry} />}
        {activeTab === 'settings' && <SettingsSnapshotTab snapshot={state.settingsSnapshot} />}
        {activeTab === 'export' && <ExportTab onExport={handleExport} state={state} />}
      </div>
    </div>
  );
}

// ─── Tab 1: API Traffic ───

function ApiTrafficTab({ entries }: { entries: ApiTrafficEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-matrix-text-muted text-center py-4">No API traffic captured yet.<br/>Send a chat message to see requests.</div>;
  }

  return (
    <div className="space-y-2">
      {entries.map(entry => (
        <div key={entry.id} className={`p-2 rounded border ${
          entry.direction === 'request'
            ? 'border-blue-500/30 bg-blue-500/5'
            : entry.error
              ? 'border-red-500/30 bg-red-500/5'
              : 'border-green-500/30 bg-green-500/5'
        }`}>
          <div className="flex justify-between items-center mb-1">
            <span className={`font-semibold ${entry.direction === 'request' ? 'text-blue-400' : 'text-green-400'}`}>
              {entry.direction === 'request' ? '→ REQ' : '← RES'}
            </span>
            <span className="text-matrix-text-muted">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          </div>
          <div className="text-matrix-text-muted space-y-0.5">
            {entry.sessionId && <div>Session: {entry.sessionId.slice(0, 8)}…</div>}
            {entry.model && <div>Model: {entry.model}</div>}
            {entry.direction === 'request' && entry.toolNames && (
              <div>
                Tools ({entry.toolCount}): {entry.toolNames.join(', ')}
                <br />
                {entry.toolNames.includes('attempt_completion') ? '✅' : '❌'} attempt_completion
                {' '}
                {entry.toolNames.includes('ask_followup_question') ? '✅' : '❌'} ask_followup_question
              </div>
            )}
            {entry.direction === 'response' && (
              <>
                {entry.stopReason && <div>Stop: {entry.stopReason}</div>}
                {entry.inputTokens != null && <div>Tokens: {entry.inputTokens} in / {entry.outputTokens} out</div>}
                {entry.durationMs != null && <div>Duration: {entry.durationMs}ms</div>}
              </>
            )}
            {entry.error && <div className="text-red-400">Error: {entry.error}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tab 2: Agent Loop Events ───

function AgentLoopEventsTab({ entries }: { entries: AgentLoopEventEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-matrix-text-muted text-center py-4">No agent loop events yet.<br/>Events appear when the agent loop runs.</div>;
  }

  const eventColors: Record<string, string> = {
    'no-tools-used-nudge': 'text-amber-400',
    'max-mistakes-reached': 'text-red-400',
    'terminal-tool-used': 'text-green-400',
    'turn-start': 'text-blue-400',
    'turn-end': 'text-blue-300',
  };

  return (
    <div className="space-y-1.5">
      {entries.map(entry => (
        <div key={entry.id} className="p-1.5 rounded border border-matrix-border/20 bg-matrix-bg-elevated/30">
          <div className="flex justify-between items-center">
            <span className={`font-semibold ${eventColors[entry.event] || 'text-matrix-text-primary'}`}>
              {entry.event}
            </span>
            <span className="text-matrix-text-muted text-[10px]">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          </div>
          <div className="text-matrix-text-muted mt-0.5">
            {entry.turn != null && <span>Turn {entry.turn} </span>}
            {entry.tool && <span>| Tool: {entry.tool} </span>}
            {entry.consecutiveMistakes != null && <span>| Mistakes: {entry.consecutiveMistakes}/{entry.maxConsecutiveMistakes} </span>}
            {entry.detail && <span>| {entry.detail}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tab 3: Tool Registry ───

function ToolRegistryTab({ snapshot }: { snapshot: ToolRegistrySnapshot | null }) {
  if (!snapshot) {
    return <div className="text-matrix-text-muted text-center py-4">No tool registry data.<br/>Send a chat message to populate.</div>;
  }

  return (
    <div className="space-y-3">
      {/* Terminal tools status */}
      <div className="p-2 rounded border border-matrix-border/30 bg-matrix-bg-elevated/30">
        <div className="font-semibold mb-1 text-matrix-green">Terminal Tools</div>
        <div>{snapshot.hasAttemptCompletion ? '✅' : '❌'} attempt_completion</div>
        <div>{snapshot.hasAskFollowupQuestion ? '✅' : '❌'} ask_followup_question</div>
      </div>

      {/* Active mode */}
      <div className="p-2 rounded border border-matrix-border/30 bg-matrix-bg-elevated/30">
        <div className="font-semibold mb-1 text-matrix-green">Active Mode</div>
        <div className="uppercase">{snapshot.activeMode}</div>
      </div>

      {/* Local tools */}
      <div className="p-2 rounded border border-matrix-border/30 bg-matrix-bg-elevated/30">
        <div className="font-semibold mb-1 text-matrix-green">Local Tools ({snapshot.localTools.length})</div>
        <div className="max-h-32 overflow-y-auto space-y-0.5">
          {snapshot.localTools.map(t => (
            <div key={t.name} className="flex items-center gap-1">
              <span className="text-matrix-text-muted">•</span>
              <span className={t.name === 'attempt_completion' || t.name === 'ask_followup_question' ? 'text-matrix-green font-semibold' : ''}>
                {t.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* MCP tools */}
      {snapshot.mcpTools.length > 0 && (
        <div className="p-2 rounded border border-matrix-border/30 bg-matrix-bg-elevated/30">
          <div className="font-semibold mb-1 text-matrix-green">MCP Tools ({snapshot.mcpTools.length})</div>
          <div className="max-h-24 overflow-y-auto space-y-0.5">
            {snapshot.mcpTools.map(t => (
              <div key={t.name} className="flex items-center gap-1">
                <span>{t.enabled ? '✅' : '❌'}</span>
                <span>{t.name}</span>
                <span className="text-matrix-text-muted text-[10px]">({t.serverName})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Build mode tools */}
      <div className="p-2 rounded border border-matrix-border/30 bg-matrix-bg-elevated/30">
        <div className="font-semibold mb-1 text-matrix-green">Build Mode ({snapshot.buildModeTools.length} tools)</div>
        <div className="text-[10px] text-matrix-text-muted break-all">{snapshot.buildModeTools.join(', ')}</div>
      </div>

      {/* Plan mode tools */}
      <div className="p-2 rounded border border-matrix-border/30 bg-matrix-bg-elevated/30">
        <div className="font-semibold mb-1 text-matrix-green">Plan Mode ({snapshot.planModeTools.length} tools)</div>
        <div className="text-[10px] text-matrix-text-muted break-all">{snapshot.planModeTools.join(', ')}</div>
      </div>
    </div>
  );
}

// ─── Tab 4: Settings Snapshot ───

function SettingsSnapshotTab({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  if (!snapshot) {
    return <div className="text-matrix-text-muted text-center py-4">No settings snapshot.<br/>Send a chat message to populate.</div>;
  }

  const rows: Array<[string, string]> = [
    ['Tier', String(snapshot.tier)],
    ['Mode', snapshot.mode],
    ['API Key', snapshot.apiKeyPresent ? '✅ Present' : '❌ Missing'],
    ['Workspace', snapshot.workspacePath || '(none)'],
    ['Session', snapshot.sessionId ? snapshot.sessionId.slice(0, 12) + '…' : '(none)'],
    ['Model', snapshot.selectedModel || '(default)'],
  ];

  return (
    <div className="space-y-3">
      <div className="p-2 rounded border border-matrix-border/30 bg-matrix-bg-elevated/30">
        <div className="font-semibold mb-2 text-matrix-green">Current Config</div>
        <table className="w-full">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-matrix-border/10 last:border-b-0">
                <td className="py-0.5 text-matrix-text-muted">{k}</td>
                <td className="py-0.5 text-right">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {snapshot.budgetValues && (
        <div className="p-2 rounded border border-matrix-border/30 bg-matrix-bg-elevated/30">
          <div className="font-semibold mb-1 text-matrix-green">Budget Values</div>
          <pre className="text-[10px] text-matrix-text-muted whitespace-pre-wrap max-h-40 overflow-y-auto">
            {JSON.stringify(snapshot.budgetValues, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Tab 5: Export ───

function ExportTab({ onExport, state }: { onExport: () => void; state: any }) {
  const totalEntries = (state.apiTraffic?.length || 0) + (state.agentLoopEvents?.length || 0);

  return (
    <div className="space-y-4 py-4">
      <div className="text-center">
        <div className="text-matrix-green font-semibold mb-2">Export Debug Snapshot</div>
        <div className="text-matrix-text-muted mb-4">
          Exports the last 50 API traffic entries, 50 agent loop events,
          plus the full tool registry and settings snapshot as JSON.
        </div>
        <div className="text-matrix-text-muted mb-4 text-[10px]">
          Total entries: {totalEntries}<br />
          Tool registry: {state.toolRegistry ? '✅' : '❌'}<br />
          Settings snapshot: {state.settingsSnapshot ? '✅' : '❌'}
        </div>
        <button
          onClick={onExport}
          className="px-4 py-2 bg-matrix-green/20 hover:bg-matrix-green/30 text-matrix-green rounded border border-matrix-green/40 transition-colors"
        >
          📤 Export to JSON
        </button>
      </div>
    </div>
  );
}
