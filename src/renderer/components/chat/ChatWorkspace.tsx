/**
 * ChatWorkspace — Sprint 12 + Sprint 15.2 + Sprint 18 + Sprint 25
 * Full chat UI with streaming, tool-call display, history persistence.
 * Sprint 12 additions: slash command autocomplete, mode indicator,
 * suggestion cards on empty chat, follow-up action buttons.
 * Sprint 15.2: fix empty tool cards (pass full input/result),
 * prevent raw Anthropic tool_use JSON from rendering in chat,
 * improved tool result matching by toolCallId.
 * Sprint 18: polished header context, clearer mode/worktree labels,
 * improved error explanations, tool result readability, microcopy pass.
 * Sprint 25: drag-drop, clipboard paste, vision, document extraction,
 * attachment preview modal, security warnings.
 */

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { SessionInfo, SelectedRepo, ExecutionMode, type ModelMeta, type SessionUsage, type AttachmentMeta, type AttachmentConfig } from '../../store';
import SlashCommandDropdown, { SlashCommandInfo } from './SlashCommandDropdown';
import SuggestionCards from './SuggestionCards';
import FollowupButtons from './FollowupButtons';
import ToolCallCard from './ToolCallCard';
// Sprint 28: AutoContinueToggle removed — loop is driven by stop_reason
import RateLimitIndicator, { type RateLimitSnapshot, type RetryState } from './RateLimitIndicator';
import ModelPickerInline from './ModelPickerInline';
import TokenCounter from './TokenCounter';
import AttachmentChip from './AttachmentChip';
import DropZoneOverlay from './DropZoneOverlay';
import AttachmentPreviewModal from './AttachmentPreviewModal';
import deepEqual from 'fast-deep-equal';

const api = (window as any).electronAPI;

/**
 * Sprint 32: Sticky TaskPlanCard — top-level component rendered outside the
 * tool call loop. Plan state lives in activePlan (Cline's currentFocusChainChecklist).
 * Memoized with deep equality to prevent unnecessary rerenders.
 * Reference: Cline ChatRow.tsx memo(component, deepEqual) pattern.
 */
const TaskPlanCard = memo(function TaskPlanCard({ plan }: { plan: any }) {
  if (!plan?.tasks?.length) return null;

  const STATUS_ICONS: Record<string, string> = {
    pending: '\u23F3',
    in_progress: '\uD83D\uDD04',
    done: '\u2705',
    skipped: '\u23ED\uFE0F',
    failed: '\u274C',
  };

  const done = plan.tasks.filter((t: any) => t.status === 'done').length;
  const total = plan.tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mb-3 rounded-lg border border-matrix-green/30 bg-matrix-green/5 p-3 text-[11px]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{'\uD83D\uDCCB'}</span>
        <span className="font-mono font-bold text-matrix-green">Task Plan</span>
        <span className="ml-auto text-[9px] font-bold text-matrix-green">{done}/{total} ({pct}%)</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1.5 bg-matrix-bg-elevated rounded overflow-hidden">
          <div className="h-full bg-matrix-green transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="space-y-1">
        {plan.tasks.map((t: any) => (
          <div key={t.id} className="flex items-start gap-2 text-[10px]">
            <span>{STATUS_ICONS[t.status] || '\u2B55'}</span>
            <span className={`flex-1 ${
              t.status === 'done' ? 'line-through text-matrix-text-muted/30' :
              t.status === 'in_progress' ? 'text-matrix-warning font-bold' :
              t.status === 'failed' ? 'text-matrix-danger' :
              t.status === 'skipped' ? 'text-matrix-text-muted/30' :
              'text-matrix-text-dim'
            }`}>
              {t.content}
            </span>
            <span className={`text-[8px] uppercase ${
              t.priority === 'high' ? 'text-matrix-danger' :
              t.priority === 'low' ? 'text-matrix-text-muted/30' : 'text-matrix-text-muted/50'
            }`}>{t.priority}</span>
          </div>
        ))}
      </div>
    </div>
  );
}, deepEqual);

interface WorktreeContextInfo {
  isWorktree: boolean;
  isMain: boolean;
  isLinked: boolean;
  branch: string | null;
  head: string;
}

interface ChatWorkspaceProps {
  session: SessionInfo;
  repo: SelectedRepo;
  providerKey: string;
  executionMode: ExecutionMode;
  onModeChange: (mode: ExecutionMode) => void;
  selectedModel?: string;
  availableModels?: string[];
  onModelChange?: (model: string) => void;
  worktreeContext?: WorktreeContextInfo | null;
  // Sprint 28: autoContinue props removed
  // Sprint 21: Rate limiting
  rateLimitSnapshot?: RateLimitSnapshot | null;
  retryState?: RetryState | null;
  softInputLimit?: number;
  softOutputLimit?: number;
  softRequestLimit?: number;
  // Sprint 23: Model picker metadata
  modelMetaList?: ModelMeta[];
  defaultModel?: string;
  onSetDefaultModel?: (model: string) => void;
  apiKeyConfigured?: boolean;
  // Sprint 24: Token counter
  sessionUsage?: SessionUsage | null;
  onSessionUsageUpdate?: (usage: SessionUsage) => void;
  // Sprint 25: Attachments
  attachmentConfig?: AttachmentConfig;
  visionSupported?: boolean;
  // Sprint 25.5: Model refresh
  onRefreshModels?: () => void;
  isRefreshingModels?: boolean;
  // Sprint 27: Compare workspace
  onOpenCompareWorkspace?: (sessionId: string) => void;
  // Sprint 38 Feature 3: Optional callback used by the MCP warning banner
  // [Manage MCP] button. Parent (App.tsx) wires this to the 'mcp' tab switch.
  onOpenMCPSettings?: () => void;
}

interface ToolCallDisplay {
  name: string;
  description: string;
  status: 'success' | 'error' | 'running';
  input?: any;
  result?: any;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'command';
  content: string;
  toolCalls?: ToolCallDisplay[];
  timestamp: string;
  streaming?: boolean;
}

