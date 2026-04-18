/**
 * ToolCallCard — Sprint 15.2
 * Unified tool-call rendering card for all agent tools.
 * Theme-aware, collapsible, shows header + body + footer.
 * Specialized renderers for multi_edit, bash_command, parallel_search,
 * parallel_read, summarize_large_document, task_plan.
 * Sprint 15.2: always show tool name, target, status; display "No output" for empty results.
 */

import React, { useState, memo } from 'react';
import deepEqual from 'fast-deep-equal';
import CompareToolCard from '../compare/CompareToolCard';

interface ToolCallCardProps {
  name: string;
  input: any;
  result?: any;
  status: 'running' | 'success' | 'error';
  timestamp?: string;
  onOpenCompareWorkspace?: (sessionId: string) => void;
}

// Icon map for tool types
const TOOL_ICONS: Record<string, string> = {
  multi_edit: '\u270F\uFE0F',
  bash_command: '\uD83D\uDCBB',
  parallel_search: '\uD83D\uDD0D',
  parallel_read: '\uD83D\uDCC4',
  summarize_large_document: '\uD83D\uDCD6',
  task_plan: '\uD83D\uDCCB',
  read_file: '\uD83D\uDCC2',
  write_file: '\uD83D\uDCDD',
  patch_file: '\uD83E\uDE79',
  list_files: '\uD83D\uDCC1',
  search_files: '\uD83D\uDD0E',
  run_command: '\u25B6\uFE0F',
  git_status: '\uD83D\uDCCA',
  git_diff: '\u00B1',
  git_log: '\uD83D\uDCDC',
  git_commit: '\u2714\uFE0F',
  git_create_branch: '\uD83C\uDF3F',
  // Sprint 27: Compare Agent
  compare_file: '\u00B1',
  compare_folder: '\uD83D\uDCC1',
  merge_3way: '\uD83D\uDD00',
  sync_preview: '\uD83D\uDD04',
  compare_hunk_detail: '\uD83D\uDD0D',
  compare_apply_hunk: '\u2714\uFE0F',
};

// Sprint 27: Names that trigger the Compare tool card
const COMPARE_TOOL_NAMES = new Set(['compare_file', 'compare_folder', 'merge_3way', 'sync_preview', 'compare_hunk_detail', 'compare_apply_hunk']);

// Sprint 32: Memoize with deep equality to prevent unnecessary rerenders
// Reference: Cline ChatRow.tsx — memo(component, deepEqual)
function ToolCallCardInner({ name, input, result, status, onOpenCompareWorkspace }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(status === 'error');
  const icon = TOOL_ICONS[name] || '\uD83D\uDD27';

  // Sprint 27: Render Compare tool card for compare operations
  if (COMPARE_TOOL_NAMES.has(name) && result) {
    let parsedResult = result;
    if (typeof result === 'string') {
      try { parsedResult = JSON.parse(result); } catch { /* keep as-is */ }
    }
    const sessionData = parsedResult?.compareSession || parsedResult;
    if (sessionData?.sessionId) {
      return <CompareToolCard sessionData={sessionData} onOpenWorkspace={onOpenCompareWorkspace} />;
    }
  }

  const statusColors = {
    running: 'border-matrix-warning/30 bg-matrix-warning/5',
    success: 'border-matrix-green/30 bg-matrix-green/5',
    error: 'border-matrix-danger/30 bg-matrix-danger/5',
  };

  const statusLabel = {
    running: 'Running...',
    success: 'Done',
    error: 'Failed',
  };

  let parsedResult: any = null;
  if (result && typeof result === 'string') {
    try { parsedResult = JSON.parse(result); } catch { parsedResult = result; }
  } else {
    parsedResult = result;
  }

  return (
    <div className={`rounded-lg border text-[11px] overflow-hidden transition-all ${statusColors[status]}`}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-matrix-bg-hover/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-sm">{icon}</span>
        <span className="font-mono font-bold text-matrix-green">{name}</span>
        {status === 'running' && (
          <span className="w-3 h-3 border-2 border-matrix-warning/40 border-t-matrix-warning rounded-full animate-spin" />
        )}
        <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider ${
          status === 'success' ? 'text-matrix-green' : status === 'error' ? 'text-matrix-danger' : 'text-matrix-warning'
        }`}>{statusLabel[status]}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform ${expanded ? 'rotate-180' : ''} text-matrix-text-muted/40`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Body — specialized per tool */}
      {expanded && (
        <div className="px-3 py-2 border-t border-matrix-border/20 space-y-2">
          {renderToolBody(name, input, parsedResult, status)}
        </div>
      )}

      {/* Footer for quick summary when collapsed */}
      {!expanded && (
        <div className="px-3 py-1 border-t border-matrix-border/10 text-[9px] text-matrix-text-muted/50 truncate">
          {renderToolSummary(name, input, parsedResult)}
        </div>
      )}
    </div>
  );
}

