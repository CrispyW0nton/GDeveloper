/**
 * CodeEditor — Sprint 23
 * Full-featured code editor using a styled textarea with:
 *   - Line numbers, cursor, multi-line editing
 *   - Standard shortcuts: copy, paste, undo/redo, find/replace, save (Cmd/Ctrl+S), select-all
 *   - Preserves indentation (tab vs spaces) and line endings (LF/CRLF) on save
 *   - Dirty-state indicator (asterisk) in header
 *   - Confirm dialog on close with unsaved changes
 *   - Atomic save with toast "Saved ✓ [filename]"
 *   - Error handling on save failures
 *   - Blocks editing of lock/binary files and files outside active worktree
 *   - Warns for files > 5 MB
 *   - AI edit integration: read-only banner, refresh after AI edit
 *
 * Note: Uses a custom textarea-based editor instead of Monaco to avoid
 * a ~40MB dependency. Provides all required editing features natively.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

const api = (window as any).electronAPI;

// ─── Constants ───
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.woff', '.woff2',
  '.ttf', '.eot', '.otf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.exe', '.dll', '.so', '.dylib',
  '.bin', '.dat', '.mp3', '.mp4', '.wav', '.db', '.sqlite', '.sqlite3',
]);
const LOCK_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'composer.lock']);
const LARGE_FILE_WARN_SIZE = 5 * 1024 * 1024; // 5 MB
const TAB_SIZE = 2;

export interface EditorFileState {
  filePath: string;
  absolutePath: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  isBinary: boolean;
  isLockFile: boolean;
  isTooLarge: boolean;
  isReadOnly: boolean;
  isOutsideWorktree: boolean;
  size: number;
  lineEnding: 'lf' | 'crlf';
  useTabs: boolean;
  lastSavedAt?: number;
  isBeingEditedByAI?: boolean;
}

interface CodeEditorProps {
  file: EditorFileState;
  onContentChange: (newContent: string, isDirty: boolean) => void;
  onSave: (filePath: string, content: string) => Promise<boolean>;
  onClose: () => void;
  onRefresh: () => void;
  toastMessage?: string;
}

/** Detect the dominant line ending in content */
function detectLineEnding(content: string): 'lf' | 'crlf' {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfCount ? 'crlf' : 'lf';
}

/** Detect whether the file uses tabs or spaces for indentation */
function detectIndentation(content: string): boolean {
  const lines = content.split('\n').slice(0, 100);
  let tabs = 0, spaces = 0;
  for (const line of lines) {
    if (line.startsWith('\t')) tabs++;
    else if (line.startsWith('  ')) spaces++;
  }
  return tabs > spaces;
}

/** Get language hint from extension */
function getLanguageFromExt(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'React TSX', js: 'JavaScript', jsx: 'React JSX',
    json: 'JSON', css: 'CSS', scss: 'SCSS', html: 'HTML',
    py: 'Python', rs: 'Rust', go: 'Go', java: 'Java',
    md: 'Markdown', yml: 'YAML', yaml: 'YAML', toml: 'TOML',
    sh: 'Shell', sql: 'SQL', graphql: 'GraphQL',
    c: 'C', cpp: 'C++', h: 'C Header',
  };
  return map[ext] || ext.toUpperCase() || 'Plain Text';
}

