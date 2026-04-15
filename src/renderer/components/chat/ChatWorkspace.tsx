import React, { useState, useRef, useEffect } from 'react';
import { SessionInfo, SelectedRepo } from '../../store';

const api = (window as any).electronAPI;

interface ChatWorkspaceProps {
  session: SessionInfo;
  repo: SelectedRepo;
  providerKey: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: Array<{ name: string; description: string; status: 'success' | 'error' }>;
  timestamp: string;
  streaming?: boolean;
}

export default function ChatWorkspace({ session, repo, providerKey }: ChatWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'sys-1',
      role: 'system',
      content: `Connected to **${repo.fullName}** on branch \`${repo.defaultBranch}\`.\nGDeveloper orchestration engine active. AI provider: ${providerKey || 'Configure in Settings'}.\n\nReady to assist. What would you like to work on?`,
      timestamp: new Date().toISOString()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Load chat history from DB on mount
  useEffect(() => {
    if (api && session.id) {
      api.getChatHistory(session.id).then((history: any[]) => {
        if (history && history.length > 0) {
          const dbMessages: Message[] = history.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolCalls: m.tool_calls,
            timestamp: m.timestamp
          }));
          setMessages(prev => {
            // Keep system message, add DB messages
            const sys = prev.filter(m => m.role === 'system');
            return [...sys, ...dbMessages];
          });
        }
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
      } else if (data.type === 'done') {
        // Stream complete - the final message will come from handleSend
        setStreamingContent('');
      } else if (data.type === 'error') {
        setStreamingContent('');
      }
    });

    return () => { if (unsubscribe) unsubscribe(); };
  }, [session.id]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setStreamingContent('');

    try {
      if (api) {
        const result = await api.sendMessage(session.id, input);

        // Add the assistant message (streaming content is already visible)
        const assistantMsg: Message = {
          id: result.id || `msg-${Date.now() + 1}`,
          role: 'assistant',
          content: result.content,
          toolCalls: result.toolCalls?.map((tc: any) => ({
            name: tc.name,
            description: `Called ${tc.name}`,
            status: 'success' as const
          })),
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else {
        // Web preview fallback
        const assistantMsg: Message = {
          id: `msg-${Date.now() + 1}`,
          role: 'assistant',
          content: 'Running in web preview mode. Connect the Electron app to use real AI responses.',
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
    } catch (err) {
      const errMsg: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to send message'}`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errMsg]);
    }

    setIsLoading(false);
    setStreamingContent('');
  };

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
          <span className={`badge ${isLoading ? 'badge-executing' : 'badge-connected'}`}>
            {isLoading ? 'Streaming...' : 'Ready'}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(msg => (
          <div key={msg.id} className={`animate-fadeIn ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
            <div className={`max-w-[85%] ${
              msg.role === 'user'
                ? 'glass-panel p-3 border-matrix-green/30'
                : msg.role === 'system'
                  ? 'glass-panel p-3 border-matrix-info/20 bg-matrix-info/5'
                  : 'glass-panel p-4'
            }`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[10px] uppercase tracking-wider font-bold ${
                  msg.role === 'user' ? 'text-matrix-green' : msg.role === 'system' ? 'text-matrix-info' : 'text-matrix-text-dim'
                }`}>
                  {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'GDeveloper'}
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
                          : 'border-matrix-danger/20 text-matrix-danger/70 bg-matrix-danger/5'
                      }`}>
                        {tc.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {isLoading && (
          <div className="animate-fadeIn">
            <div className="glass-panel p-4 max-w-[85%]">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-matrix-text-dim">GDeveloper</span>
                <span className="w-3 h-3 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin" />
              </div>
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
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Describe what you want to build or fix..."
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[9px] text-matrix-text-muted/20">Shift+Enter for new line</span>
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
