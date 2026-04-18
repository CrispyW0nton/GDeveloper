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

export default function ChatWorkspace({ session, repo, providerKey, executionMode, onModeChange, selectedModel, availableModels, onModelChange, worktreeContext, rateLimitSnapshot, retryState, softInputLimit, softOutputLimit, softRequestLimit, modelMetaList, defaultModel, onSetDefaultModel, apiKeyConfigured, sessionUsage, onSessionUsageUpdate, attachmentConfig, visionSupported, onRefreshModels, isRefreshingModels, onOpenCompareWorkspace }: ChatWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallDisplay[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
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

  // Load slash commands list
  useEffect(() => {
    if (api?.listSlashCommands) {
      api.listSlashCommands().then((cmds: SlashCommandInfo[]) => setSlashCommands(cmds));
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
          setShowSuggestions(false);
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
        setStreamingContent('');
        setIsLoading(false);
      } else if (data.type === 'usage-update') {
        // Sprint 24: Token counter update from main process
        if (data.sessionUsage && onSessionUsageUpdate) {
          onSessionUsageUpdate(data.sessionUsage);
        }
      } else if (data.type === 'done') {
        setStreamingContent('');
      } else if (data.type === 'error') {
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
    setShowSuggestions(false);

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
      if (result.data?.action === 'clear') {
        setMessages([]);
        setShowSuggestions(true);
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
  }, [session.id, onModeChange]);

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
    if (trimmed.startsWith('/') && attachments.length === 0) {
      setInput('');
      setShowSlashDropdown(false);
      await executeSlashCommand(trimmed);
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
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const sentAttachments = [...attachments];
    setAttachments([]);
    setIsLoading(true);
    setStreamingContent('');
    setStreamingToolCalls([]);
    setShowSuggestions(false);

    let lastResponseContent = '';
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
        lastResponseContent = result.content || '';

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
    }

    setIsLoading(false);
    setStreamingContent('');
    setStreamingToolCalls([]);

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
    setInput(prompt);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, []);

  // Check if there are user-visible messages (not just system)
  const hasUserMessages = messages.some(m => m.role === 'user' || m.role === 'assistant');

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

      {/* Messages or Suggestions */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {showSuggestions && !hasUserMessages ? (
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
            disabled={(!input.trim() && attachments.length === 0) || isLoading}
            className="matrix-btn matrix-btn-primary px-4"
            title="Send message (Enter)"
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
                  onClick={() => { setMessages([]); setShowSuggestions(true); if (api?.clearChat) api.clearChat(session.id); }}
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
          <span className="text-[9px] text-matrix-text-muted/20">
            {providerKey ? `${selectedModel || providerKey}` : 'No provider configured'}
          </span>
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