export default function ChatWorkspace({ session, repo, providerKey, executionMode, onModeChange, selectedModel, availableModels, onModelChange, worktreeContext, rateLimitSnapshot, retryState, softInputLimit, softOutputLimit, softRequestLimit, modelMetaList, defaultModel, onSetDefaultModel, apiKeyConfigured, sessionUsage, onSessionUsageUpdate, attachmentConfig, visionSupported, onRefreshModels, isRefreshingModels, onOpenCompareWorkspace, onOpenMCPSettings }: ChatWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallDisplay[]>([]);
  // Sprint 38 Bug 3: `showSuggestions` is derived, not state.
  // Suggestion cards must appear iff the transcript is empty AND the composer
  // is empty AND no attachments are staged. Tracking it as state produced
  // flicker bugs: /clear could set it true while the composer still held
  // typed text, and various setters (handleSend, executeSlashCommand, history
  // loader, handleSuggestionSelect, Fresh Chat button) drifted out of sync
  // with the true display condition. Derived state collapses all of those
  // into a single source of truth.
  // Sprint 32: Top-level activePlan state (Cline's currentFocusChainChecklist pattern).
  // Plan lives HERE, not inside a tool card's result field. This prevents the
  // "reverts to Waiting for plan data..." bug caused by React unmount/remount.
  const [activePlan, setActivePlanState] = useState<any>(null);
  const activePlanRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Slash command state
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [showSlashDropdown, setShowSlashDropdown] = useState(false);

  // Sprint 38 Bug 1: Composer lock — while a send is in flight we block
  // handleInputChange from mutating `input`, and we ensure setInput('') only
  // runs AFTER the user message has been committed to setMessages(). This
  // prevents (a) in-flight typing from being clobbered by a programmatic
  // clear and (b) the user's current prompt from vanishing before they can
  // see it committed to the transcript.
  const isComposerLockedRef = useRef(false);

  // Sprint 38 Bug 2: Keep a ref mirror of streamingContent so the IPC event
  // handler (registered once in an effect with a stable closure) can read the
  // CURRENT value without relying on a re-subscribed callback. Needed because
  // attempt_completion's tool_result arrives via the same chat:stream-chunk
  // channel and we must flush whatever streamed text preceded it before the
  // channel overwrites/clears that text.
  const streamingContentRef = useRef('');

  // ─── Sprint 38 Features 1 / 3: MCP tool accounting ───
  // Live count of ENABLED tools across CONNECTED MCP servers. Each tool's
  // JSON-schema definition is shipped to Anthropic on every request, so a
  // large count pushes both the per-message token cost and the org-level
  // rate limits. We refresh on mount, on sessionId change, and whenever the
  // user triggers /mcp-off so the banner and the token counter stay in sync.
  const [mcpEnabledToolCount, setMcpEnabledToolCount] = useState(0);
  const [mcpConnectedServers, setMcpConnectedServers] = useState<Array<{ id: string; name: string; toolCount: number }>>([]);
  const [mcpBannerDismissed, setMcpBannerDismissed] = useState(false);
  // Sprint 38 Feature 4: /mcp-off picker visibility
  const [mcpPickerVisible, setMcpPickerVisible] = useState(false);

  // Sprint 38 Feature 5: Retry countdown. `retryState.nextRetryMs` is the
  // wall-clock instant we should next retry. We expose the remaining seconds
  // so the banner ticks down once per second without re-rendering the whole
  // tree on every frame.
  const [retryCountdownSec, setRetryCountdownSec] = useState<number | null>(null);

  // Refresh MCP server list. Defined here so both the effect below and the
  // /mcp-off slash command can reuse it.
  const refreshMCPInfo = useCallback(async () => {
    if (!api?.listMCPServers) return;
    try {
      const servers: any[] = await api.listMCPServers();
      const connected = (servers || [])
        .filter((s: any) => s && s.status === 'connected')
        .map((s: any) => {
          const tools: any[] = Array.isArray(s.tools) ? s.tools : [];
          const enabled = tools.filter(t => t && t.enabled !== false);
          return { id: s.id, name: s.name || s.id, toolCount: enabled.length };
        });
      setMcpConnectedServers(connected);
      setMcpEnabledToolCount(connected.reduce((sum, s) => sum + s.toolCount, 0));
    } catch (err) {
      console.warn('[Chat] MCP info refresh failed:', err);
    }
  }, []);

  useEffect(() => {
    refreshMCPInfo();
  }, [session.id, refreshMCPInfo]);

  // Sprint 25: Attachment state
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentMeta | null>(null);
  const [attachmentError, setAttachmentError] = useState<string>('');
  const dragCounterRef = useRef(0);

  // Sprint 28: Auto-continue state removed — loop is driven by stop_reason

  // Sprint 29: Agent loop event state (nudge banners)
  const [nudgeBanner, setNudgeBanner] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });

  useEffect(() => {
    if (!api?.onAgentLoopEvent) return;
    const unsubscribe = api.onAgentLoopEvent((data: any) => {
      if (data.event === 'no-tools-used-nudge') {
        setNudgeBanner({
          message: `Auto-recovery: prompting Claude to use a tool (mistake ${data.consecutiveMistakes}/${data.maxConsecutiveMistakes})`,
          visible: true,
        });
        // Auto-hide after 6 seconds
        setTimeout(() => setNudgeBanner(prev => ({ ...prev, visible: false })), 6000);
      } else if (data.event === 'max-mistakes-reached') {
        setNudgeBanner({
          message: `Agent loop stopped: ${data.consecutiveMistakes} consecutive text-only responses without tool use.`,
          visible: true,
        });
        setTimeout(() => setNudgeBanner(prev => ({ ...prev, visible: false })), 10000);
      } else if (data.event === 'terminal-tool-used') {
        setNudgeBanner({
          message: `Task completed via ${data.tool} (turn ${data.turn})`,
          visible: true,
        });
        setTimeout(() => setNudgeBanner(prev => ({ ...prev, visible: false })), 4000);
      }
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Sprint 38 Feature 5: Live countdown for retry banner.
  // Re-computes once per second from retryState.nextRetryMs (absolute ms
  // timestamp emitted by main/providers/retryHandler.ts via
  // 'retry:state-update'). We derive seconds-remaining locally so the banner
  // stays readable without main having to emit a tick event.
  useEffect(() => {
    if (!retryState?.isRetrying || !retryState.nextRetryMs) {
      setRetryCountdownSec(null);
      return;
    }
    const compute = () => {
      const ms = (retryState.nextRetryMs || 0) - Date.now();
      setRetryCountdownSec(Math.max(0, Math.ceil(ms / 1000)));
    };
    compute();
    const handle = window.setInterval(compute, 1000);
    return () => window.clearInterval(handle);
  }, [retryState?.isRetrying, retryState?.nextRetryMs]);

  // Load slash commands list
  useEffect(() => {
    // Sprint 38 Feature 4: The three client-side commands below are handled
    // entirely in the renderer (see executeSlashCommand) but are surfaced in
    // the dropdown alongside the backend-registered commands. Injecting them
    // client-side avoids touching the backend slash registry / IPC shape.
    const rendererCommands: SlashCommandInfo[] = [
      { name: 'compact',  description: 'Summarize older messages to reclaim context window', category: 'chat' },
      { name: 'mcp-off',  description: 'Disconnect a connected MCP server',                   category: 'workflow' },
      { name: 'tokens',   description: 'Show the current rate-limit token budget',            category: 'info' },
    ];
    if (api?.listSlashCommands) {
      api.listSlashCommands().then((cmds: SlashCommandInfo[]) => {
        const names = new Set(cmds.map(c => c.name));
        const merged = [...cmds, ...rendererCommands.filter(c => !names.has(c.name))];
        setSlashCommands(merged);
      });
    } else {
      setSlashCommands(rendererCommands);
    }
  }, []);

  // Load chat history from DB on mount
  useEffect(() => {
    if (api && session.id) {
      api.getChatHistory(session.id).then((history: any[]) => {
        if (history && history.length > 0) {
          const dbMessages: Message[] = history.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: sanitizeContent(m.content),
            toolCalls: m.tool_calls?.map((tc: any) => ({
              name: tc.name,
              description: `Called ${tc.name}`,
              status: 'success' as const,
              input: tc.input || undefined,
              result: tc.result || undefined,
            })),
            timestamp: m.timestamp,
          }));
          setMessages(dbMessages);
          // Sprint 38 Bug 3: no setShowSuggestions — it's derived.
        }
      }).catch((err: any) => {
        console.warn('[Chat] Failed to load history:', err);
      });
    }
  }, [session.id]);

  // Listen for streaming chunks
  useEffect(() => {
    if (!api?.onStreamChunk) return;

    const unsubscribe = api.onStreamChunk((data: any) => {
      if (data.sessionId !== session.id) return;

      if (data.type === 'text') {
        // Sprint 15.2: filter out raw tool_use JSON that may leak into text stream
        const content = data.fullContent || '';
        if (content.includes('"type":"tool_use"') && content.startsWith('[{')) {
          console.debug('[Chat] Suppressed raw tool_use JSON from text stream');
          return;
        }
        streamingContentRef.current = content;
        setStreamingContent(content);
      } else if (data.type === 'tool_call' && data.toolCall) {
        // Sprint 32: Every tool call gets a stable toolCallId at creation (Cline ts pattern).
        // task_plan tool calls are lightweight — plan state flows via chat:active-plan-update.
        setStreamingToolCalls(prev => [
          ...prev,
          {
            name: data.toolCall.name,
            description: `Calling ${data.toolCall.name}...`,
            status: 'running' as const,
            input: data.toolCall.input,
            toolCallId: data.toolCall.id || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          },
        ]);
      } else if (data.type === 'tool_result' || data.type === 'tool_error') {
        // Sprint 38 Bug 2: When attempt_completion resolves, promote any
        // streamed text that preceded it into a finalized assistant message
        // BEFORE the terminal-tool flush clears streamingContent. Without
        // this the completion result (or a subsequent `done`/`text` chunk)
        // can overwrite the in-progress streamed message and the user loses
        // the reasoning/explanation Claude emitted before calling
        // attempt_completion. Only runs when there's actual text to flush.
        if (data.toolName === 'attempt_completion') {
          const preflush = streamingContentRef.current;
          if (preflush && preflush.trim()) {
            const preCompletionMsg: Message = {
              id: `msg-precompletion-${Date.now()}`,
              role: 'assistant',
              content: sanitizeContent(preflush),
              timestamp: new Date().toISOString(),
              streaming: false,
            };
            setMessages(prev => [...prev, preCompletionMsg]);
            streamingContentRef.current = '';
            setStreamingContent('');
          }
        }

        // Sprint 15.2: match by toolCallId first, then fallback to last matching name
        setStreamingToolCalls(prev => {
          // Try to match by toolCallId (exact match)
          const idxById = data.toolCallId
            ? prev.findIndex(tc => (tc as any).toolCallId === data.toolCallId)
            : -1;
          // Fallback: find the last tool call with matching name still in 'running' status
          const idxByName = idxById === -1
            ? prev.reduce((found, tc, i) => tc.name === data.toolName && tc.status === 'running' ? i : found, -1)
            : idxById;
          const idx = idxByName >= 0 ? idxByName : prev.findIndex(tc => tc.name === data.toolName);

          if (idx === -1) return prev;
          const updated = [...prev];
          const existing = updated[idx];

          // Sprint 32: task_plan results stream via chat:active-plan-update,
          // NOT via card.result. Update status only — plan data lives in activePlan.
          // This is the Cline pattern: tool_call cards are lightweight status indicators.
          if (existing.name === 'task_plan') {
            updated[idx] = { ...existing, status: data.type === 'tool_error' ? 'error' as const : 'success' as const };
            return updated;
          }

          updated[idx] = {
            ...existing,
            status: data.type === 'tool_error' ? 'error' as const : 'success' as const,
            description: `${data.toolName}: ${(data.result || '').substring(0, 100)}`,
            result: data.result,
          };
          return updated;
        });
      } else if (data.type === 'research-complete' && data.report) {
        // Deep Research result streamed from main process
        const report = data.report;
        const content = [
          `## Research Report: ${report.topic || 'Analysis'}`,
          '',
          report.plan?.length ? `**Research Plan:**\n${report.plan.map((s: string) => `- ${s}`).join('\n')}\n` : '',
          report.findings || '',
          report.recommendation ? `\n**Recommendation:** ${report.recommendation}` : '',
        ].filter(Boolean).join('\n');

        const researchMsg: Message = {
          id: `msg-research-${Date.now()}`,
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, researchMsg]);
        streamingContentRef.current = '';
        setStreamingContent('');
        setIsLoading(false);
      } else if (data.type === 'usage-update') {
        // Sprint 24: Token counter update from main process
        if (data.sessionUsage && onSessionUsageUpdate) {
          onSessionUsageUpdate(data.sessionUsage);
        }
      } else if (data.type === 'done') {
        streamingContentRef.current = '';
        setStreamingContent('');
      } else if (data.type === 'error') {
        streamingContentRef.current = '';
        setStreamingContent('');
        // Show error in chat with a friendly explanation
        if (data.content) {
          const errMsg: Message = {
            id: `msg-err-${Date.now()}`,
            role: 'system',
            content: formatErrorMessage(data.content),
            timestamp: new Date().toISOString(),
          };
          setMessages(prev => [...prev, errMsg]);
        }
      }
    });

    return () => { if (unsubscribe) unsubscribe(); };
  }, [session.id]);

  // Sprint 32: Subscribe to dedicated active-plan-update channel (Cline pattern)
  // Plan state is a top-level entity, not embedded in tool cards.
  useEffect(() => {
    if (!api?.onActivePlanUpdate) return;
    const unsubscribe = api.onActivePlanUpdate((data: any) => {
      if (data.sessionId !== session.id) return;

      // Sprint 37 Fix #1: Honor explicit clear signals from the main process.
      // Fresh Chat / session-cleared sends { plan: null, action: 'clear',
      // reason: 'session-cleared' }. The previous guard below ("never downgrade")
      // dropped these and caused TaskPlanCard to persist after Fresh Chat.
      const isClearSignal =
        data.action === 'clear' ||
        data.reason === 'session-cleared' ||
        data.plan === null;
      if (isClearSignal) {
        setActivePlanState(null);
        activePlanRef.current = null;
        // Dev-console breadcrumb for Probe C verification.
        try {
          // eslint-disable-next-line no-console
          console.log('chat:active-plan-update', { plan: null, reason: data.reason || 'session-cleared' });
        } catch { /* noop */ }
        return;
      }

      if (!data.plan?.tasks?.length) return; // Never downgrade — ignore empty plans
      setActivePlanState(data.plan);
      activePlanRef.current = data.plan;
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [session.id]);

  // Handle slash command input detection
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Sprint 38 Bug 1: ignore DOM change events while a send is in flight so
    // a programmatic setInput('') cannot race with the user typing the next
    // prompt and clobber their characters.
    if (isComposerLockedRef.current) return;

    const val = e.target.value;
    setInput(val);

    // Show dropdown when input starts with '/' and is on first line
    const firstLine = val.split('\n')[0];
    if (firstLine.startsWith('/') && !firstLine.includes(' ')) {
      setShowSlashDropdown(true);
    } else {
      setShowSlashDropdown(false);
    }
  }, []);

  const handleSlashSelect = useCallback((cmdName: string) => {
    setInput(`/${cmdName} `);
    setShowSlashDropdown(false);
    inputRef.current?.focus();
  }, []);

  const dismissSlash = useCallback(() => {
    setShowSlashDropdown(false);
  }, []);

  // Execute a slash command
  const executeSlashCommand = useCallback(async (commandText: string) => {
    const parts = commandText.trim().split(/\s+/);
    const cmdName = parts[0].substring(1); // remove '/'
    const args = parts.slice(1).join(' ');

    // Add command message to chat
    const cmdMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'command',
      content: commandText,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, cmdMsg]);

    // ─── Sprint 38 Feature 4: Renderer-side slash commands ───
    // These three are handled entirely in the renderer — no backend IPC
    // registration required. Each produces a 'system' role message for the
    // transcript so the user sees a definite result.
    if (cmdName === 'tokens') {
      const msg: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'system',
        content: formatTokenBudgetMessage(rateLimitSnapshot, softInputLimit, softOutputLimit, softRequestLimit),
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, msg]);
      return;
    }

    if (cmdName === 'compact') {
      try {
        if (api?.compactHistory) await api.compactHistory(session.id);
        const msg: Message = {
          id: `msg-${Date.now() + 1}`,
          role: 'system',
          content: 'Conversation compacted — older messages summarized to reclaim context window.',
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, msg]);
      } catch (err) {
        const errMsg: Message = {
          id: `msg-${Date.now() + 1}`,
          role: 'system',
          content: formatErrorMessage(err instanceof Error ? err.message : 'Compact failed'),
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errMsg]);
      }
      return;
    }

    if (cmdName === 'mcp-off') {
      await refreshMCPInfo();
      // Reveal the picker; the click handler (see JSX below) calls
      // api.disconnectMCPServer(id) and posts a confirmation message.
      setMcpPickerVisible(true);
      return;
    }

    if (!api?.executeSlashCommand) {
      const errMsg: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'system',
        content: 'Slash commands are not available in web preview mode. Run the full Electron app to use commands.',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
      return;
    }

    try {
      const result = await api.executeSlashCommand(cmdName, args, session.id);

      // Handle clear command
      // Sprint 38 Bug 3: no setShowSuggestions — suggestions re-derive
      // from the now-empty messages[] + empty input + no attachments.
      if (result.data?.action === 'clear') {
        setMessages([]);
        return;
      }

      // Handle mode change
      if (result.data?.mode) {
        onModeChange(result.data.mode);
      }

      const responseMsg: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'system',
        content: result.message,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, responseMsg]);

      // If research was started, show loading indicator for streamed results
      if (result.data?.action === 'research-started' || result.data?.action === 'comparison-started') {
        setIsLoading(true);
        setStreamingContent('');
        setStreamingToolCalls([{ name: 'Deep Research', description: 'Analyzing...', status: 'running' }]);
      }
    } catch (err) {
      const errMsg: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'system',
        content: formatErrorMessage(err instanceof Error ? err.message : String(err)),
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    }
  }, [session.id, onModeChange, rateLimitSnapshot, softInputLimit, softOutputLimit, softRequestLimit, refreshMCPInfo]);

  // Sprint 25: Process file for attachment
  const processFile = useCallback(async (file: File, source: AttachmentMeta['source'] = 'drag-drop') => {
    if (!api?.processAttachment) return;

    const config = attachmentConfig;
    const maxFiles = config?.maxFilesPerMessage || 10;
    const maxTotalMB = config?.maxTotalSizeMB || 50;

    if (attachments.length >= maxFiles) {
      setAttachmentError(`Maximum ${maxFiles} files per message`);
      setTimeout(() => setAttachmentError(''), 3000);
      return;
    }

    // Check total size
    const currentTotalBytes = attachments.reduce((s, a) => s + a.size, 0);
    if ((currentTotalBytes + file.size) / (1024 * 1024) > maxTotalMB) {
      setAttachmentError(`Total size exceeds ${maxTotalMB} MB limit`);
      setTimeout(() => setAttachmentError(''), 3000);
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Array.from(new Uint8Array(arrayBuffer));
      const result = await api.processAttachment({
        buffer,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        conversationId: session.id,
        source,
      });

      if (result.success && result.attachment) {
        setAttachments(prev => [...prev, result.attachment]);
        setAttachmentError('');
      } else {
        setAttachmentError(result.error || 'Failed to process file');
        setTimeout(() => setAttachmentError(''), 3000);
      }
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Failed to process file');
      setTimeout(() => setAttachmentError(''), 3000);
    }
  }, [attachments, attachmentConfig, session.id]);

  // Sprint 25: Drag-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files.slice(0, 10)) {
      await processFile(file, 'drag-drop');
    }
  }, [processFile]);

  // Sprint 25: Clipboard paste handler
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    if (!api?.processClipboardImage) return;

    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith('image/'));

    if (imageItem) {
      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;

      // Convert blob to base64 for IPC
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      try {
        const result = await api.processClipboardImage({
          pngBase64: base64,
          conversationId: session.id,
        });

        if (result.success && result.attachment) {
          setAttachments(prev => [...prev, result.attachment]);
        } else {
          setAttachmentError(result.error || 'Failed to process clipboard image');
          setTimeout(() => setAttachmentError(''), 3000);
        }
      } catch (err) {
        setAttachmentError(err instanceof Error ? err.message : 'Clipboard paste failed');
        setTimeout(() => setAttachmentError(''), 3000);
      }
    }
    // Text paste: let default behavior handle it
  }, [session.id]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const trimmed = input.trim();

    // Check if it's a slash command (only text, no attachments)
    // Sprint 38 Bug 1: lock → push command message → clear input, in that
    // order, so the command is visible in the transcript before the composer
    // empties, and typing during execution cannot be clobbered.
    if (trimmed.startsWith('/') && attachments.length === 0) {
      isComposerLockedRef.current = true;
      setShowSlashDropdown(false);
      try {
        await executeSlashCommand(trimmed);
        setInput('');
      } finally {
        isComposerLockedRef.current = false;
      }
      return;
    }

    // Sprint 25: Build message with attachments
    const hasAttachments = attachments.length > 0;
    const attachmentSummary = hasAttachments
      ? `\n[${attachments.length} file${attachments.length !== 1 ? 's' : ''} attached: ${attachments.map(a => a.originalName).join(', ')}]`
      : '';

    // Sprint 25: Check vision warning
    const hasImages = attachments.some(a => a.type === 'image');
    if (hasImages && visionSupported === false) {
      setAttachmentError('Current model does not support vision. Images will be sent as metadata only.');
      setTimeout(() => setAttachmentError(''), 5000);
    }

    const displayContent = trimmed + attachmentSummary;
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: displayContent,
      timestamp: new Date().toISOString(),
    };

    // Sprint 38 Bug 1: lock composer BEFORE any clears, commit userMsg to the
    // transcript FIRST, then clear input. This guarantees the user sees their
    // message on screen before the composer empties and prevents handleInputChange
    // from racing setInput('') with a fresh keystroke.
    isComposerLockedRef.current = true;
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const sentAttachments = [...attachments];
    setAttachments([]);
    setIsLoading(true);
    streamingContentRef.current = '';
    setStreamingContent('');
    setStreamingToolCalls([]);

    try {
      if (api) {
        // Sprint 25: Build content with attachments for the API
        let messageContent = trimmed;
        if (sentAttachments.length > 0) {
          // Append document text for non-image attachments
          const docTexts = sentAttachments
            .filter(a => a.type !== 'image' && a.extractedText)
            .map(a => `\n\n--- Attached file: ${a.originalName} (${(a.size / 1024).toFixed(1)} KB) ---\n${a.extractedText}\n--- End of ${a.originalName} ---`);
          messageContent = trimmed + docTexts.join('');

          // Add image descriptions for context
          const imageDescs = sentAttachments
            .filter(a => a.type === 'image')
            .map(a => `[Image: ${a.originalName}${a.width && a.height ? ` ${a.width}x${a.height}` : ''}, ~${a.visionTokenEstimate || 'unknown'} tokens]`);
          if (imageDescs.length > 0) {
            messageContent = `${trimmed}\n\n${imageDescs.join('\n')}`;
          }
        }

        const result = await api.sendMessage(session.id, messageContent);

        const assistantMsg: Message = {
          id: result.id || `msg-${Date.now() + 1}`,
          role: 'assistant',
          content: sanitizeContent(result.content),
          toolCalls: result.toolCalls?.map((tc: any) => ({
            name: tc.name,
            description: `Called ${tc.name}`,
            status: 'success' as const,
            input: tc.input || undefined,
            result: tc.result || undefined,
          })),
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else {
        const assistantMsg: Message = {
          id: `msg-${Date.now() + 1}`,
          role: 'assistant',
          content: 'Running in web preview mode. Connect the Electron app to use real AI responses.',
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
    } catch (err) {
      const errMsg: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: formatErrorMessage(err instanceof Error ? err.message : 'Failed to send message'),
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      // Sprint 38 Bug 1: release the lock only after the API call has fully
      // settled (success OR error). This guarantees the composer cannot be
      // typed into during send and remains in a consistent state afterwards.
      setIsLoading(false);
      streamingContentRef.current = '';
      setStreamingContent('');
      setStreamingToolCalls([]);
      isComposerLockedRef.current = false;
    }

    // Sprint 28: No auto-continue scheduler. Loop termination is driven by stop_reason.
  };

  const handleFollowupAction = useCallback((prompt: string) => {
    if (prompt.startsWith('/')) {
      setInput(prompt);
      // Auto-send slash commands
      setTimeout(() => {
        setInput('');
        executeSlashCommand(prompt);
      }, 0);
    } else {
      setInput(prompt);
      inputRef.current?.focus();
    }
  }, [executeSlashCommand]);

  const handleSuggestionSelect = useCallback((prompt: string) => {
    // Sprint 38 Bug 3: setting input to `prompt` (non-empty) is itself what
    // dismisses the suggestion panel via the derived showSuggestions. No
    // explicit setShowSuggestions needed.
    setInput(prompt);
    inputRef.current?.focus();
  }, []);

  // Check if there are user-visible messages (not just system)
  const hasUserMessages = messages.some(m => m.role === 'user' || m.role === 'assistant');

  // Sprint 38 Bug 3: Single source of truth for the suggestion cards. Show
  // only when the transcript AND composer AND attachment tray are all empty.
  // This naturally hides the panel the moment the user starts typing or
  // stages a file, and re-shows it after /clear or Fresh Chat clears the
  // transcript (provided the composer is also empty).
  const showSuggestions =
    messages.length === 0 && input.trim() === '' && attachments.length === 0;

  // ─── Sprint 38 Feature 1: Live composer token estimate ───
  // Total estimated tokens for the NEXT outgoing request:
  //   estimateTokens(input) + Σ estimateTokens(message) + systemPromptTokens
  // systemPromptTokens is approximated as a fixed baseline plus 250 tokens
  // per connected+enabled MCP tool — the dominant variable on real installs.
  const MCP_TOKENS_PER_TOOL = 250;
  const BASE_SYSTEM_PROMPT_TOKENS = 3000; // Conservative GDeveloper baseline
  const mcpToolTokenOverhead = mcpEnabledToolCount * MCP_TOKENS_PER_TOOL;
  const systemPromptTokens = BASE_SYSTEM_PROMPT_TOKENS + mcpToolTokenOverhead;
  const conversationHistoryTokens = messages.reduce(
    (s, m) => s + estimateTokens(m.content),
    0,
  );
  const inputTokens = estimateTokens(input);
  const composerTokenEstimate = inputTokens + conversationHistoryTokens + systemPromptTokens;
  const composerTokenPct = softInputLimit && softInputLimit > 0
    ? composerTokenEstimate / softInputLimit
    : 0;
  // Color traffic light: green < 60%, amber 60-85%, red > 85%
  const composerTokenColor =
    composerTokenPct > 0.85 ? 'text-red-400'
    : composerTokenPct > 0.6 ? 'text-yellow-400'
    : 'text-matrix-green/60';

  // ─── Sprint 38 Feature 2: Rate-limit gating for the Send button ───
  const isRateLimited = !!(rateLimitSnapshot?.isPaused || rateLimitSnapshot?.severity === 'red');
  const rateLimitReason = rateLimitSnapshot?.isPaused
    ? 'Rate limited — please wait'
    : rateLimitSnapshot?.severity === 'red'
      ? 'Approaching rate limit — slow down'
      : '';

  // ─── Sprint 38 Feature 3: MCP banner visibility ───
  const MCP_TOOL_BANNER_THRESHOLD = 20;
  const mcpBannerVisible =
    !mcpBannerDismissed && mcpEnabledToolCount > MCP_TOOL_BANNER_THRESHOLD;

  return (
    <div
      className="h-full flex flex-col relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Sprint 25: Drop zone overlay */}
      <DropZoneOverlay active={isDragOver} />

      {/* Sprint 25: Attachment preview modal */}
      <AttachmentPreviewModal
        attachment={previewAttachment}
        attachments={attachments}
        onClose={() => setPreviewAttachment(null)}
        onRemove={(id) => { removeAttachment(id); if (attachments.length <= 1) setPreviewAttachment(null); }}
      />
      {/* Header — Sprint 18: polished context display */}
      <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between glass-panel-solid rounded-none border-x-0 border-t-0">
        <div className="flex items-center gap-3">
          {/* Repo name + branch */}
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-matrix-green animate-pulseDot" />
            <span className="text-sm text-matrix-green font-bold">{repo.fullName}</span>
          </div>
          <span className="text-[10px] text-matrix-text-muted/30">|</span>
          <span className="text-[10px] text-matrix-text-dim font-mono">{session.workingBranch}</span>

          {/* Sprint 17+18: Worktree context with clearer labels */}
          {worktreeContext && (
            <>
              <span className="text-[10px] text-matrix-text-muted/30">|</span>
              {worktreeContext.isMain ? (
                <span className="text-[10px] font-mono text-matrix-green/60 flex items-center gap-1" title="This is the main worktree (your primary checkout)">
                  <span className="w-1.5 h-1.5 rounded-full bg-matrix-green/40" />
                  Main
                </span>
              ) : (
                <span className="text-[10px] font-mono text-blue-400/60 flex items-center gap-1" title={`Linked worktree${worktreeContext.branch ? ` on branch ${worktreeContext.branch}` : ' (detached HEAD)'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400/40" />
                  Linked{worktreeContext.branch ? `: ${worktreeContext.branch}` : ''}
                  {!worktreeContext.branch && <span className="text-yellow-400/50 ml-1">detached {worktreeContext.head?.substring(0, 7)}</span>}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Sprint 24: Token Counter */}
          <TokenCounter
            sessionUsage={sessionUsage}
            rateLimitSnapshot={rateLimitSnapshot}
            maxContextTokens={80000}
          />

          {/* Sprint 21: Rate Limit Indicator */}
          <RateLimitIndicator
            snapshot={rateLimitSnapshot}
            retryState={retryState}
            softInputLimit={softInputLimit}
            softOutputLimit={softOutputLimit}
            softRequestLimit={softRequestLimit}
            onPauseResume={() => api?.pauseResumeRateLimit?.()}
            onReset={() => api?.resetRateLimit?.()}
          />

          {/* Sprint 28: AutoContinueToggle removed — agent loop uses stop_reason */}

          {/* Mode indicator — Sprint 18: clearer labels */}
          <button
            onClick={() => onModeChange(executionMode === 'plan' ? 'build' : 'plan')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold border cursor-pointer transition-all duration-150 ${
              executionMode === 'plan'
                ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/5 hover:bg-yellow-500/10'
                : 'border-matrix-green/30 text-matrix-green bg-matrix-green/5 hover:bg-matrix-green/10'
            }`}
            title={executionMode === 'plan'
              ? 'Plan Mode: read-only research. Click to switch to Build mode.'
              : 'Build Mode: full read/write access. Click to switch to Plan mode.'}
          >
            <span>{executionMode === 'plan' ? '\uD83D\uDD0D' : '\uD83D\uDD28'}</span>
            <span>{executionMode === 'plan' ? 'PLAN' : 'BUILD'}</span>
          </button>

          {/* Sprint 23: Model chip in header (read-only badge — full picker is in composer) */}
          {selectedModel && (
            <span className="text-[9px] text-matrix-text-muted/30 font-mono max-w-[120px] truncate" title={`Active model: ${selectedModel}`}>
              {modelMetaList?.find(m => m.id === selectedModel)?.name || selectedModel}
            </span>
          )}

          {/* Status badge */}
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
            isLoading
              ? 'border-yellow-500/20 text-yellow-400/70 bg-yellow-500/5'
              : 'border-matrix-green/20 text-matrix-green/60 bg-matrix-green/5'
          }`}>
            {isLoading ? 'Working...' : 'Ready'}
          </span>
        </div>
      </div>

      {/* Sprint 29: Nudge/instrumentation banner */}
      {nudgeBanner.visible && (
        <div className="px-4 py-2 bg-matrix-warning/10 border-b border-matrix-warning/20 flex items-center gap-2 text-[11px] text-matrix-warning animate-fadeIn">
          <span className="text-sm">&#x1F504;</span>
          <span>{nudgeBanner.message}</span>
          <button
            onClick={() => setNudgeBanner(prev => ({ ...prev, visible: false }))}
            className="ml-auto text-matrix-warning/50 hover:text-matrix-warning"
          >
            &times;
          </button>
        </div>
      )}

      {/* Sprint 38 Feature 5: Retry countdown banner — driven by retryState
          which the main process pushes via 'retry:state-update' (already wired
          by App.tsx onto the retryState prop). Auto-disappears silently when
          isRetrying flips false (success); explicit message when gaveUp. */}
      {retryState?.gaveUp ? (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2 text-[11px] text-red-300 animate-fadeIn">
          <span>&#x274C;</span>
          <span>Rate limit: gave up after {retryState.maxAttempts} attempts.</span>
        </div>
      ) : retryState?.isRetrying ? (
        <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20 flex items-center gap-2 text-[11px] text-yellow-300 animate-fadeIn">
          <span>&#x23F3;</span>
          <span>
            Rate limited — retrying in {retryCountdownSec ?? '?'}s&hellip; (attempt {retryState.attempt} of {retryState.maxAttempts})
          </span>
          {retryState.reason && (
            <span className="ml-2 text-yellow-200/50 font-mono text-[10px]">{retryState.reason}</span>
          )}
        </div>
      ) : null}

      {/* Messages or Suggestions */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {showSuggestions ? (
          <SuggestionCards onSelect={handleSuggestionSelect} />
        ) : (
          <>
            {messages.map((msg, idx) => (
              <div key={msg.id} className={`animate-fadeIn ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
                <div className={`max-w-[85%] ${
                  msg.role === 'user'
                    ? 'glass-panel p-3 border-matrix-green/30'
                    : msg.role === 'system'
                      ? 'glass-panel p-3 border-matrix-info/20 bg-matrix-info/5'
                      : msg.role === 'command'
                        ? 'glass-panel p-2 border-matrix-green/10 bg-matrix-green/5'
                        : 'glass-panel p-4'
                }`}>
                  {/* Sprint 18: clearer role labels */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[10px] uppercase tracking-wider font-bold ${
                      msg.role === 'user' ? 'text-matrix-green'
                        : msg.role === 'system' ? 'text-matrix-info'
                          : msg.role === 'command' ? 'text-matrix-green/60'
                            : 'text-matrix-text-dim'
                    }`}>
                      {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : msg.role === 'command' ? 'Command' : 'GDeveloper'}
                    </span>
                    <span className="text-[9px] text-matrix-text-muted/20">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="text-xs text-matrix-text-dim whitespace-pre-wrap leading-relaxed">
                    {renderContent(msg.content)}
                  </div>

                  {/* Sprint 18: improved tool call display */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-matrix-border/30 space-y-1.5">
                      <p className="text-[9px] text-matrix-text-muted/50 mb-1.5 flex items-center gap-1.5">
                        <span className="inline-block w-1 h-1 rounded-full bg-matrix-green/30" />
                        <span className="uppercase tracking-wider">{msg.toolCalls.length} tool call{msg.toolCalls.length !== 1 ? 's' : ''}</span>
                      </p>
                      {msg.toolCalls.map((tc, i) => (
                        <ToolCallCard
                          key={(tc as any).toolCallId || `${msg.id}-tc-${i}`}
                          name={tc.name}
                          input={tc.input}
                          result={tc.result}
                          status={tc.status}
                          onOpenCompareWorkspace={onOpenCompareWorkspace}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Follow-up buttons after assistant messages */}
                {msg.role === 'assistant' && idx === messages.length - 1 && !isLoading && (
                  <FollowupButtons
                    content={msg.content}
                    hasToolCalls={!!(msg.toolCalls && msg.toolCalls.length > 0)}
                    toolNames={msg.toolCalls?.map(tc => tc.name) || []}
                    onAction={handleFollowupAction}
                  />
                )}
              </div>
            ))}
          </>
        )}

        {/* Sprint 32: Sticky TaskPlanCard — top-level, outside tool call loop.
            Plan state lives in activePlan, not in any tool card's result.
            This is Cline's currentFocusChainChecklist pattern. */}
        {activePlan && activePlan.tasks && activePlan.tasks.length > 0 && (
          <TaskPlanCard plan={activePlan} />
        )}

        {/* Streaming indicator — Sprint 18: clearer progress display */}
        {isLoading && (
          <div className="animate-fadeIn">
            <div className="glass-panel p-4 max-w-[85%]">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-matrix-text-dim">GDeveloper</span>
                <span className="w-3 h-3 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin" />
              </div>

              {streamingToolCalls.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {streamingToolCalls.map((tc) => (
                    <ToolCallCard
                      key={(tc as any).toolCallId || `tc-${tc.name}-${tc.description}`}
                      name={tc.name}
                      input={tc.input}
                      result={tc.result}
                      status={tc.status}
                      onOpenCompareWorkspace={onOpenCompareWorkspace}
                    />
                  ))}
                </div>
              )}

              {streamingContent ? (
                <div className="text-xs text-matrix-text-dim whitespace-pre-wrap leading-relaxed">
                  {renderContent(streamingContent)}
                  <span className="inline-block w-1.5 h-4 bg-matrix-green/70 ml-0.5 animate-blink" />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-matrix-green/60">Thinking...</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Input — Sprint 18/23/25: friendlier placeholder, inline model picker, attachments */}
      <div className="p-4 border-t border-matrix-border">
        {/* Sprint 38 Feature 3: MCP high-tool-count warning banner.
            Each tool schema costs ~250 tokens on every request, so a large
            MCP footprint is the #1 cause of org-level 429s. Dismissable. */}
        {mcpBannerVisible && (
          <div className="mb-2 px-3 py-2 rounded border border-yellow-500/30 bg-yellow-500/5 flex items-start gap-2 text-[11px] text-yellow-300 animate-fadeIn">
            <span>&#x26A0;</span>
            <span className="flex-1">
              <strong>{mcpEnabledToolCount} MCP tools connected</strong> &mdash; each request uses
              &nbsp;~{Math.round(mcpToolTokenOverhead / 1000)}k tokens in tool definitions.
              Consider disconnecting unused MCP servers to avoid rate-limit errors.
            </span>
            {onOpenMCPSettings && (
              <button
                onClick={onOpenMCPSettings}
                className="text-[10px] px-2 py-0.5 rounded border border-yellow-500/40 text-yellow-200 hover:bg-yellow-500/10 whitespace-nowrap"
              >
                Manage MCP
              </button>
            )}
            <button
              onClick={() => setMcpBannerDismissed(true)}
              className="text-yellow-300/50 hover:text-yellow-200"
              title="Dismiss"
            >
              &times;
            </button>
          </div>
        )}

        {/* Sprint 38 Feature 4: /mcp-off sub-picker. Inline list of connected
            MCP servers; click one to disconnect. Confirmation is posted as a
            system message in the main transcript. */}
        {mcpPickerVisible && (
          <div className="mb-2 px-3 py-2 rounded border border-matrix-green/30 bg-matrix-green/5 text-[11px] animate-fadeIn">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-matrix-green font-bold">Disconnect an MCP server</span>
              <button
                onClick={() => setMcpPickerVisible(false)}
                className="ml-auto text-matrix-text-muted/50 hover:text-matrix-text-dim"
              >
                &times;
              </button>
            </div>
            {mcpConnectedServers.length === 0 ? (
              <div className="text-matrix-text-muted/50">No connected MCP servers.</div>
            ) : (
              <div className="space-y-1">
                {mcpConnectedServers.map(srv => (
                  <button
                    key={srv.id}
                    onClick={async () => {
                      try {
                        if (api?.disconnectMCPServer) await api.disconnectMCPServer(srv.id);
                        const msg: Message = {
                          id: `msg-mcpoff-${Date.now()}`,
                          role: 'system',
                          content: `MCP server '${srv.name}' disconnected.`,
                          timestamp: new Date().toISOString(),
                        };
                        setMessages(prev => [...prev, msg]);
                        setMcpPickerVisible(false);
                        refreshMCPInfo();
                      } catch (err) {
                        const errMsg: Message = {
                          id: `msg-mcpoff-err-${Date.now()}`,
                          role: 'system',
                          content: formatErrorMessage(err instanceof Error ? err.message : 'Failed to disconnect MCP server'),
                          timestamp: new Date().toISOString(),
                        };
                        setMessages(prev => [...prev, errMsg]);
                        setMcpPickerVisible(false);
                      }
                    }}
                    className="w-full text-left px-2 py-1 rounded border border-matrix-border/30 hover:border-matrix-green/40 hover:bg-matrix-green/5 flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-matrix-green/50" />
                    <span className="font-mono text-matrix-text-dim">{srv.name}</span>
                    <span className="ml-auto text-[9px] text-matrix-text-muted/40">{srv.toolCount} tools</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sprint 25: Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {attachments.map(att => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                onRemove={removeAttachment}
                onPreview={setPreviewAttachment}
              />
            ))}
          </div>
        )}

        {/* Sprint 25: Attachment error */}
        {attachmentError && (
          <div className="text-[10px] text-red-400/80 mb-1.5 flex items-center gap-1">
            <span>!</span> {attachmentError}
          </div>
        )}

        {/* Sprint 25: Vision warning */}
        {attachments.some(a => a.type === 'image') && visionSupported === false && (
          <div className="text-[9px] text-yellow-400/60 mb-1.5">
            Current model may not support vision. Images will be described as text metadata.
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            {/* Slash Command Dropdown */}
            <SlashCommandDropdown
              commands={slashCommands}
              filter={input}
              onSelect={handleSlashSelect}
              onDismiss={dismissSlash}
              visible={showSlashDropdown}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onPaste={handlePaste}
              onKeyDown={e => {
                // Don't handle Enter/ArrowUp/Down/Tab when dropdown is visible
                if (showSlashDropdown && ['Enter', 'ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(e.key)) {
                  return; // handled by dropdown
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={executionMode === 'plan'
                ? 'Ask a question about the codebase... (Plan mode: read-only)'
                : attachments.length > 0
                  ? 'Add a message about these files, or just hit Send...'
                  : 'Describe what you want to build, fix, or explore...'}
              className="matrix-input resize-none h-10 pr-10"
              rows={1}
              disabled={isLoading}
            />
          </div>
          {/* Sprint 23: Inline model picker next to send button */}
          {onModelChange && (
            <ModelPickerInline
              selectedModel={selectedModel || ''}
              availableModels={modelMetaList || []}
              defaultModel={defaultModel || 'claude-3-5-sonnet-20241022'}
              apiKeyConfigured={apiKeyConfigured !== false}
              onModelChange={onModelChange}
              onSetDefault={onSetDefaultModel || (() => {})}
              onRefreshModels={onRefreshModels}
              isRefreshingModels={isRefreshingModels}
            />
          )}
          <button
            onClick={handleSend}
            disabled={
              (!input.trim() && attachments.length === 0) ||
              isLoading ||
              isRateLimited /* Sprint 38 Feature 2 */
            }
            className="matrix-btn matrix-btn-primary px-4"
            title={
              /* Sprint 38 Feature 2: surface the rate-limit reason on hover
                 when the button is disabled for that reason. */
              isRateLimited && rateLimitReason
                ? rateLimitReason
                : 'Send message (Enter)'
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
        {/* Sprint 21: Conversation hygiene helpers */}
        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-matrix-text-muted/25">
              <kbd className="px-1 py-0.5 rounded bg-matrix-bg-hover text-matrix-text-muted/30 font-mono text-[8px]">Shift+Enter</kbd> new line &middot;
              <kbd className="px-1 py-0.5 rounded bg-matrix-bg-hover text-matrix-green/30 font-mono text-[8px] ml-1">/</kbd> commands &middot;
              <kbd className="px-1 py-0.5 rounded bg-matrix-bg-hover text-matrix-text-muted/30 font-mono text-[8px] ml-1">Ctrl+V</kbd> paste image &middot;
              <kbd className="px-1 py-0.5 rounded bg-matrix-bg-hover text-matrix-text-muted/30 font-mono text-[8px] ml-1">Ctrl+`</kbd> terminal
            </span>
            {hasUserMessages && (
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => { setMessages([]); if (api?.clearChat) api.clearChat(session.id); }}
                  className="text-[9px] px-1.5 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/40 hover:text-matrix-text-dim hover:border-matrix-accent/30 transition-colors"
                  title="Clear chat and start fresh"
                >
                  Fresh Chat
                </button>
                <button
                  onClick={() => { if (api?.summarizeContext) api.summarizeContext(session.id); }}
                  className="text-[9px] px-1.5 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/40 hover:text-matrix-text-dim hover:border-matrix-accent/30 transition-colors"
                  title="Summarize conversation to save tokens"
                >
                  Summarize
                </button>
                <button
                  onClick={() => { if (api?.compactHistory) api.compactHistory(session.id); }}
                  className="text-[9px] px-1.5 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/40 hover:text-matrix-text-dim hover:border-matrix-accent/30 transition-colors"
                  title="Compact older messages to reduce context size"
                >
                  Compact
                </button>
                <span className="text-[9px] text-matrix-text-muted/20 ml-1" title="Approximate token count for this conversation">
                  ~{Math.round(messages.reduce((s, m) => s + (m.content?.length || 0) / 4, 0)).toLocaleString()} tokens
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Sprint 38 Feature 1: Live composer-side token estimate that
                INCLUDES MCP tool-schema overhead. Color tracks the minute
                rate budget so the user sees red well before the first 429. */}
            <span
              className={`text-[9px] font-mono ${composerTokenColor}`}
              title={
                `Estimated next-request tokens: input ${inputTokens.toLocaleString()} + ` +
                `history ${conversationHistoryTokens.toLocaleString()} + ` +
                `system+MCP ${systemPromptTokens.toLocaleString()} ` +
                `(${mcpEnabledToolCount} MCP tools × ~${MCP_TOKENS_PER_TOOL})` +
                (softInputLimit ? ` — ${Math.round(composerTokenPct * 100)}% of soft input limit` : '')
              }
            >
              ~{composerTokenEstimate.toLocaleString()} tokens
            </span>
            <span className="text-[9px] text-matrix-text-muted/20">
              {providerKey ? `${selectedModel || providerKey}` : 'No provider configured'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Sprint 15.2: Strip accidental raw tool_use JSON blocks from assistant content.
 * The Anthropic API may return [{"type":"tool_use",...}] as stringified assistant content.
 */
function sanitizeContent(content: string): string {
  if (!content) return '';
  // Strip raw JSON arrays of tool_use blocks
  const stripped = content.replace(/\[\s*\{\s*"type"\s*:\s*"tool_use"[\s\S]*?\}\s*\]/g, '').trim();
  // Strip individual tool_use JSON objects
  const cleaned = stripped.replace(/\{\s*"type"\s*:\s*"tool_use"[\s\S]*?"input"\s*:\s*\{[\s\S]*?\}\s*\}/g, '').trim();
  if (cleaned.length === 0 && content.length > 0) {
    console.debug('[Chat] Entire message was tool_use JSON — suppressed from display');
    return '';
  }
  return cleaned;
}

/**
 * Sprint 38 Features 1 / 4: Token estimation using the same chars/4 formula
 * as src/main/providers/contextManager.ts, so renderer-side estimates line up
 * with what main/providers/rateLimiter charges against the budget.
 */
function estimateTokens(str: string | null | undefined): number {
  if (!str) return 0;
  return Math.ceil(str.length / 4);
}

/**
 * Sprint 38 Feature 4 (/tokens): Pretty-print the current RateLimitSnapshot
 * against the configured soft limits. Returns a multi-line string that the
 * renderer pushes as a 'system' role message.
 */
function formatTokenBudgetMessage(
  snap: RateLimitSnapshot | null | undefined,
  inputLimit?: number,
  outputLimit?: number,
  requestLimit?: number,
): string {
  if (!snap) {
    return '**Token Budget**\n\nNo rate-limit snapshot available yet — try again after the first request.';
  }
  const inLim = inputLimit || 400_000;
  const outLim = outputLimit || 14_000;
  const reqLim = requestLimit || 50;
  const pct = (used: number, limit: number) => (limit > 0 ? Math.round((used / limit) * 100) : 0);
  return (
    `**Token Budget (last 60s)**\n\n` +
    `* Input: ${snap.inputTokensLast60s.toLocaleString()} / ${inLim.toLocaleString()} (${pct(snap.inputTokensLast60s, inLim)}%)\n` +
    `* Output: ${snap.outputTokensLast60s.toLocaleString()} / ${outLim.toLocaleString()} (${pct(snap.outputTokensLast60s, outLim)}%)\n` +
    `* Requests: ${snap.requestsLast60s} / ${reqLim} (${pct(snap.requestsLast60s, reqLim)}%)\n` +
    `* Severity: \`${snap.severity}\`${snap.isPaused ? ' — paused' : ''}${snap.isThrottled ? ' — throttled' : ''}`
  );
}

/**
 * Sprint 18: Format error messages with friendly explanations.
 */
function formatErrorMessage(raw: string): string {
  const lower = raw.toLowerCase();

  if (lower.includes('api key') || lower.includes('authentication') || lower.includes('unauthorized')) {
    return `**Authentication Error**\n\n${raw}\n\n**What to do:** Go to Settings and check your API key. Make sure it's valid and has sufficient credits.`;
  }
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
    return `**Rate Limited**\n\n${raw}\n\n**What to do:** Wait a moment and try again. If this persists, check your API plan limits at console.anthropic.com.`;
  }
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('fetch failed') || lower.includes('timeout')) {
    return `**Connection Error**\n\n${raw}\n\n**What to do:** Check your internet connection. The AI API requires network access.`;
  }
  if (lower.includes('overloaded') || lower.includes('503') || lower.includes('capacity')) {
    return `**Service Busy**\n\n${raw}\n\n**What to do:** The AI service is temporarily at capacity. Wait a few seconds and try again.`;
  }
  if (lower.includes('context length') || lower.includes('token') || lower.includes('too long')) {
    return `**Message Too Long**\n\n${raw}\n\n**What to do:** Try a shorter prompt, or use \`/clear\` to start a fresh conversation.`;
  }

  return raw;
}

function renderContent(content: string): React.ReactNode {
  const parts = content.split(/(```[\s\S]*?```|\*\*.*?\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const code = part.slice(3, -3).replace(/^[a-z]+\n/, '');
      return <div key={i} className="code-block my-2">{code}</div>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-matrix-green">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="px-1 py-0.5 bg-matrix-bg-hover rounded text-matrix-green text-[10px]">{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}
