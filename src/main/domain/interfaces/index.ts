import {
  Repository, RepoSession, Task, TaskLedger, ChatMessage,
  ToolCallRecord, VerificationResult, PullRequestRecord,
  RoadmapItem, MCPServerConfig, AppSettings, ToolDefinition,
  ToolResult, ChangePlan, ActivityEvent
} from '../entities';
import { TaskStatus } from '../enums';

// ─── LLM Provider Interface ───
export interface ILLMProvider {
  name: string;
  sendMessage(messages: Array<{ role: string; content: string }>, tools?: ToolDefinition[], systemPrompt?: string): Promise<LLMResponse>;
  streamMessage(messages: Array<{ role: string; content: string }>, tools?: ToolDefinition[], systemPrompt?: string): AsyncIterable<LLMStreamChunk>;
  countTokens(text: string): number;
  getModelId?(): string;
  setModel?(model: string): void;
  discoverModels?(forceRefresh?: boolean): Promise<Array<{
    id: string;
    name: string;
    provider: string;
    supportsTools: boolean;
    supportsStreaming: boolean;
    contextWindow?: number;
    maxOutput?: number;
  }>>;
  validateKey?(): Promise<{ valid: boolean; error?: string; models?: string[] }>;
  abortActiveStream?(): void;
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string;
  /** Sprint 24: Parsed Anthropic rate-limit headers from response */
  rateLimitHeaders?: Record<string, any>;
}

export interface LLMStreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  /** Sprint 28: stop_reason from Anthropic message_delta (e.g., 'end_turn', 'tool_use') */
  stopReason?: string;
}

// ─── GitHub Gateway ───
export interface IGitHubGateway {
  authenticate(token: string): Promise<void>;
  listInstallationRepos(installationId: number): Promise<Repository[]>;
  getFileContent(repo: string, path: string, branch: string): Promise<string>;
  createBranch(repo: string, branch: string, baseSha: string): Promise<void>;
  createCommit(repo: string, branch: string, message: string, files: Array<{ path: string; content: string }>): Promise<string>;
  createPullRequest(repo: string, title: string, body: string, head: string, base: string): Promise<{ number: number; url: string }>;
  listBranches(repo: string): Promise<string[]>;
  getLatestSha(repo: string, branch: string): Promise<string>;
}

// ─── Repository Interfaces ───
export interface ITaskRepository {
  create(task: Task): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findBySessionId(sessionId: string): Promise<Task[]>;
  update(id: string, data: Partial<Task>): Promise<Task>;
  updateStatus(id: string, status: TaskStatus): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ITaskLedgerRepository {
  create(ledger: TaskLedger): Promise<TaskLedger>;
  findById(id: string): Promise<TaskLedger | null>;
  findBySessionId(sessionId: string): Promise<TaskLedger | null>;
  update(id: string, data: Partial<TaskLedger>): Promise<TaskLedger>;
  appendEvent(ledgerId: string, event: TaskLedger['eventLog'][0]): Promise<void>;
}

export interface IChatMessageRepository {
  create(message: ChatMessage): Promise<ChatMessage>;
  findBySessionId(sessionId: string): Promise<ChatMessage[]>;
  deleteBySessionId(sessionId: string): Promise<void>;
}

export interface IToolCallRepository {
  create(record: ToolCallRecord): Promise<ToolCallRecord>;
  findByTaskId(taskId: string): Promise<ToolCallRecord[]>;
}

export interface IVerificationRepository {
  create(result: VerificationResult): Promise<VerificationResult>;
  findByTaskId(taskId: string): Promise<VerificationResult[]>;
}

// ─── Tool Registry Interface ───
export interface IToolRegistry {
  register(tool: ToolDefinition): void;
  unregister(name: string): void;
  get(name: string): ToolDefinition | undefined;
  getAll(): ToolDefinition[];
  getByCategory(category: string): ToolDefinition[];
  executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult>;
}

// ─── MCP Client Manager ───
export interface IMCPClientManager {
  addServer(config: MCPServerConfig): Promise<MCPServerConfig>;
  removeServer(id: string): Promise<void>;
  connectServer(id: string): Promise<void>;
  disconnectServer(id: string): Promise<void>;
  getServers(): MCPServerConfig[];
  getRoutedTools(): Array<MCPServerConfig['tools'][number] & {
    serverId: string;
    routeCandidates: number;
    routeReason: string;
    lastLatencyMs: number | null;
  }>;
  getToolRouteCandidates(toolName: string): Array<{
    serverId: string;
    serverName: string;
    toolName: string;
    transport: string;
    healthy: boolean;
    heartbeatFailureCount: number;
    reconnectAttempts: number;
    lastLatencyMs: number | null;
    score: number;
  }>;
  getServerTools(id: string): Promise<MCPServerConfig['tools']>;
  getHealthStatus(): Array<{
    id: string;
    name: string;
    status: string;
    healthy: boolean;
    heartbeatFailureCount: number;
    reconnectAttempts: number;
    lastHeartbeatAt: string | null;
    lastError: string | null;
    transport: string;
    toolCount: number;
    lastConnected: string | null;
    url: string | null;
    command: string | null;
  }>;
  testConnection(id: string): Promise<{ reachable: boolean; mcpReady: boolean; error?: string }>;
  executeTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<any>;
}

// ─── Orchestration Engine ───
export interface IOrchestrationEngine {
  startTask(sessionId: string, request: string): Promise<void>;
  continueTask(taskId: string): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  getState(taskId: string): TaskStatus;
}
