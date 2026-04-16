/**
 * SandboxMonitor — Sprint 16
 * Live agent activity monitor: shows tool calls, commands, file edits, MCP calls.
 * Theme-compatible, auto-scroll, copy logs, filter by type.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

const api = (window as any).electronAPI;

interface SandboxEvent {
  id: string;
  timestamp: string;
  type: 'tool_call' | 'tool_result' | 'command' | 'file_edit' | 'mcp_call' | 'status' | 'error';
  tool?: string;
  summary: string;
  detail?: string;
  cwd?: string;
  status: 'running' | 'success' | 'error';
}

const TYPE_ICONS: Record<string, string> = {
  tool_call: '\uD83D\uDD27',
  tool_result: '\u2705',
  command: '\uD83D\uDCBB',
  file_edit: '\uD83D\uDCDD',
  mcp_call: '\uD83D\uDD0C',
  status: '\u2139\uFE0F',
  error: '\u274C',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'text-matrix-warning',
  success: 'text-matrix-green',
  error: 'text-matrix-danger',
};

interface SandboxMonitorProps {
  onClose?: () => void;
}

export default function SandboxMonitor({ onClose }: SandboxMonitorProps) {
  const [events, setEvents] = useState<SandboxEvent[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load existing log
  useEffect(() => {
    if (api?.getSandboxLog) {
      api.getSandboxLog().then((log: SandboxEvent[]) => {
        if (log && log.length > 0) setEvents(log);
      });
    }
  }, []);

  // Listen for live events
  useEffect(() => {
    if (!api?.onSandboxEvent) return;
    const unsub = api.onSandboxEvent((event: SandboxEvent) => {
      setEvents(prev => {
        const next = [...prev, event];
        return next.length > 500 ? next.slice(-400) : next;
      });
    });
    return () => { if (unsub) unsub(); };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, autoScroll]);

  const handleClear = useCallback(() => {
    setEvents([]);
    if (api?.clearSandboxLog) api.clearSandboxLog();
  }, []);

  const handleCopy = useCallback(() => {
    const text = events.map(e =>
      `[${e.timestamp}] [${e.type}] ${e.summary}${e.detail ? '\n  ' + e.detail : ''}`
    ).join('\n');
    navigator.clipboard.writeText(text);
  }, [events]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const filteredEvents = filter === 'all'
    ? events
    : events.filter(e => e.type === filter);

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'tool_call', label: 'Tools' },
    { id: 'tool_result', label: 'Results' },
    { id: 'command', label: 'Commands' },
    { id: 'mcp_call', label: 'MCP' },
    { id: 'error', label: 'Errors' },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-matrix-border/20 bg-matrix-bg-elevated flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">{'\uD83D\uDCE1'}</span>
          <span className="text-[10px] font-bold text-matrix-green uppercase tracking-wider">Sandbox Monitor</span>
          <span className="text-[9px] text-matrix-text-muted/30">{events.length} events</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Filter buttons */}
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors ${
                filter === f.id
                  ? 'border-matrix-green/50 text-matrix-green bg-matrix-green/10'
                  : 'border-matrix-border/20 text-matrix-text-muted/40 hover:border-matrix-green/30'
              }`}
            >{f.label}</button>
          ))}
          <button onClick={() => setAutoScroll(!autoScroll)} title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
            className={`text-[9px] px-1.5 py-0.5 rounded border ${autoScroll ? 'border-matrix-green/30 text-matrix-green' : 'border-matrix-border/20 text-matrix-text-muted/40'}`}>
            {autoScroll ? '\u25BC' : '\u25A0'}
          </button>
          <button onClick={handleCopy} title="Copy logs" className="text-[9px] px-1.5 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/40 hover:text-matrix-info">
            Copy
          </button>
          <button onClick={handleClear} title="Clear" className="text-[9px] px-1.5 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/40 hover:text-matrix-danger">
            Clear
          </button>
          {onClose && (
            <button onClick={onClose} className="text-matrix-text-muted/40 hover:text-matrix-danger ml-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Event List */}
      <div className="flex-1 overflow-y-auto font-mono text-[10px]">
        {filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-matrix-text-muted/20 text-xs">
            No sandbox events yet. Start a chat conversation to see agent activity.
          </div>
        ) : (
          filteredEvents.map(event => (
            <div
              key={event.id}
              className="flex items-start gap-2 px-3 py-1 hover:bg-matrix-bg-hover/30 border-b border-matrix-border/5 cursor-pointer"
              onClick={() => toggleExpand(event.id)}
            >
              <span className="flex-shrink-0 mt-0.5">{TYPE_ICONS[event.type] || '\u2022'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`${STATUS_COLORS[event.status]} font-bold`}>{event.summary}</span>
                  <span className="text-[8px] text-matrix-text-muted/20 ml-auto flex-shrink-0">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {expanded.has(event.id) && event.detail && (
                  <pre className="text-[9px] text-matrix-text-muted/40 mt-0.5 whitespace-pre-wrap break-all">{event.detail}</pre>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}
