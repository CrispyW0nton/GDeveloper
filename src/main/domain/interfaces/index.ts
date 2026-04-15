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
  sendMessage(messages: Array<{ role: string; content: string }>, tools?: ToolDefinition[]): Promise<LLMResponse>;
  streamMessage(messages: Array<{ role: string; content: string }>, tools?: ToolDefinition[]): AsyncIterable<LLMStreamChunk>;
  countTokens(text: string): number;
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
}

export interface LLMStreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
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
  addServer(config: MCPServerConfig): Promise<void>;
  removeServer(id: string): Promise<void>;
  connectServer(id: string): Promise<void>;
  disconnectServer(id: string): Promise<void>;
  getServers(): MCPServerConfig[];
  getServerTools(id: string): Promise<MCPServerConfig['tools']>;
  testConnection(id: string): Promise<boolean>;
}

// ─── Orchestration Engine ───
export interface IOrchestrationEngine {
  startTask(sessionId: string, request: string): Promise<void>;
  continueTask(taskId: string): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  getState(taskId: string): TaskStatus;
}
