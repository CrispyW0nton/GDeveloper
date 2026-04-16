/**
 * TerminalPanel — Sprint 9
 * Simple command executor panel (without node-pty/xterm.js dependencies)
 * Runs commands via IPC → execSync in main process
 * Matrix-themed output display
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { WorkspaceInfo } from '../../store';

const api = (window as any).electronAPI;

interface TerminalPanelProps {
  activeWorkspace: WorkspaceInfo | null;
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

export default function TerminalPanel({ activeWorkspace }: TerminalPanelProps) {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<TerminalEntry[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [shells, setShells] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Detect available shells
  useEffect(() => {
    if (api?.detectShells) {
      api.detectShells().then((detected: any[]) => setShells(detected));
    }
  }, []);

  const executeCommand = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd || isRunning) return;

    setIsRunning(true);
    setCommand('');
    setCommandHistory(prev => [cmd, ...prev.slice(0, 50)]);
    setHistoryIndex(-1);

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
        isError: !result.success
      };

      setHistory(prev => [...prev, entry]);
    } catch (err) {
      const entry: TerminalEntry = {
        id: `cmd-${Date.now()}`,
        command: cmd,
        output: '',
        stderr: err instanceof Error ? err.message : 'Command failed',
        exitCode: 1,
        timestamp: new Date().toISOString(),
        isError: true
      };
      setHistory(prev => [...prev, entry]);
    }

    setIsRunning(false);
    inputRef.current?.focus();
  }, [command, isRunning, activeWorkspace]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      } else {
        setHistoryIndex(-1);
        setCommand('');
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setHistory([]);
    }
  };

  const clearTerminal = () => setHistory([]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between glass-panel-solid rounded-none border-x-0 border-t-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-matrix-green font-bold">Terminal</span>
          {activeWorkspace && (
            <span className="text-[10px] text-matrix-text-muted/40 font-mono truncate max-w-[300px]">
              {activeWorkspace.local_path}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {shells.filter(s => s.available).map(s => (
            <span key={s.id} className="text-[9px] text-matrix-text-muted/30">{s.name}</span>
          ))}
          <button onClick={clearTerminal} className="text-[10px] text-matrix-text-muted/40 hover:text-matrix-green" title="Clear (Ctrl+L)">
            Clear
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 overflow-y-auto bg-[#0a0a0a] font-mono text-xs p-3 space-y-2" onClick={() => inputRef.current?.focus()}>
        {/* Welcome message */}
        {history.length === 0 && (
          <div className="text-matrix-green/30 text-[11px] space-y-1">
            <div>GDeveloper Terminal v1.0</div>
            <div>─────────────────────────</div>
            {activeWorkspace ? (
              <div>cwd: {activeWorkspace.local_path}</div>
            ) : (
              <div className="text-yellow-500/50">No workspace active. Open or clone a repo first.</div>
            )}
            <div className="text-matrix-text-muted/20">Type a command and press Enter. ↑↓ for history. Ctrl+L to clear.</div>
            <div />
          </div>
        )}

        {/* Command entries */}
        {history.map(entry => (
          <div key={entry.id} className="space-y-0.5">
            {/* Prompt + command */}
            <div className="flex items-start gap-1">
              <span className="text-matrix-green shrink-0">$</span>
              <span className="text-matrix-green font-bold">{entry.command}</span>
            </div>

            {/* Output */}
            {entry.output && (
              <pre className="text-matrix-text-dim whitespace-pre-wrap break-all pl-3 max-h-[300px] overflow-y-auto">
                {entry.output}
              </pre>
            )}

            {/* Stderr */}
            {entry.stderr && (
              <pre className="text-red-400/80 whitespace-pre-wrap break-all pl-3 max-h-[200px] overflow-y-auto">
                {entry.stderr}
              </pre>
            )}

            {/* Exit code (if non-zero) */}
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
      <div className="border-t border-matrix-border bg-[#0a0a0a] px-3 py-2 flex items-center gap-2 font-mono">
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
        <button onClick={executeCommand} disabled={isRunning || !command.trim() || !activeWorkspace}
          className="text-matrix-green/30 hover:text-matrix-green text-[10px] px-2 py-0.5 rounded border border-matrix-green/10 hover:border-matrix-green/30 transition-colors disabled:opacity-20">
          Run
        </button>
      </div>
    </div>
  );
}
