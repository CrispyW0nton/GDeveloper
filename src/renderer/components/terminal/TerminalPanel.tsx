/**
 * TerminalPanel — Sprint 12 (refactored from Sprint 9)
 * Now designed for bottom panel use with tab support and shell selector.
 * Each tab runs independent commands with its own history.
 * CWD auto-set to active workspace path.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { WorkspaceInfo } from '../../store';

const api = (window as any).electronAPI;

interface TerminalPanelProps {
  activeWorkspace: WorkspaceInfo | null;
  onClose?: () => void;
}

interface TerminalEntry {
  id: string;
  command: string;
  output: string;
  stderr?: string;
  exitCode: number;
  timestamp: string;
  isError: boolean;
}

interface ShellInfo {
  id: string;
  name: string;
  command: string;
  available: boolean;
}

interface TabState {
  id: string;
  label: string;
  shellId: string;
  history: TerminalEntry[];
  commandHistory: string[];
  historyIndex: number;
}

let tabCounter = 1;

export default function TerminalPanel({ activeWorkspace, onClose }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TabState[]>([
    { id: 'tab-1', label: 'Terminal 1', shellId: 'bash', history: [], commandHistory: [], historyIndex: -1 },
  ]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [command, setCommand] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeTab?.history]);

  // Focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeTabId]);

  // Detect available shells
  useEffect(() => {
    if (api?.detectShells) {
      api.detectShells().then((detected: ShellInfo[]) => setShells(detected));
    }
  }, []);

  const updateTab = useCallback((tabId: string, updater: (t: TabState) => TabState) => {
    setTabs(prev => prev.map(t => t.id === tabId ? updater(t) : t));
  }, []);

  const executeCommand = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd || isRunning) return;

    setIsRunning(true);
    setCommand('');

    updateTab(activeTabId, t => ({
      ...t,
      commandHistory: [cmd, ...t.commandHistory.slice(0, 50)],
      historyIndex: -1,
    }));

    const cwd = activeWorkspace?.local_path;

    try {
      const result = await api.terminalExecute(cmd, cwd);
      const entry: TerminalEntry = {
        id: `cmd-${Date.now()}`,
        command: cmd,
        output: result.output || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode ?? (result.success ? 0 : 1),
        timestamp: new Date().toISOString(),
        isError: !result.success,
      };
      updateTab(activeTabId, t => ({ ...t, history: [...t.history, entry] }));
    } catch (err) {
      const entry: TerminalEntry = {
        id: `cmd-${Date.now()}`,
        command: cmd,
        output: '',
        stderr: err instanceof Error ? err.message : 'Command failed',
        exitCode: 1,
        timestamp: new Date().toISOString(),
        isError: true,
      };
      updateTab(activeTabId, t => ({ ...t, history: [...t.history, entry] }));
    }

    setIsRunning(false);
    inputRef.current?.focus();
  }, [command, isRunning, activeWorkspace, activeTabId, updateTab]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeTab && activeTab.commandHistory.length > 0) {
        const newIndex = Math.min(activeTab.historyIndex + 1, activeTab.commandHistory.length - 1);
        updateTab(activeTabId, t => ({ ...t, historyIndex: newIndex }));
        setCommand(activeTab.commandHistory[newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeTab && activeTab.historyIndex > 0) {
        const newIndex = activeTab.historyIndex - 1;
        updateTab(activeTabId, t => ({ ...t, historyIndex: newIndex }));
        setCommand(activeTab.commandHistory[newIndex] || '');
      } else {
        updateTab(activeTabId, t => ({ ...t, historyIndex: -1 }));
        setCommand('');
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      updateTab(activeTabId, t => ({ ...t, history: [] }));
    }
  };

  const addTab = () => {
    tabCounter++;
    const newTab: TabState = {
      id: `tab-${tabCounter}`,
      label: `Terminal ${tabCounter}`,
      shellId: shells.find(s => s.available)?.id || 'bash',
      history: [],
      commandHistory: [],
      historyIndex: -1,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const closeTab = (tabId: string) => {
    if (tabs.length <= 1) return; // keep at least one tab
    setTabs(prev => prev.filter(t => t.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId(tabs.find(t => t.id !== tabId)?.id || tabs[0].id);
    }
  };

  const changeShell = (tabId: string, shellId: string) => {
    updateTab(tabId, t => ({ ...t, shellId, label: `${shells.find(s => s.id === shellId)?.name || 'Terminal'}` }));
  };

  return (
    <div className="h-full flex flex-col">
      {/* Tab Bar + Controls */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-matrix-border/30 bg-matrix-bg-light flex-shrink-0">
        <div className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer transition-colors rounded-t ${
                tab.id === activeTabId
                  ? 'bg-matrix-bg text-matrix-green border-t border-x border-matrix-green/20'
                  : 'text-matrix-text-muted/40 hover:text-matrix-text-dim hover:bg-matrix-bg-hover'
              }`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span className="truncate max-w-[80px]">{tab.label}</span>
              {tabs.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className="text-matrix-text-muted/20 hover:text-red-400 ml-1 transition-colors"
                >
                  \u00D7
                </span>
              )}
            </div>
          ))}
          <button onClick={addTab} className="text-matrix-text-muted/30 hover:text-matrix-green px-1.5 py-1 text-sm transition-colors" title="New terminal">
            +
          </button>
        </div>

        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          {/* Shell selector */}
          <select
            value={activeTab?.shellId || 'bash'}
            onChange={e => changeShell(activeTabId, e.target.value)}
            className="text-[9px] bg-transparent border border-matrix-border/20 text-matrix-text-dim rounded px-1 py-0.5 outline-none"
          >
            {shells.filter(s => s.available).map(s => (
              <option key={s.id} value={s.id} className="bg-matrix-bg">{s.name}</option>
            ))}
          </select>

          {/* CWD indicator */}
          {activeWorkspace && (
            <span className="text-[9px] text-matrix-text-muted/20 truncate max-w-[200px]" title={activeWorkspace.local_path}>
              {activeWorkspace.local_path.split(/[/\\]/).pop()}
            </span>
          )}

          {/* Close button */}
          {onClose && (
            <button onClick={onClose} className="text-matrix-text-muted/30 hover:text-red-400 transition-colors text-xs" title="Close terminal">
              \u00D7
            </button>
          )}
        </div>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 overflow-y-auto bg-matrix-bg font-mono text-xs p-3 space-y-2" onClick={() => inputRef.current?.focus()}>
        {/* Welcome message */}
        {(!activeTab || activeTab.history.length === 0) && (
          <div className="text-matrix-green/30 text-[11px] space-y-1">
            <div>GDeveloper Terminal v2.0</div>
            <div>{'─'.repeat(30)}</div>
            {activeWorkspace ? (
              <div>cwd: {activeWorkspace.local_path}</div>
            ) : (
              <div className="text-yellow-500/50">No workspace active. Open or clone a repo first.</div>
            )}
            <div className="text-matrix-text-muted/20">Type a command and press Enter. {'\u2191\u2193'} for history. Ctrl+L to clear. Ctrl+` to toggle.</div>
            <div />
          </div>
        )}

        {/* Command entries */}
        {activeTab?.history.map(entry => (
          <div key={entry.id} className="space-y-0.5">
            <div className="flex items-start gap-1">
              <span className="text-matrix-green shrink-0">$</span>
              <span className="text-matrix-green font-bold">{entry.command}</span>
            </div>
            {entry.output && (
              <pre className="text-matrix-text-dim whitespace-pre-wrap break-all pl-3 max-h-[300px] overflow-y-auto">
                {entry.output}
              </pre>
            )}
            {entry.stderr && (
              <pre className="text-red-400/80 whitespace-pre-wrap break-all pl-3 max-h-[200px] overflow-y-auto">
                {entry.stderr}
              </pre>
            )}
            {entry.exitCode !== 0 && (
              <div className="text-red-400/40 text-[9px] pl-3">exit code: {entry.exitCode}</div>
            )}
          </div>
        ))}

        {/* Running indicator */}
        {isRunning && (
          <div className="flex items-center gap-2 text-matrix-green/50">
            <span className="w-2 h-2 border border-matrix-green/50 border-t-matrix-green rounded-full animate-spin" />
            <span>Running...</span>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Input line */}
      <div className="border-t border-matrix-border/30 bg-matrix-bg px-3 py-2 flex items-center gap-2 font-mono flex-shrink-0">
        <span className="text-matrix-green text-xs shrink-0">$</span>
        <input
          ref={inputRef}
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activeWorkspace ? 'Enter command...' : 'No workspace active'}
          disabled={isRunning || !activeWorkspace}
          className="flex-1 bg-transparent text-matrix-green text-xs outline-none placeholder:text-matrix-text-muted/20 caret-matrix-green"
          autoFocus
        />
        <button
          onClick={executeCommand}
          disabled={isRunning || !command.trim() || !activeWorkspace}
          className="text-matrix-green/30 hover:text-matrix-green text-[10px] px-2 py-0.5 rounded border border-matrix-green/10 hover:border-matrix-green/30 transition-colors disabled:opacity-20"
        >
          Run
        </button>
      </div>
    </div>
  );
}
