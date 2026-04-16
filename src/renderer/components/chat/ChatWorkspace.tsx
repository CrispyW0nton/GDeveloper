/**
 * ChatWorkspace — Sprint 12
 * Full chat UI with streaming, tool-call display, history persistence.
 * Sprint 12 additions: slash command autocomplete, mode indicator,
 * suggestion cards on empty chat, follow-up action buttons.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SessionInfo, SelectedRepo, ExecutionMode } from '../../store';
import SlashCommandDropdown, { SlashCommandInfo } from './SlashCommandDropdown';
import SuggestionCards from './SuggestionCards';
import FollowupButtons from './FollowupButtons';

const api = (window as any).electronAPI;

interface ChatWorkspaceProps {
  session: SessionInfo;
  repo: SelectedRepo;
  providerKey: string;
  executionMode: ExecutionMode;
  onModeChange: (mode: ExecutionMode) => void;
}

interface ToolCallDisplay {
  name: string;
  description: string;
  status: 'success' | 'error' | 'running';
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'command';
  content: string;
  toolCalls?: ToolCallDisplay[];
  timestamp: string;
  streaming?: boolean;
}

export default function ChatWorkspace({ session, repo, providerKey, executionMode, onModeChange }: ChatWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallDisplay[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Slash command state
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [showSlashDropdown, setShowSlashDropdown] = useState(false);

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
            content: m.content,
            toolCalls: m.tool_calls?.map((tc: any) => ({
              name: tc.name,
              description: `Called ${tc.name}`,
              status: 'success' as const,
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
        setStreamingContent(data.fullContent || '');
      } else if (data.type === 'tool_call' && data.toolCall) {
        setStreamingToolCalls(prev => [
          ...prev,
          { name: data.toolCall.name, description: `Calling ${data.toolCall.name}...`, status: 'running' as const },
        ]);
      } else if (data.type === 'tool_result' || data.type === 'tool_error') {
        setStreamingToolCalls(prev =>
          prev.map(tc =>
            tc.name === data.toolName
              ? { ...tc, status: data.type === 'tool_error' ? 'error' as const : 'success' as const, description: `${data.toolName}: ${(data.result || '').substring(0, 100)}` }
              : tc
          )
        );
      } else if (data.type === 'done') {
        setStreamingContent('');
      } else if (data.type === 'error') {
        setStreamingContent('');
      }
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
        content: 'Slash commands not available in web preview mode.',
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
    } catch (err) {
      const errMsg: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'system',
        content: `Command error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    }
  }, [session.id, onModeChange]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const trimmed = input.trim();

    // Check if it's a slash command
    if (trimmed.startsWith('/')) {
      setInput('');
      setShowSlashDropdown(false);
      await executeSlashCommand(trimmed);
      return;
    }

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setStreamingContent('');
    setStreamingToolCalls([]);
    setShowSuggestions(false);

    try {
      if (api) {
        const result = await api.sendMessage(session.id, trimmed);

        const assistantMsg: Message = {
          id: result.id || `msg-${Date.now() + 1}`,
          role: 'assistant',
          content: result.content,
          toolCalls: result.toolCalls?.map((tc: any) => ({
            name: tc.name,
            description: `Called ${tc.name}`,
            status: 'success' as const,
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
        content: `Error: ${err instanceof Error ? err.message : 'Failed to send message'}`,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    }

    setIsLoading(false);
    setStreamingContent('');
    setStreamingToolCalls([]);
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between glass-panel-solid rounded-none border-x-0 border-t-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-matrix-green animate-pulseDot" />
            <span className="text-sm text-matrix-green font-bold">{repo.fullName}</span>
          </div>
          <span className="text-[10px] text-matrix-text-muted/40">|</span>
          <span className="text-[10px] text-matrix-text-dim">branch: {session.workingBranch}</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Mode indicator */}
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border ${
            executionMode === 'plan'
              ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/5'
              : 'border-matrix-green/30 text-matrix-green bg-matrix-green/5'
          }`}>
            <span>{executionMode === 'plan' ? '\uD83D\uDD0D' : '\uD83D\uDD28'}</span>
            <span>{executionMode === 'plan' ? 'PLAN MODE' : 'BUILD MODE'}</span>
          </div>
          <span className={`badge ${isLoading ? 'badge-executing' : 'badge-connected'}`}>
            {isLoading ? 'Streaming...' : 'Ready'}
          </span>
        </div>
      </div>

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

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-matrix-border/30">
                      <p className="text-[9px] text-matrix-text-muted/40 mb-1.5 uppercase tracking-wider">Tool Calls</p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.toolCalls.map((tc, i) => (
                          <div key={i} className={`text-[10px] px-2 py-0.5 rounded border ${
                            tc.status === 'success'
                              ? 'border-matrix-green/20 text-matrix-green/70 bg-matrix-green/5'
                              : tc.status === 'error'
                                ? 'border-matrix-danger/20 text-matrix-danger/70 bg-matrix-danger/5'
                                : 'border-matrix-warning/20 text-matrix-warning/70 bg-matrix-warning/5'
                          }`}>
                            {tc.status === 'running' && <span className="inline-block w-2 h-2 border border-current border-t-transparent rounded-full animate-spin mr-1" />}
                            {tc.name}
                          </div>
                        ))}
                      </div>
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

        {/* Streaming indicator */}
        {isLoading && (
          <div className="animate-fadeIn">
            <div className="glass-panel p-4 max-w-[85%]">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-matrix-text-dim">GDeveloper</span>
                <span className="w-3 h-3 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin" />
              </div>

              {streamingToolCalls.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {streamingToolCalls.map((tc, i) => (
                    <div key={i} className={`text-[10px] px-2 py-0.5 rounded border ${
                      tc.status === 'success'
                        ? 'border-matrix-green/20 text-matrix-green/70 bg-matrix-green/5'
                        : tc.status === 'error'
                          ? 'border-matrix-danger/20 text-matrix-danger/70 bg-matrix-danger/5'
                          : 'border-matrix-warning/20 text-matrix-warning/70 bg-matrix-warning/5 animate-pulse'
                    }`}>
                      {tc.status === 'running' && <span className="inline-block w-2 h-2 border border-current border-t-transparent rounded-full animate-spin mr-1" />}
                      {tc.name}
                    </div>
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
                  <span className="text-xs text-matrix-green">Thinking...</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-matrix-border">
        <div className="flex gap-2">
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
              placeholder="Describe what you want to build... or type / for commands"
              className="matrix-input resize-none h-10 pr-10"
              rows={1}
              disabled={isLoading}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="matrix-btn matrix-btn-primary px-4"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[9px] text-matrix-text-muted/20">
            Shift+Enter for new line &middot; Type <code className="text-matrix-green/30">/</code> for commands
          </span>
          <span className="text-[9px] text-matrix-text-muted/20">
            {providerKey ? `Provider: ${providerKey}` : 'No provider configured'}
          </span>
        </div>
      </div>
    </div>
  );
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