export default function CodeEditor({
  file,
  onContentChange,
  onSave,
  onClose,
  onRefresh,
  toastMessage,
}: CodeEditorProps) {
  const [content, setContent] = useState(file.content);
  const [isSaving, setIsSaving] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findMatchCount, setFindMatchCount] = useState(0);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showLargeFileWarn, setShowLargeFileWarn] = useState(file.size >= LARGE_FILE_WARN_SIZE);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);

  // Sync content when file changes externally (AI edit / file switch)
  useEffect(() => {
    setContent(file.content);
  }, [file.content, file.filePath]);

  // Track find matches
  useEffect(() => {
    if (!findText) { setFindMatchCount(0); return; }
    try {
      const re = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      setFindMatchCount((content.match(re) || []).length);
    } catch { setFindMatchCount(0); }
  }, [findText, content]);

  // Sync scroll between line numbers and editor
  const handleScroll = useCallback(() => {
    if (editorRef.current && lineNumberRef.current) {
      lineNumberRef.current.scrollTop = editorRef.current.scrollTop;
    }
  }, []);

  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const cursorInfo = useMemo(() => {
    if (!editorRef.current) return { line: 1, col: 1 };
    const pos = editorRef.current.selectionStart;
    const textBefore = content.substring(0, pos);
    const line = (textBefore.match(/\n/g) || []).length + 1;
    const col = pos - textBefore.lastIndexOf('\n');
    return { line, col };
  }, [content]);

  const isEditable = !file.isBinary && !file.isLockFile && !file.isReadOnly && !file.isOutsideWorktree && !file.isTooLarge;

  // ─── Keyboard shortcuts ───
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl+S → Save
    if (mod && e.key === 's') {
      e.preventDefault();
      handleSave();
      return;
    }

    // Cmd/Ctrl+F → Find
    if (mod && e.key === 'f') {
      e.preventDefault();
      setShowFindReplace(true);
      return;
    }

    // Cmd/Ctrl+H → Find & Replace
    if (mod && e.key === 'h') {
      e.preventDefault();
      setShowFindReplace(true);
      return;
    }

    // Escape → close find
    if (e.key === 'Escape' && showFindReplace) {
      setShowFindReplace(false);
      return;
    }

    // Tab → indent (insert spaces or tab)
    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      const ta = editorRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const indent = file.useTabs ? '\t' : ' '.repeat(TAB_SIZE);

      if (start === end) {
        // Single cursor: insert indent
        const newContent = content.substring(0, start) + indent + content.substring(end);
        setContent(newContent);
        onContentChange(newContent, newContent !== file.originalContent);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + indent.length;
        });
      } else {
        // Selection: indent/outdent lines
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = content.indexOf('\n', end);
        const selectedBlock = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd);
        const indented = e.shiftKey
          ? selectedBlock.split('\n').map(l => l.startsWith(indent) ? l.slice(indent.length) : l.startsWith('\t') ? l.slice(1) : l).join('\n')
          : selectedBlock.split('\n').map(l => indent + l).join('\n');
        const newContent = content.substring(0, lineStart) + indented + content.substring(lineEnd === -1 ? content.length : lineEnd);
        setContent(newContent);
        onContentChange(newContent, newContent !== file.originalContent);
      }
      return;
    }

    // Enter → auto-indent
    if (e.key === 'Enter' && !mod) {
      e.preventDefault();
      const ta = editorRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const lineStart = content.lastIndexOf('\n', start - 1) + 1;
      const currentLine = content.substring(lineStart, start);
      const indentMatch = currentLine.match(/^[\t ]*/);
      const currentIndent = indentMatch ? indentMatch[0] : '';
      const insertion = '\n' + currentIndent;
      const newContent = content.substring(0, start) + insertion + content.substring(ta.selectionEnd);
      setContent(newContent);
      onContentChange(newContent, newContent !== file.originalContent);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + insertion.length;
      });
      return;
    }
  }, [content, file.originalContent, file.useTabs, showFindReplace, onContentChange]);

  // Global Ctrl+S handler (catches it even when textarea not focused)
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [content, file.isDirty]);

  const handleSave = useCallback(async () => {
    if (!file.isDirty && content === file.originalContent) return;
    if (!isEditable) return;
    setIsSaving(true);
    try {
      // Normalize line endings before save
      const normalized = file.lineEnding === 'crlf'
        ? content.replace(/\r?\n/g, '\r\n')
        : content.replace(/\r\n/g, '\n');
      await onSave(file.absolutePath, normalized);
    } catch { /* error handled by parent */ }
    setIsSaving(false);
  }, [content, file, isEditable, onSave]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    onContentChange(newContent, newContent !== file.originalContent);
  }, [file.originalContent, onContentChange]);

  const handleClose = useCallback(() => {
    if (file.isDirty) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [file.isDirty, onClose]);

  // Find/Replace handlers
  const handleFindNext = useCallback(() => {
    if (!findText || !editorRef.current) return;
    const ta = editorRef.current;
    const idx = content.toLowerCase().indexOf(findText.toLowerCase(), ta.selectionEnd);
    if (idx !== -1) {
      ta.setSelectionRange(idx, idx + findText.length);
      ta.focus();
    } else {
      // Wrap around
      const wrapIdx = content.toLowerCase().indexOf(findText.toLowerCase());
      if (wrapIdx !== -1) {
        ta.setSelectionRange(wrapIdx, wrapIdx + findText.length);
        ta.focus();
      }
    }
  }, [findText, content]);

  const handleReplaceNext = useCallback(() => {
    if (!findText || !editorRef.current) return;
    const ta = editorRef.current;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.substring(start, end);
    if (selected.toLowerCase() === findText.toLowerCase()) {
      const newContent = content.substring(0, start) + replaceText + content.substring(end);
      setContent(newContent);
      onContentChange(newContent, newContent !== file.originalContent);
      requestAnimationFrame(() => handleFindNext());
    } else {
      handleFindNext();
    }
  }, [findText, replaceText, content, file.originalContent, onContentChange, handleFindNext]);

  const handleReplaceAll = useCallback(() => {
    if (!findText) return;
    const re = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const newContent = content.replace(re, replaceText);
    setContent(newContent);
    onContentChange(newContent, newContent !== file.originalContent);
  }, [findText, replaceText, content, file.originalContent, onContentChange]);

  const fileName = file.filePath.split('/').pop() || file.filePath;
  const language = getLanguageFromExt(file.filePath);

  return (
    <div className="h-full flex flex-col bg-[var(--theme-bg-app)] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--theme-border)]/20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--theme-text-secondary)]/50">
            Editor
          </span>
          <code className="text-[10px] text-[var(--theme-accent)] truncate max-w-[200px]" title={file.filePath}>
            {file.isDirty ? `● ${fileName}` : fileName}
          </code>
          {file.isBeingEditedByAI && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20 animate-pulse">
              AI editing — read-only
            </span>
          )}
          {file.isReadOnly && !file.isBeingEditedByAI && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400/80 border border-blue-500/20">
              Read-only
            </span>
          )}
          {file.isLockFile && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400/80 border border-orange-500/20">
              Lock file
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Save button */}
          {isEditable && (
            <button
              onClick={handleSave}
              disabled={!file.isDirty || isSaving}
              className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
                file.isDirty
                  ? 'border-[var(--theme-accent)]/30 text-[var(--theme-accent)] hover:bg-[var(--theme-accent)]/10'
                  : 'border-[var(--theme-border)]/20 text-[var(--theme-text-secondary)]/30 cursor-not-allowed'
              }`}
              title="Save (Ctrl+S / Cmd+S)"
            >
              {isSaving ? 'Saving...' : '💾 Save'}
            </button>
          )}
          {/* Refresh */}
          <button
            onClick={onRefresh}
            className="text-[9px] px-2 py-0.5 rounded border border-[var(--theme-border)]/20 text-[var(--theme-text-secondary)]/40 hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-accent)]/30 transition-colors"
            title="Reload file from disk"
          >
            ↻ Refresh
          </button>
          {/* Find */}
          <button
            onClick={() => setShowFindReplace(!showFindReplace)}
            className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
              showFindReplace
                ? 'border-[var(--theme-accent)]/30 text-[var(--theme-accent)] bg-[var(--theme-accent)]/5'
                : 'border-[var(--theme-border)]/20 text-[var(--theme-text-secondary)]/40 hover:text-[var(--theme-text-primary)]'
            }`}
            title="Find & Replace (Ctrl+F / Ctrl+H)"
          >
            🔍 Find
          </button>
          {/* Close */}
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-[var(--theme-bg-hover)]/40 text-[var(--theme-text-secondary)]/40 hover:text-[var(--theme-text-primary)]"
            title="Close editor"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Find/Replace bar */}
      {showFindReplace && (
        <div className="px-3 py-1.5 border-b border-[var(--theme-border)]/20 flex items-center gap-2 bg-[var(--theme-bg-surface)]/50">
          <input
            type="text"
            value={findText}
            onChange={e => setFindText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleFindNext(); }}
            placeholder="Find..."
            className="text-[10px] bg-transparent border border-[var(--theme-border)]/20 rounded px-2 py-0.5 text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]/50 w-36"
            autoFocus
          />
          <input
            type="text"
            value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleReplaceNext(); }}
            placeholder="Replace..."
            className="text-[10px] bg-transparent border border-[var(--theme-border)]/20 rounded px-2 py-0.5 text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]/50 w-36"
          />
          <span className="text-[9px] text-[var(--theme-text-secondary)]/40">
            {findMatchCount > 0 ? `${findMatchCount} match${findMatchCount !== 1 ? 'es' : ''}` : findText ? 'No matches' : ''}
          </span>
          <button onClick={handleFindNext} className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--theme-border)]/20 text-[var(--theme-text-secondary)]/50 hover:text-[var(--theme-text-primary)]">
            Next
          </button>
          <button onClick={handleReplaceNext} className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--theme-border)]/20 text-[var(--theme-text-secondary)]/50 hover:text-[var(--theme-text-primary)]">
            Replace
          </button>
          <button onClick={handleReplaceAll} className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--theme-border)]/20 text-[var(--theme-text-secondary)]/50 hover:text-[var(--theme-text-primary)]">
            All
          </button>
          <button onClick={() => setShowFindReplace(false)} className="text-[9px] text-[var(--theme-text-secondary)]/30 hover:text-[var(--theme-text-primary)] ml-auto">
            ✕
          </button>
        </div>
      )}

      {/* Toast message */}
      {toastMessage && (
        <div className="px-3 py-1 bg-[var(--theme-accent)]/10 border-b border-[var(--theme-accent)]/20 text-[10px] text-[var(--theme-accent)] animate-fadeIn">
          {toastMessage}
        </div>
      )}

      {/* Large file warning */}
      {showLargeFileWarn && (
        <div className="px-3 py-2 bg-yellow-500/10 border-b border-yellow-500/20 text-[10px] text-yellow-400 flex items-center justify-between">
          <span>⚠ This file is {formatSize(file.size)} — editing large files may be slow.</span>
          <button onClick={() => setShowLargeFileWarn(false)} className="text-[9px] px-2 py-0.5 rounded border border-yellow-500/20 hover:bg-yellow-500/10">
            Dismiss
          </button>
        </div>
      )}

      {/* Binary/Lock file message */}
      {file.isBinary ? (
        <div className="flex-1 flex items-center justify-center text-xs text-[var(--theme-text-secondary)]/40">
          <div className="text-center">
            <span className="text-2xl block mb-2">🖼️</span>
            <p>Binary file — cannot edit</p>
            <p className="text-[9px] text-[var(--theme-text-secondary)]/25 mt-1">{formatSize(file.size)}</p>
          </div>
        </div>
      ) : file.isOutsideWorktree ? (
        <div className="flex-1 flex items-center justify-center text-xs text-[var(--theme-text-secondary)]/40">
          <div className="text-center">
            <span className="text-2xl block mb-2">🚫</span>
            <p>File is outside the active worktree</p>
            <p className="text-[9px] text-[var(--theme-text-secondary)]/25 mt-1">Editing is restricted for safety</p>
          </div>
        </div>
      ) : (
        /* Editor content area */
        <div className="flex-1 flex overflow-hidden">
          {/* Line numbers */}
          <div
            ref={lineNumberRef}
            className="flex-shrink-0 py-1 pl-2 pr-3 text-right select-none border-r border-[var(--theme-border)]/10 overflow-hidden bg-[var(--theme-bg-surface)]/30"
            style={{ minWidth: `${Math.max(30, String(lineCount).length * 9 + 16)}px` }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="text-[10px] leading-5 text-[var(--theme-text-secondary)]/15 font-mono h-5">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Editor textarea */}
          <textarea
            ref={editorRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            readOnly={!isEditable || file.isBeingEditedByAI}
            spellCheck={false}
            className="flex-1 text-[11px] font-mono leading-5 p-1 pl-2 bg-transparent text-[var(--theme-text-primary)] outline-none resize-none overflow-auto scrollbar-thin"
            style={{
              tabSize: TAB_SIZE,
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              wordBreak: 'keep-all',
            }}
          />
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-1 border-t border-[var(--theme-border)]/20 text-[9px] text-[var(--theme-text-secondary)]/25 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span>{language}</span>
          <span>{lineCount} lines</span>
          <span>{formatSize(file.size)}</span>
          <span>{file.lineEnding.toUpperCase()}</span>
          <span>{file.useTabs ? 'Tabs' : `Spaces (${TAB_SIZE})`}</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Ln {cursorInfo.line}, Col {cursorInfo.col}</span>
          {isEditable ? (
            <span className="text-[var(--theme-accent)]/40">Editable</span>
          ) : (
            <span className="text-[var(--theme-text-secondary)]/30">Read-only</span>
          )}
        </div>
      </div>

      {/* Unsaved changes confirmation dialog */}
      {showCloseConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-panel p-4 max-w-sm border border-[var(--theme-border)]/30 rounded-lg">
            <h3 className="text-sm font-bold text-[var(--theme-text-primary)] mb-2">Unsaved Changes</h3>
            <p className="text-xs text-[var(--theme-text-secondary)] mb-4">
              You have unsaved changes in <strong>{fileName}</strong>. What would you like to do?
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="text-[10px] px-3 py-1 rounded border border-[var(--theme-border)]/30 text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowCloseConfirm(false); onClose(); }}
                className="text-[10px] px-3 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                Discard
              </button>
              <button
                onClick={async () => {
                  setShowCloseConfirm(false);
                  await handleSave();
                  onClose();
                }}
                className="text-[10px] px-3 py-1 rounded border border-[var(--theme-accent)]/30 text-[var(--theme-accent)] hover:bg-[var(--theme-accent)]/10"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Utility: check if a file path suggests a lock file */
export function isLockFilePath(filePath: string): boolean {
  const name = filePath.split('/').pop() || '';
  return LOCK_FILES.has(name);
}

/** Utility: check if a file path suggests a binary */
export function isBinaryPath(filePath: string): boolean {
  const ext = ('.' + (filePath.split('.').pop() || '')).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export { detectLineEnding, detectIndentation };