function renderToolBody(name: string, input: any, result: any, status: string) {
  switch (name) {
    case 'multi_edit':
      return <MultiEditBody input={input} result={result} />;
    case 'bash_command':
      return <BashCommandBody input={input} result={result} />;
    case 'parallel_search':
      return <ParallelSearchBody input={input} result={result} />;
    case 'parallel_read':
      return <ParallelReadBody input={input} result={result} />;
    case 'summarize_large_document':
      return <SummarizeBody input={input} result={result} />;
    case 'task_plan':
      return <TaskPlanBody input={input} result={result} />;
    case 'compare_file':
    case 'compare_folder':
    case 'merge_3way':
    case 'sync_preview':
    case 'compare_hunk_detail':
    case 'compare_apply_hunk':
      return <GenericToolBody input={input} result={result} />;
    default:
      return <GenericToolBody input={input} result={result} />;
  }
}

function renderToolSummary(name: string, input: any, result: any): string {
  if (!result && !input) return 'No output';
  try {
    switch (name) {
      case 'multi_edit':
        return `${result?.file_path || input?.file_path || '?'} \u2014 ${result?.applied || input?.edits?.length || '?'} edits`;
      case 'bash_command': {
        const cmd = (input?.command || '').substring(0, 80);
        const ec = result?.exit_code ?? (result?.blocked ? 'blocked' : '?');
        return `$ ${cmd} \u2192 exit ${ec}`;
      }
      case 'parallel_search':
        return `${result?.completed || input?.queries?.length || '?'} queries`;
      case 'parallel_read':
        return `${result?.completed || input?.urls?.length || '?'} URLs`;
      case 'summarize_large_document':
        return `${(input?.url || '').substring(0, 40)} \u2014 ${(input?.question || '').substring(0, 40)}`;
      case 'task_plan':
        return `${input?.action || '?'} \u2014 ${result?.plan?.tasks?.length || input?.tasks?.length || '?'} tasks`;
      case 'read_file':
        return input?.path || (typeof result === 'string' ? `${result.length} chars read` : 'read');
      case 'write_file':
        return input?.path ? `${input.path} (${input?.content?.length || 0} chars)` : (typeof result === 'string' ? result.substring(0, 80) : 'written');
      case 'patch_file':
        return input?.path || (typeof result === 'string' ? result.substring(0, 80) : 'patched');
      case 'list_files':
        return input?.path || '.';
      case 'search_files':
        return input?.query ? `"${input.query}"` : 'search';
      case 'run_command':
        return `$ ${(input?.command || '').substring(0, 80)}`;
      case 'git_status':
        return typeof result === 'string' ? result.split('\n')[0] || 'status' : 'status';
      case 'git_diff':
        return input?.staged ? 'staged changes' : 'working tree changes';
      case 'git_log':
        return `${input?.count || 10} entries`;
      case 'git_commit':
        return input?.message ? input.message.substring(0, 60) : 'commit';
      case 'git_create_branch':
        return input?.name || 'new branch';
      // Sprint 27: Compare Agent summaries
      case 'compare_file':
        return `${input?.left || '?'} \u2194 ${input?.right || '?'}`;
      case 'compare_folder':
        return `${input?.left || '?'} \u2194 ${input?.right || '?'} (folder)`;
      case 'merge_3way':
        return `3-way merge: ${input?.base || '?'}`;
      case 'sync_preview':
        return `sync ${input?.direction || 'preview'}`;
      case 'compare_hunk_detail':
        return `hunk #${input?.hunk_index ?? '?'} of ${input?.session_id?.substring(0, 12) || '?'}`;
      case 'compare_apply_hunk':
        return `${input?.action || '?'} hunk #${input?.hunk_index ?? '?'}`;
      default: {
        if (typeof result === 'string' && result.length > 0) return result.substring(0, 100);
        if (input) {
          const summary = Object.entries(input).map(([k, v]) => `${k}: ${String(v).substring(0, 30)}`).join(', ');
          return summary.substring(0, 100) || 'No output';
        }
        return 'No output';
      }
    }
  } catch {
    return 'No output';
  }
}

