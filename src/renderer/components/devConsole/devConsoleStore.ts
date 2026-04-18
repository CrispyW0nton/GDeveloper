/**
 * Dev Console Store — Sprint 30
 *
 * Holds in-memory state for the Dev Console panel: API traffic,
 * agent-loop events, tool registry snapshot, settings snapshot.
 * Exposed as a React hook for the DevConsole component.
 */

export interface ApiTrafficEntry {
  id: string;
  timestamp: number;
  sessionId: string;
  turn: number;
  direction: 'request' | 'response';
  model?: string;
  toolCount?: number;
  toolNames?: string[];
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
  durationMs?: number;
  error?: string;
}

export interface AgentLoopEventEntry {
  id: string;
  timestamp: number;
  event: string;
  turn?: number;
  consecutiveMistakes?: number;
  maxConsecutiveMistakes?: number;
  tool?: string;
  detail?: string;
}

export interface ToolRegistrySnapshot {
  localTools: Array<{ name: string; description: string }>;
  mcpTools: Array<{ name: string; serverName: string; enabled: boolean }>;
  buildModeTools: string[];
  planModeTools: string[];
  activeMode: string;
  hasAttemptCompletion: boolean;
  hasAskFollowupQuestion: boolean;
}

export interface SettingsSnapshot {
  tier: number;
  budgetValues: Record<string, unknown>;
  mode: string;
  apiKeyPresent: boolean;
  workspacePath: string;
  sessionId: string;
  selectedModel: string;
}

export interface DevConsoleState {
  apiTraffic: ApiTrafficEntry[];
  agentLoopEvents: AgentLoopEventEntry[];
  toolRegistry: ToolRegistrySnapshot | null;
  settingsSnapshot: SettingsSnapshot | null;
  // Sprint 32: Top-level active plan state for export
  activePlan: any | null;
}

const MAX_ENTRIES = 50;

let _state: DevConsoleState = {
  apiTraffic: [],
  agentLoopEvents: [],
  toolRegistry: null,
  settingsSnapshot: null,
  activePlan: null,
};

let _listeners: Array<() => void> = [];

function notify(): void {
  _listeners.forEach(fn => fn());
}

export function subscribe(fn: () => void): () => void {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

export function getState(): DevConsoleState {
  return _state;
}

export function addApiTraffic(entry: ApiTrafficEntry): void {
  _state = {
    ..._state,
    apiTraffic: [..._state.apiTraffic, entry].slice(-MAX_ENTRIES),
  };
  notify();
}

export function addAgentLoopEvent(entry: AgentLoopEventEntry): void {
  _state = {
    ..._state,
    agentLoopEvents: [..._state.agentLoopEvents, entry].slice(-MAX_ENTRIES),
  };
  notify();
}

export function setToolRegistry(snapshot: ToolRegistrySnapshot): void {
  _state = { ..._state, toolRegistry: snapshot };
  notify();
}

export function setSettingsSnapshot(snapshot: SettingsSnapshot): void {
  _state = { ..._state, settingsSnapshot: snapshot };
  notify();
}

// Sprint 32: Store active plan for export
export function setActivePlan(plan: any): void {
  _state = { ..._state, activePlan: plan };
  notify();
}

export function clearDevConsole(): void {
  _state = { apiTraffic: [], agentLoopEvents: [], toolRegistry: null, settingsSnapshot: null, activePlan: null };
  notify();
}

/** Build an export payload from the current state (for Tab 5) */
export function buildExportPayload(): object {
  return {
    exportedAt: new Date().toISOString(),
    apiTraffic: _state.apiTraffic.slice(-50),
    agentLoopEvents: _state.agentLoopEvents.slice(-50),
    toolRegistry: _state.toolRegistry,
    settingsSnapshot: _state.settingsSnapshot,
    // Sprint 32: Include active plan in export
    activePlan: _state.activePlan,
  };
}
