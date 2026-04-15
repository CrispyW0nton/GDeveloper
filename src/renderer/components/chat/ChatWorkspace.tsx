import React, { useState, useRef, useEffect } from 'react';
import { SessionInfo, SelectedRepo } from '../../store';

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
}

export default function ChatWorkspace({ session, repo, providerKey }: ChatWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'sys-1',
      role: 'system',
      content: `Connected to **${repo.fullName}** on branch \`${repo.defaultBranch}\`.\nGDeveloper orchestration engine active. Multi-prompt system initialized.\n\nAvailable tools: read_file, write_file, edit_file, list_directory, search_code, git_status, git_diff, git_create_branch, git_commit, run_tests, run_lint, run_build, bash_execute + MCP tools.\n\nReady to assist. What would you like to work on?`,
      timestamp: new Date().toISOString()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [orchestrationPhase, setOrchestrationPhase] = useState('idle');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

    // Simulate orchestration phases
    const phases = ['planning', 'scoping', 'executing', 'verifying'];
    for (const phase of phases) {
      setOrchestrationPhase(phase);
      await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 400));
    }

    // Demo AI response
    const assistantMsg: Message = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: `I'll analyze your request and work on it step by step.\n\n**Task Analysis:**\n- Repository: ${repo.fullName}\n- Branch: ${session.workingBranch}\n- Request: ${userMsg.content.substring(0, 100)}\n\n**Plan:**\n1. Read relevant files to understand current structure\n2. Identify required changes\n3. Implement modifications\n4. Run verification (tests, lint, typecheck)\n5. Prepare commit\n\n**Execution:**\nI've analyzed the codebase and identified the key files. Let me proceed with the implementation.\n\n\`\`\`typescript\n// Changes applied to src/auth/login.ts\nexport async function login(email: string, password: string) {\n  const hashedPassword = await bcrypt.hash(password, 10);\n  const token = jwt.sign({ email }, process.env.JWT_SECRET!, { expiresIn: '24h' });\n  return { token, user: { email } };\n}\n\`\`\`\n\n**Verification Results:**\n- Tests: 12 passed, 0 failed\n- ESLint: 0 errors, 1 warning\n- TypeScript: No errors\n- Build: Succeeded in 3.1s\n\nAll acceptance criteria met. Changes are ready for commit.`,
      toolCalls: [
        { name: 'read_file', description: 'Read src/auth/login.ts', status: 'success' },
        { name: 'list_directory', description: 'List src/auth/', status: 'success' },
        { name: 'search_code', description: 'Search for import patterns', status: 'success' },
        { name: 'write_file', description: 'Update src/auth/login.ts', status: 'success' },
        { name: 'run_tests', description: 'Run test suite', status: 'success' },
        { name: 'run_lint', description: 'Run ESLint', status: 'success' }
      ],
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, assistantMsg]);
    setIsLoading(false);
    setOrchestrationPhase('idle');
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
          {orchestrationPhase !== 'idle' && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 border border-matrix-green border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] text-matrix-green uppercase tracking-wider">{orchestrationPhase}</span>
            </div>
          )}
          <span className={`badge ${orchestrationPhase !== 'idle' ? 'badge-executing' : 'badge-connected'}`}>
            {orchestrationPhase !== 'idle' ? 'Orchestrating' : 'Ready'}
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
              {/* Role label */}
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

              {/* Content */}
              <div className="text-xs text-matrix-text-dim whitespace-pre-wrap leading-relaxed">
                {renderContent(msg.content)}
              </div>

              {/* Tool calls */}
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

        {isLoading && (
          <div className="animate-fadeIn">
            <div className="glass-panel p-4 max-w-[85%]">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin" />
                <span className="text-xs text-matrix-green">
                  AI Agent is working
                  <span className="ml-1 text-matrix-text-muted/40">({orchestrationPhase})</span>
                </span>
              </div>
              <div className="mt-2 flex gap-1">
                {['planning', 'scoping', 'executing', 'verifying'].map(phase => (
                  <div key={phase} className={`h-1 flex-1 rounded-full ${
                    orchestrationPhase === phase ? 'bg-matrix-green animate-pulseDot' :
                    ['planning', 'scoping', 'executing', 'verifying'].indexOf(phase) <
                    ['planning', 'scoping', 'executing', 'verifying'].indexOf(orchestrationPhase) ? 'bg-matrix-green/50' : 'bg-matrix-border'
                  }`} />
                ))}
              </div>
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
          <span className="text-[9px] text-matrix-text-muted/20">Multi-prompt orchestration active</span>
        </div>
      </div>
    </div>
  );
}

function renderContent(content: string): React.ReactNode {
  // Simple markdown-like rendering
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
