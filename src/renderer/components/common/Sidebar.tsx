import React from 'react';
import { TabId, SelectedRepo, WorkspaceInfo } from '../../store';
import { useTheme } from '../../themes/ThemeContext';

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  repoSelected: boolean;
  githubConnected: boolean;
  apiKeyConfigured: boolean;
  selectedRepo: SelectedRepo | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeWorkspace?: WorkspaceInfo | null;
  terminalOpen?: boolean;
  sandboxMonitorOpen?: boolean;
  onToggleSandboxMonitor?: () => void;
  executionMode?: string;
}

const MATRIX_CHARS = '\u30A2\u30A4\u30A6\u30A8\u30AA\u30AB\u30AD\u30AF\u30B1\u30B3\u30B5\u30B7\u30B9\u30BB\u30BD\u30BF\u30C1\u30C4\u30C6\u30C8\u30CA\u30CB\u30CC\u30CD\u30CE\u30CF\u30D2\u30D5\u30D8\u30DB\u30DE\u30DF\u30E0\u30E1\u30E2\u30E4\u30E6\u30E8\u30E9\u30EA\u30EB\u30EC\u30ED\u30EF\u30F2\u30F3';

// Deterministic rain columns to avoid hydration mismatch
const RAIN_COLUMNS = [
  { left: '10%', delay: '0s', speed: '4.2s', chars: '\u30A2\u30AB\u30B5\u30BF\u30CA' },
  { left: '30%', delay: '1.1s', speed: '3.8s', chars: '\u30A6\u30B1\u30B9\u30C4\u30CC' },
  { left: '50%', delay: '0.5s', speed: '5.1s', chars: '\u30AA\u30B3\u30BD\u30C8\u30CE' },
  { left: '70%', delay: '2.3s', speed: '3.5s', chars: '\u30A8\u30AF\u30BB\u30C6\u30CD' },
  { left: '90%', delay: '0.8s', speed: '4.7s', chars: '\u30A4\u30AD\u30B7\u30C1\u30CB' },
];

interface NavItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  /** Tab requires an active workspace to be enabled */
  requiresWorkspace: boolean;
  /** If true, this entry toggles the bottom panel instead of switching tab */
  togglesPanel?: boolean;
}

/**
 * TASK 4 — Relaxed tab gating:
 * Only `requiresWorkspace` matters. No checks for repo, messages, tasks, diffs,
 * GitHub connection, or MCP connection.
 * Sprint 12: Terminal entry toggles bottom panel instead of switching tab.
 */
const NAV_ITEMS: NavItem[] = [
  {
    id: 'workspace',
    label: 'Workspaces',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>,
    requiresWorkspace: false
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>,
    requiresWorkspace: false
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
    requiresWorkspace: true
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
    requiresWorkspace: false,
    togglesPanel: true,
  },
  {
    id: 'mcp',
    label: 'MCP Servers',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="6" rx="1"/><rect x="2" y="15" width="20" height="6" rx="1"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></svg>,
    requiresWorkspace: false
  },
  {
    id: 'forge' as TabId,
    label: 'MCP Forge',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
    requiresWorkspace: false
  },
  {
    id: 'tasks',
    label: 'Task Ledger',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>,
    requiresWorkspace: true
  },
  {
    id: 'diff',
    label: 'Diff View',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v18M3 12h18"/></svg>,
    requiresWorkspace: true
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    requiresWorkspace: true
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
    requiresWorkspace: false
  }
];

