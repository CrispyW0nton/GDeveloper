/**
 * LiveCodeView — Sprint 19 + Sprint 23
 * Sprint 19: read-only code viewer that updates when the AI edits files.
 * Sprint 23: upgraded to full editable editor with CodeEditor component.
 * Features:
 *   - Editable code editor with syntax-aware indentation
 *   - Dirty-state indicator (asterisk) in tab and header
 *   - Save with Cmd/Ctrl+S, confirm dialog on close with unsaved changes
 *   - Atomic save with toast "Saved ✓ [filename]"
 *   - Blocks editing of lock files, binaries, files outside worktree
 *   - Warns for files > 5 MB
 *   - "AI is editing this file" read-only banner
 *   - Toggle between editor and diff view
 *   - Handles multiple files (switch focus or queue)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import CodeEditor, {
  type EditorFileState,
  detectLineEnding,
  detectIndentation,
  isLockFilePath,
  isBinaryPath,
} from '../editor/CodeEditor';

const api = (window as any).electronAPI;

export interface FileViewState {
  filePath: string;
  absolutePath: string;
  content: string | null;
  isBinary: boolean;
  isTooLarge: boolean;
  size: number;
  lastTool?: string;
  isBeingEdited?: boolean;
  timestamp?: number;
}

interface LiveCodeViewProps {
  visible: boolean;
  currentFile: FileViewState | null;
  recentFiles: FileViewState[];
  onFileSwitch: (filePath: string) => void;
  onClose: () => void;
  editProgress?: string;
  // Sprint 23: editor integration
  workspaceRoot?: string;
  onDirtyStateChange?: (filePath: string, isDirty: boolean) => void;
  toastMessage?: string;
  onToast?: (msg: string) => void;
}

export default function LiveCodeView({
  visible,
  currentFile,
  recentFiles,
  onFileSwitch,
  onClose,
  editProgress,
  workspaceRoot,
  onDirtyStateChange,
  toastMessage,
  onToast,
}: LiveCodeViewProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(0);
  const [editorFile, setEditorFile] = useState<EditorFileState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build EditorFileState from FileViewState
  useEffect(() => {
    if (!currentFile || currentFile.isBinary || !currentFile.content) {
      setEditorFile(null);
      return;
    }

    const content = currentFile.content || '';
    const isBinary = currentFile.isBinary || isBinaryPath(currentFile.filePath);
    const isLock = isLockFilePath(currentFile.filePath);
    const isOutside = workspaceRoot ? !currentFile.absolutePath.startsWith(workspaceRoot) : false;

    setEditorFile({
      filePath: currentFile.filePath,
      absolutePath: currentFile.absolutePath,
      content,
      originalContent: content,
      isDirty: false,
      isBinary,
      isLockFile: isLock,
      isTooLarge: currentFile.isTooLarge,
      isReadOnly: isBinary || isLock || isOutside,
      isOutsideWorktree: isOutside,
      size: currentFile.size,
      lineEnding: detectLineEnding(content),
      useTabs: detectIndentation(content),
      isBeingEditedByAI: currentFile.isBeingEdited,
    });

    setLineCount(content.split('\n').length);
  }, [currentFile?.filePath, currentFile?.content, currentFile?.isBeingEdited, workspaceRoot]);

  // Load diff when toggled
  useEffect(() => {
    if (showDiff && currentFile?.absolutePath && api?.gitDiff) {
      api.gitDiff().then((result: any) => {
        if (result.success && result.diff) {
          const fileDiff = extractFileDiff(result.diff, currentFile.absolutePath);
          setDiffContent(fileDiff || '(No changes detected in git diff)');
        }
      }).catch(() => setDiffContent('(Failed to load diff)'));
    }
  }, [showDiff, currentFile?.absolutePath]);

  const handleContentChange = useCallback((newContent: string, isDirty: boolean) => {
    setEditorFile(prev => prev ? { ...prev, content: newContent, isDirty } : null);
    if (currentFile) {
      onDirtyStateChange?.(currentFile.filePath, isDirty);
    }
  }, [currentFile, onDirtyStateChange]);

  const handleSave = useCallback(async (filePath: string, content: string): Promise<boolean> => {
    if (!api?.writeFileContent) {
      onToast?.('Save failed: not available in web preview mode');
      return false;
    }
    try {
      const result = await api.writeFileContent(filePath, content);
      if (result.success) {
        const fileName = filePath.split('/').pop() || filePath;
        onToast?.(`Saved ✓ ${fileName}`);
        // Update editor state to reflect saved content
        setEditorFile(prev => prev ? { ...prev, originalContent: content, isDirty: false, lastSavedAt: Date.now() } : null);
        onDirtyStateChange?.(currentFile?.filePath || filePath, false);
        return true;
      } else {
        onToast?.(`Save failed: ${result.error || 'Unknown error'}`);
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onToast?.(`Save failed: ${msg}`);
      return false;
    }
  }, [currentFile, onDirtyStateChange, onToast]);

  const handleEditorClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleRefresh = useCallback(async () => {
    if (!currentFile?.absolutePath || !api?.readFileContent) return;
    try {
      const result = await api.readFileContent(currentFile.absolutePath);
      if (result.content != null) {
        const content = result.content;
        setEditorFile(prev => prev ? {
          ...prev,
          content,
          originalContent: content,
          isDirty: false,
          size: result.size || prev.size,
        } : null);
        onDirtyStateChange?.(currentFile.filePath, false);
      }
    } catch { /* ignore */ }
  }, [currentFile, onDirtyStateChange]);

  if (!visible || !currentFile) return null;

  const fileName = currentFile.filePath.split('/').pop() || currentFile.filePath;

  // If in diff mode, show the diff view
  if (showDiff) {
    return (
      <div className="h-full flex flex-col bg-matrix-bg/98 overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2 border-b border-matrix-border/20 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider font-bold text-matrix-text-muted/50">Diff</span>
            <code className="text-[10px] text-matrix-green truncate max-w-[200px]" title={currentFile.filePath}>
              {currentFile.filePath}
            </code>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowDiff(false)}
              className="text-[9px] px-2 py-0.5 rounded border border-matrix-green/30 text-matrix-green bg-matrix-green/5"
              title="Switch to editor"
            >
              Editor
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-matrix-bg-hover/40 text-matrix-text-muted/40 hover:text-matrix-text-dim"
              title="Close"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto scrollbar-thin">
          <pre className="text-[10px] font-mono p-3 leading-5">
            {(diffContent || '').split('\n').map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('+') ? 'text-matrix-green bg-matrix-green/5' :
                  line.startsWith('-') ? 'text-matrix-danger bg-matrix-danger/5' :
                  line.startsWith('@@') ? 'text-matrix-info/70 bg-matrix-info/5' :
                  'text-matrix-text-muted/50'
                }
              >
                {line}
              </div>
            ))}
          </pre>
        </div>
      </div>
    );
  }

  // Binary or too-large files: show info panels
  if (currentFile.isBinary) {
    return (
      <div className="h-full flex flex-col bg-matrix-bg/98 overflow-hidden">
        <FileViewHeader
          currentFile={currentFile}
          editorFile={editorFile}
          recentFiles={recentFiles}
          showDiff={showDiff}
          onShowDiff={setShowDiff}
          onFileSwitch={onFileSwitch}
          onClose={onClose}
          editProgress={editProgress}
        />
        <div className="flex-1 flex items-center justify-center text-xs text-matrix-text-muted/40">
          <div className="text-center">
            <span className="text-2xl block mb-2">🖼️</span>
            <p>Binary file — cannot display</p>
            <p className="text-[9px] text-matrix-text-muted/25 mt-1">{formatSize(currentFile.size)}</p>
          </div>
        </div>
      </div>
    );
  }

  if (currentFile.isTooLarge && !currentFile.content) {
    return (
      <div className="h-full flex flex-col bg-matrix-bg/98 overflow-hidden">
        <FileViewHeader
          currentFile={currentFile}
          editorFile={editorFile}
          recentFiles={recentFiles}
          showDiff={showDiff}
          onShowDiff={setShowDiff}
          onFileSwitch={onFileSwitch}
          onClose={onClose}
          editProgress={editProgress}
        />
        <div className="flex-1 flex items-center justify-center text-xs text-matrix-text-muted/40">
          <div className="text-center">
            <span className="text-2xl block mb-2">📄</span>
            <p>File too large to display</p>
            <p className="text-[9px] text-matrix-text-muted/25 mt-1">{formatSize(currentFile.size)}</p>
          </div>
        </div>
      </div>
    );
  }

  // Sprint 23: Full editable editor
  if (editorFile) {
    return (
      <div className="h-full flex flex-col bg-matrix-bg/98 overflow-hidden relative">
        {/* Recent files tabs */}
        {recentFiles.length > 1 && (
          <div className="flex gap-0.5 px-2 py-1 border-b border-matrix-border/10 overflow-x-auto scrollbar-thin">
            {recentFiles.slice(0, 8).map(f => {
              const fName = f.filePath.split('/').pop() || f.filePath;
              const isActive = f.filePath === currentFile.filePath;
              const isDirty = editorFile.isDirty && isActive;
              return (
                <button
                  key={f.filePath}
                  onClick={() => onFileSwitch(f.filePath)}
                  className={`text-[9px] px-2 py-0.5 rounded whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-matrix-green/10 text-matrix-green border border-matrix-green/20'
                      : 'text-matrix-text-muted/40 hover:text-matrix-text-dim hover:bg-matrix-bg-hover/30'
                  }`}
                  title={f.filePath}
                >
                  {isDirty ? '● ' : ''}{fName}
                  {f.isBeingEdited && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-yellow-400/70 inline-block" />}
                </button>
              );
            })}
            {/* Diff toggle */}
            <button
              onClick={() => setShowDiff(true)}
              className="text-[9px] px-2 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/40 hover:text-matrix-text-dim ml-auto"
              title="Show diff view"
            >
              Diff
            </button>
          </div>
        )}

        <CodeEditor
          file={editorFile}
          onContentChange={handleContentChange}
          onSave={handleSave}
          onClose={handleEditorClose}
          onRefresh={handleRefresh}
          toastMessage={toastMessage}
        />
      </div>
    );
  }

  // Fallback: no content
  return (
    <div className="h-full flex items-center justify-center text-xs text-matrix-text-muted/30">
      No content to display
    </div>
  );
}

