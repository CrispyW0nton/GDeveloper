/**
 * ToolCallBlock — Sprint 27.3 (Canonical Agent Loop)
 *
 * Replaces the "(tool execution)" placeholder with a real tool-call display.
 * Shows: tool name, JSON input (collapsible), result (including error/timed-out
 * styling), and status indicator.
 */

import React, { useState } from 'react';

export interface ToolCallBlockProps {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  result?: string;
  status: 'running' | 'success' | 'error' | 'timed_out';
  elapsedMs?: number;
}

const STATUS_ICONS: Record<string, string> = {
  running: '\u23F3',    // hourglass
  success: '\u2705',    // check
  error: '\u274C',      // cross
  timed_out: '\u23F0',  // alarm clock
};

const STATUS_COLORS: Record<string, string> = {
  running: '#3b82f6',
  success: '#22c55e',
  error: '#ef4444',
  timed_out: '#f59e0b',
};

export default function ToolCallBlock({
  toolCallId,
  toolName,
  input,
  result,
  status,
  elapsedMs,
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(status === 'error' || status === 'timed_out');

  const icon = STATUS_ICONS[status] || '\uD83D\uDD27';
  const borderColor = STATUS_COLORS[status] || '#6b7280';

  const formatInput = () => {
    if (!input) return '{}';
    try {
      const str = JSON.stringify(input, null, 2);
      return str.length > 2000 ? str.substring(0, 2000) + '\n...(truncated)' : str;
    } catch {
      return String(input);
    }
  };

  const formatElapsed = () => {
    if (!elapsedMs) return '';
    if (elapsedMs < 1000) return `${elapsedMs}ms`;
    return `${(elapsedMs / 1000).toFixed(1)}s`;
  };

  return (
    <div
      className="tool-call-block"
      style={{
        borderLeft: `3px solid ${borderColor}`,
        padding: '8px 12px',
        margin: '6px 0',
        backgroundColor: status === 'error' || status === 'timed_out'
          ? 'rgba(239, 68, 68, 0.08)'
          : 'rgba(59, 130, 246, 0.05)',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          <span style={{ marginRight: '6px' }}>{icon}</span>
          <strong>{toolName}</strong>
          {status === 'running' && (
            <span style={{ color: '#3b82f6', marginLeft: '8px', fontSize: '12px' }}>running...</span>
          )}
          {status === 'timed_out' && (
            <span style={{ color: '#f59e0b', marginLeft: '8px', fontSize: '12px' }}>timed out</span>
          )}
          {elapsedMs !== undefined && status !== 'running' && (
            <span style={{ color: '#9ca3af', marginLeft: '8px', fontSize: '11px' }}>
              {formatElapsed()}
            </span>
          )}
        </span>
        <span style={{ color: '#9ca3af', fontSize: '12px' }}>
          {expanded ? '\u25B2' : '\u25BC'}
        </span>
      </div>

      {/* Collapsible body */}
      {expanded && (
        <div style={{ marginTop: '8px' }}>
          {/* Input */}
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#9ca3af', fontSize: '11px', marginBottom: '2px' }}>Input:</div>
            <pre
              style={{
                backgroundColor: 'rgba(0,0,0,0.15)',
                padding: '6px 8px',
                borderRadius: '3px',
                overflow: 'auto',
                maxHeight: '200px',
                fontSize: '12px',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {formatInput()}
            </pre>
          </div>

          {/* Result */}
          {result && (
            <div>
              <div style={{ color: '#9ca3af', fontSize: '11px', marginBottom: '2px' }}>
                {status === 'error' || status === 'timed_out' ? 'Error:' : 'Result:'}
              </div>
              <pre
                style={{
                  backgroundColor: status === 'error' || status === 'timed_out'
                    ? 'rgba(239, 68, 68, 0.1)'
                    : 'rgba(0,0,0,0.1)',
                  padding: '6px 8px',
                  borderRadius: '3px',
                  overflow: 'auto',
                  maxHeight: '300px',
                  fontSize: '12px',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: status === 'error' || status === 'timed_out' ? '#fca5a5' : 'inherit',
                }}
              >
                {result.length > 2000 ? result.substring(0, 2000) + '\n...(truncated)' : result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