export default function Sidebar({
  activeTab, onTabChange, repoSelected, githubConnected, apiKeyConfigured,
  selectedRepo, collapsed, onToggleCollapse, activeWorkspace, terminalOpen,
  sandboxMonitorOpen, onToggleSandboxMonitor, executionMode,
}: SidebarProps) {
  const { showMatrixRain } = useTheme();

  return (
    <aside className={`glass-panel-solid h-full flex flex-col transition-all duration-300 relative overflow-hidden ${collapsed ? 'w-14' : 'w-56'}`}>
      {/* Matrix Rain Effect — only for Matrix theme */}
      {showMatrixRain && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
          {RAIN_COLUMNS.map((col, i) => (
            <div
              key={i}
              className="rain-column"
              style={{
                left: col.left,
                '--rain-speed': col.speed,
                '--rain-delay': col.delay,
              } as React.CSSProperties}
            >
              {col.chars.split('').map((ch, j) => (
                <span key={j} className="block">{ch}</span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Logo */}
      <div className="relative z-10 p-3 border-b border-matrix-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-matrix-green/10 border border-matrix-green/30 flex items-center justify-center">
            <span className="text-matrix-green text-sm font-bold glow-text">G</span>
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-sm font-bold text-matrix-green glow-text tracking-wider">GDEVELOPER</h1>
              <p className="text-[9px] text-matrix-text-muted/50 tracking-widest">MATRIX // AI CODER</p>
            </div>
          )}
        </div>
      </div>

      {/* Status Indicators */}
      {!collapsed && (
        <div className="relative z-10 px-3 py-2 border-b border-matrix-border space-y-1.5">
          <StatusDot label="API Key" active={apiKeyConfigured} detail={apiKeyConfigured ? 'Claude' : 'Not set'} />
          <StatusDot label="GitHub" active={githubConnected} detail={githubConnected ? 'Connected' : 'Not connected'} />
          {activeWorkspace && (
            <>
              <StatusDot label="Workspace" active={true} detail={activeWorkspace.name} />
              <div className="text-[10px] text-matrix-text-dim truncate pl-4">
                {activeWorkspace.local_path}
              </div>
            </>
          )}
          {selectedRepo && !activeWorkspace && (
            <div className="text-[10px] text-matrix-text-dim truncate pl-4">
              {selectedRepo.fullName}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="relative z-10 flex-1 overflow-y-auto py-2">
        {NAV_ITEMS.map(item => {
          // Terminal entry: disabled only if no workspace and not a panel toggle
          const isTerminal = item.togglesPanel;
          const disabled = !isTerminal && item.requiresWorkspace && !activeWorkspace;
          const isActive = isTerminal ? !!terminalOpen : activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => !disabled && onTabChange(item.id)}
              disabled={disabled}
              className={`
                w-full flex items-center gap-3 px-3 py-2 text-left text-xs transition-all duration-150
                ${isActive ? 'tab-active text-matrix-green glow-text-dim' : 'text-matrix-text-muted/60 hover:text-matrix-text-dim hover:bg-matrix-bg-hover'}
                ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
              `}
              title={collapsed ? (isTerminal ? `${item.label} (Ctrl+\`)` : item.label) : undefined}
            >
              <span className={isActive ? 'text-matrix-green' : ''}>{item.icon}</span>
              {!collapsed && (
                <span className="flex items-center gap-1.5">
                  {item.label}
                  {isTerminal && (
                    <span className="text-[8px] text-matrix-text-muted/25 font-mono">Ctrl+`</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Sprint 15.2: Sandbox Monitor Toggle + Mode Indicator */}
      {!collapsed && (
        <div className="relative z-10 px-3 py-1.5 border-t border-matrix-border/30 space-y-1">
          <button
            onClick={onToggleSandboxMonitor}
            className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-colors ${
              sandboxMonitorOpen
                ? 'text-matrix-green bg-matrix-green/10 border border-matrix-green/30'
                : 'text-matrix-text-muted/40 hover:text-matrix-text-dim border border-transparent hover:border-matrix-border/20'
            }`}
            title="Toggle Sandbox Monitor"
          >
            <span>{'\uD83D\uDCE1'}</span>
            <span>Sandbox Monitor</span>
            {sandboxMonitorOpen && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-matrix-green animate-pulseDot" />}
          </button>
          {executionMode && (
            <div className={`text-center text-[9px] font-bold uppercase tracking-wider ${
              executionMode === 'plan' ? 'text-yellow-400' : 'text-matrix-green'
            }`}>
              {executionMode === 'plan' ? '\uD83D\uDD0D Plan' : '\uD83D\uDD28 Build'} Mode
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="relative z-10 p-3 border-t border-matrix-border">
        {!collapsed && (
          <div className="text-[9px] text-matrix-text-muted/30 text-center tracking-widest">
            SPRINT 16A // v6.1
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="w-full mt-1 text-center text-matrix-text-muted/40 hover:text-matrix-green transition-colors text-xs"
        >
          {collapsed ? '>>' : '<<'}
        </button>
      </div>
    </aside>
  );
}

function StatusDot({ label, active, detail }: { label: string; active: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-matrix-green animate-pulseDot' : 'bg-matrix-text-muted/20'}`} />
      <span className="text-matrix-text-muted/50">{label}:</span>
      <span className={active ? 'text-matrix-green' : 'text-matrix-text-muted/30'}>{detail}</span>
    </div>
  );
}
