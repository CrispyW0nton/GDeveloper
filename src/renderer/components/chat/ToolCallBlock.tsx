/**
 * ToolCallBlock — Sprint 27.5
 *
 * Replaces the "(tool execution)" placeholder with a real tool-call display.
 * Shows tool name, collapsible JSON input, and result (including error/timeout styling).
 *
 * Layout:
 *   +-- <ToolIcon> toolName
 *   |    {JSON.stringify(input, null, 2)}
 *   |    --- result ---
 *   |    {result} (or spinner if pending)
 *   +---
 */

import React, { useState } from 'react';

// ─── Tool icon map ───

const TOOL_ICONS: Record<string, string> = {
  bash_command: '\u{1F4BB}',  // laptop
  run_command: '\u{1F4BB}',
  read_file: '\u{1F4C4}',    // page
  write_file: '\u{270F}\u{FE0F}',     // pencil
  patch_file: '\u{1FA79}',   // bandage
  multi_edit: '\u{1F4DD}',   // memo
  list_files: '\u{1F4C2}',   // folder
  parallel_search: '\u{1F50D}', // mag
  parallel_read: '\u{1F4DA}',  // books
  grep: '\u{1F50E}',
  glob: '\u{1F30D}',
  git_commit: '\u{2705}',
  git_push: '\u{1F680}',
  todo: '\u{1F4CB}',         // clipboard
  task_plan: '\u{1F4CB}',
  summarize_large_document: '\u{1F4D6}',
  compare_file: '\u{1F504}',
  compare_folder: '\u{1F5C2}\u{FE0F}',
};

function getToolIcon(name: string): string {
  return TOOL_ICONS[name] || '\u{1F527}'; // wrench default
}

// ─── Props ───

interface ToolCallBlockProps {
  toolName: string;
  toolCallId: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  timedOut?: boolean;
  isPending?: boolean;
}

// ─── Component ───

const ToolCallBlock: React.FC<ToolCallBlockProps> = ({
  toolName,
  toolCallId,
  input,
  result,
  isError,
  timedOut,
  isPending,
}) => {
  const [expanded, setExpanded] = useState(false);

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: isError || timedOut ? 'rgba(255, 60, 60, 0.1)' : 'rgba(0, 255, 65, 0.06)',
    borderLeft: `3px solid ${isError || timedOut ? '#ff3c3c' : '#00ff41'}`,
    borderRadius: '4px 4px 0 0',
    cursor: 'pointer',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '13px',
    color: '#b0b0b0',
    userSelect: 'none',
  };

  const bodyStyle: React.CSSProperties = {
    padding: '8px 12px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderLeft: `3px solid ${isError || timedOut ? '#ff3c3c44' : '#00ff4144'}`,
    borderRadius: '0 0 4px 4px',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '12px',
    color: '#888',
    overflow: 'auto',
    maxHeight: '400px',
  };

  const resultStyle: React.CSSProperties = {
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: isError || timedOut ? '#ff6b6b' : '#c0c0c0',
  };

  return (
    <div style={{ margin: '6px 0', borderRadius: '4px', overflow: 'hidden' }}>
      <div style={headerStyle} onClick={() => setExpanded(!expanded)}>
        <span>{getToolIcon(toolName)}</span>
        <span style={{ color: '#00ff41', fontWeight: 600 }}>{toolName}</span>
        {timedOut && <span style={{ color: '#ff3c3c', fontSize: '11px' }}>(timed out)</span>}
        {isError && !timedOut && <span style={{ color: '#ff3c3c', fontSize: '11px' }}>(error)</span>}
        {isPending && <span style={{ color: '#ffaa00', fontSize: '11px' }}>running...</span>}
        <span style={{ marginLeft: 'auto', fontSize: '11px' }}>{expanded ? '\u25BC' : '\u25B6'}</span>
      </div>

      {expanded && (
        <div style={bodyStyle}>
          {input && (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(input, null, 2)}
            </pre>
          )}
          {result !== undefined && (
            <div style={resultStyle}>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>result</div>
              {result}
            </div>
          )}
          {isPending && !result && (
            <div style={{ ...resultStyle, color: '#ffaa00' }}>
              Executing...
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallBlock;