// ─── Specialized Tool Bodies ───

function MultiEditBody({ input, result }: { input: any; result: any }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-matrix-text-muted/50">File:</span>
        <code className="text-matrix-green font-mono">{result?.file_path || input?.file_path}</code>
        <span className="text-matrix-text-muted/30">|</span>
        <span className="text-matrix-text-muted/50">{result?.applied || input?.edits?.length || 0} edits</span>
      </div>
      {result?.diff && (
        <pre className="text-[10px] bg-matrix-bg-elevated p-2 rounded font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre">
          {result.diff.split('\n').map((line: string, i: number) => (
            <div key={i} className={
              line.startsWith('+') ? 'text-matrix-green' :
              line.startsWith('-') ? 'text-matrix-danger' :
              line.startsWith('@@') ? 'text-matrix-info/70' : 'text-matrix-text-muted/40'
            }>{line}</div>
          ))}
        </pre>
      )}
      {result?.error && <div className="text-matrix-danger text-[10px]">{result.error}</div>}
    </div>
  );
}

function BashCommandBody({ input, result }: { input: any; result: any }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <code className="text-matrix-green font-mono bg-matrix-bg-elevated px-2 py-0.5 rounded text-[10px]">
          $ {input?.command}
        </code>
        {result?.exit_code !== undefined && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
            result.exit_code === 0 ? 'bg-matrix-green/10 text-matrix-green' : 'bg-matrix-danger/10 text-matrix-danger'
          }`}>
            exit {result.exit_code}
          </span>
        )}
        {result?.timed_out && <span className="text-[9px] text-matrix-warning font-bold">TIMEOUT</span>}
        {result?.blocked && <span className="text-[9px] text-matrix-danger font-bold">BLOCKED: {result.block_reason}</span>}
        {result?.duration_ms !== undefined && (
          <span className="text-[9px] text-matrix-text-muted/40">{result.duration_ms}ms</span>
        )}
      </div>
      {result?.stdout && (
        <pre className="text-[10px] bg-matrix-bg-elevated p-2 rounded font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre text-matrix-text-dim">
          {result.stdout.substring(0, 5000)}
        </pre>
      )}
      {result?.stderr && (
        <pre className="text-[10px] bg-matrix-danger/5 p-2 rounded font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre text-matrix-danger/80">
          {result.stderr.substring(0, 3000)}
        </pre>
      )}
    </div>
  );
}

function ParallelSearchBody({ input, result }: { input: any; result: any }) {
  return (
    <div className="space-y-2">
      <div className="text-matrix-text-muted/50">
        {result?.completed || 0}/{result?.total_queries || 0} queries completed
        {result?.failed > 0 && <span className="text-matrix-danger ml-2">{result.failed} failed</span>}
      </div>
      {result?.results?.map((r: any, i: number) => (
        <div key={i} className="bg-matrix-bg-elevated rounded p-2 space-y-1">
          <div className="font-bold text-matrix-green text-[10px]">{r.query}</div>
          {r.error && <div className="text-matrix-danger text-[9px]">{r.error}</div>}
          {r.results?.map((sr: any, j: number) => (
            <div key={j} className="text-[9px] pl-2 border-l border-matrix-border/20">
              <a href={sr.url} target="_blank" rel="noreferrer" className="text-matrix-info/70 hover:text-matrix-info underline">
                {sr.title?.substring(0, 80)}
              </a>
              {sr.snippet && <div className="text-matrix-text-muted/40 mt-0.5">{sr.snippet.substring(0, 120)}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ParallelReadBody({ input, result }: { input: any; result: any }) {
  return (
    <div className="space-y-2">
      <div className="text-matrix-text-muted/50">
        {result?.completed || 0}/{result?.total_urls || 0} URLs read
        {result?.failed > 0 && <span className="text-matrix-danger ml-2">{result.failed} failed</span>}
      </div>
      {result?.results?.map((r: any, i: number) => (
        <div key={i} className="bg-matrix-bg-elevated rounded p-2 space-y-1">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${r.status === 'success' ? 'bg-matrix-green' : 'bg-matrix-danger'}`} />
            <a href={r.url} target="_blank" rel="noreferrer" className="text-matrix-info/70 hover:text-matrix-info text-[10px] truncate underline">
              {r.title || r.url}
            </a>
            {r.word_count && <span className="text-[9px] text-matrix-text-muted/30">{r.word_count.toLocaleString()} words</span>}
          </div>
          {r.answer && <div className="text-[9px] text-matrix-text-dim mt-1 line-clamp-3">{r.answer.substring(0, 300)}</div>}
          {r.error && <div className="text-matrix-danger text-[9px]">{r.error}</div>}
        </div>
      ))}
    </div>
  );
}