// ─── Shared header component for non-editor views ───

function FileViewHeader({
  currentFile,
  editorFile,
  recentFiles,
  showDiff,
  onShowDiff,
  onFileSwitch,
  onClose,
  editProgress,
}: {
  currentFile: FileViewState;
  editorFile: EditorFileState | null;
  recentFiles: FileViewState[];
  showDiff: boolean;
  onShowDiff: (show: boolean) => void;
  onFileSwitch: (filePath: string) => void;
  onClose: () => void;
  editProgress?: string;
}) {
  return (
    <>
      <div className="px-3 py-2 border-b border-matrix-border/20 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-bold text-matrix-text-muted/50">
            {showDiff ? 'Diff' : 'Live View'}
          </span>
          <code className="text-[10px] text-matrix-green truncate max-w-[200px]" title={currentFile.filePath}>
            {currentFile.filePath}
          </code>
          {currentFile.isBeingEdited && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20 animate-pulse">
              AI editing
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {editProgress && (
            <span className="text-[9px] text-matrix-text-muted/40 mr-2">{editProgress}</span>
          )}
          <button
            onClick={() => onShowDiff(!showDiff)}
            className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
              showDiff
                ? 'border-matrix-green/30 text-matrix-green bg-matrix-green/5'
                : 'border-matrix-border/20 text-matrix-text-muted/40 hover:text-matrix-text-dim'
            }`}
          >
            {showDiff ? 'Live' : 'Diff'}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-matrix-bg-hover/40 text-matrix-text-muted/40 hover:text-matrix-text-dim"
            title="Close"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      {recentFiles.length > 1 && (
        <div className="flex gap-0.5 px-2 py-1 border-b border-matrix-border/10 overflow-x-auto scrollbar-thin">
          {recentFiles.slice(0, 8).map(f => {
            const fName = f.filePath.split('/').pop() || f.filePath;
            const isActive = f.filePath === currentFile.filePath;
            return (
              <button
                key={f.filePath}
                onClick={() => onFileSwitch(f.filePath)}
                className={`text-[9px] px-2 py-0.5 rounded whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-matrix-green/10 text-matrix-green border border-matrix-green/20'
                    : 'text-matrix-text-muted/40 hover:text-matrix-text-dim hover:bg-matrix-bg-hover/30'
                }`}
                title={f.filePath}
              >
                {fName}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function extractFileDiff(fullDiff: string, filePath: string): string | null {
  const filename = filePath.split('/').pop() || filePath;
  const lines = fullDiff.split('\n');
  let inFile = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git') && line.includes(filename)) {
      inFile = true;
    } else if (line.startsWith('diff --git') && inFile) {
      break;
    }
    if (inFile) {
      result.push(line);
    }
  }

  return result.length > 0 ? result.join('\n') : null;
}