function SummarizeBody({ input, result }: { input: any; result: any }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-matrix-text-muted/50">Source:</span>
        <a href={result?.url || input?.url} target="_blank" rel="noreferrer" className="text-matrix-info/70 hover:text-matrix-info text-[10px] underline truncate max-w-xs">
          {result?.url || input?.url}
        </a>
        {result?.word_count && <span className="text-[9px] text-matrix-text-muted/30">{result.word_count.toLocaleString()} words</span>}
      </div>
      <div className="text-[10px] text-matrix-green font-bold">Q: {result?.question || input?.question}</div>
      {result?.answer && (
        <div className="text-[10px] text-matrix-text-dim whitespace-pre-wrap max-h-48 overflow-y-auto bg-matrix-bg-elevated rounded p-2">
          {result.answer.substring(0, 5000)}
        </div>
      )}
      {result?.error && <div className="text-matrix-danger text-[10px]">{result.error}</div>}
    </div>
  );
}

/**
 * Sprint 32: Lightweight TaskPlanBody — plan state renders in the sticky
 * TaskPlanCard at the top of the chat (Cline's currentFocusChainChecklist pattern).
 * This body is just a one-line status indicator (like Cline's ChatRow case "task_progress":
 * return <InvisibleSpacer />).
 */
function TaskPlanBody({ input, result }: { input: any; result: any }) {
  const action = input?.action || 'update';
  const taskCount = Array.isArray(input?.tasks) ? input.tasks.length : undefined;
  return (
    <div className="text-xs text-matrix-text-muted/60">
      {action}{taskCount != null ? ` \u2014 ${taskCount} tasks` : ''}
      <span className="ml-2 text-[9px] text-matrix-text-muted/40">
        {/* Full plan renders in the sticky TaskPlanCard at the top of the chat */}
        (plan visible above)
      </span>
    </div>
  );
}

function GenericToolBody({ input, result }: { input: any; result: any }) {
  const hasInput = input && (typeof input === 'string' ? input.length > 0 : Object.keys(input).length > 0);
  const hasResult = result && (typeof result === 'string' ? result.length > 0 : (typeof result === 'object' && Object.keys(result).length > 0));

  if (!hasInput && !hasResult) {
    return (
      <div className="text-[10px] text-matrix-text-muted/40 italic py-1">
        No output from this tool call.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasInput && (
        <div>
          <div className="text-[9px] text-matrix-text-muted/40 uppercase tracking-wider mb-1">Input</div>
          <pre className="text-[10px] bg-matrix-bg-elevated p-2 rounded font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre text-matrix-text-dim">
            {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
      {hasResult && (
        <div>
          <div className="text-[9px] text-matrix-text-muted/40 uppercase tracking-wider mb-1">Result</div>
          <pre className="text-[10px] bg-matrix-bg-elevated p-2 rounded font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre text-matrix-text-dim">
            {typeof result === 'string' ? result.substring(0, 5000) : JSON.stringify(result, null, 2).substring(0, 5000)}
          </pre>
        </div>
      )}
    </div>
  );
}

// Sprint 32: Wrap export with memo + deepEqual (Cline ChatRow.tsx pattern)
const ToolCallCard = memo(ToolCallCardInner, deepEqual);
export default ToolCallCard;
