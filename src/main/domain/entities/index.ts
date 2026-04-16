import { TaskStatus, PermissionTier, MCPTransportType, MCPServerStatus, ToolCategory, VerificationCheckType, PromptRole } from '../enums';

// ─── User ───
export interface User {
  id: string;
  username: string;
  email?: string;
  githubToken?: string;
  createdAt: string;
}

// ─── Repository ───
export interface Repository {
  id: string;
  fullName: string;          // e.g. "owner/repo"
  defaultBranch: string;
  isPrivate: boolean;
  description?: string;
  language?: string;
  installationId?: number;
  cloneUrl?: string;
}

// ─── RepoSession ───
export interface RepoSession {
  id: string;
  userId: string;
  repositoryId: string;
  repositoryFullName: string;
  workingBranch: string;
  status: 'active' | 'paused' | 'completed';
  createdAt: string;
}

// ─── Task ───
export interface Task {
  id: string;
  sessionId: string;
  ledgerId: string;
  title: string;
  description: string;
  status: TaskStatus;
  fileScope: string[];
  filesTouched: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  turnCount: number;
  maxTurns: number;
  tokenUsed: number;
  tokenBudget: number;
  retryCount: number;
  maxRetries: number;
  workingBranch: string;
  dependencies: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedComplexity: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  met: boolean;
}

// ─── TaskLedger ───
export interface TaskLedger {
  id: string;
  sessionId: string;
  repositoryFullName: string;
  originalRequest: string;
  roadmapItemId?: string;
  status: TaskStatus;
  currentTaskId?: string;
  tasks: string[];
  completedTasks: string[];
  blockedTasks: string[];
  workingBranch: string;
  relevantFiles: string[];
  eventLog: LedgerEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEvent {
  timestamp: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

// ─── ChangePlan ───
export interface ChangePlan {
  id: string;
  taskId: string;
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  description: string;
  diff?: string;
  applied: boolean;
}

// ─── VerificationResult ───
export interface VerificationResult {
  id: string;
  taskId: string;
  checkType: VerificationCheckType;
  passed: boolean;
  summary: string;
  details: string;
  timestamp: string;
}

// ─── ToolCallRecord ───
export interface ToolCallRecord {
  id: string;
  taskId: string;
  toolName: string;
  category: ToolCategory;
  input: Record<string, unknown>;
  output: string;
  status: 'success' | 'error' | 'denied';
  permissionTier: PermissionTier;
  duration: number;
  timestamp: string;
}

// ─── ChatMessage ───
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: PromptRole | 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCallSummary[];
  tokenCount?: number;
  timestamp: string;
}

export interface ToolCallSummary {
  name: string;
  description: string;
  status: 'success' | 'error';
}

// ─── RoadmapItem ───
export interface RoadmapItem {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  acceptanceCriteria: string[];
  fileScope: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  dependencies: string[];
}

// ─── PullRequestRecord ───
export interface PullRequestRecord {
  id: string;
  taskId: string;
  repositoryFullName: string;
  prNumber: number;
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  status: 'open' | 'closed' | 'merged';
  url: string;
  createdAt: string;
}

// ─── MCP Server Config ───
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransportType;
  command?: string;        // for stdio
  args?: string[];         // for stdio
  env?: Record<string, string>; // for stdio
  url?: string;            // for http/sse
  enabled: boolean;
  autoStart: boolean;
  status: MCPServerStatus;
  tools: MCPToolInfo[];
  lastConnected?: string;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  serverName: string;
}

// ─── Tool Definition ───
export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  permissionTier: PermissionTier;
  inputSchema: Record<string, unknown>;
  source: 'builtin' | 'mcp';
  mcpServerName?: string;
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  artifacts?: string[];
}

// ─── Settings ───
export interface AppSettings {
  apiKeys: {
    claude?: string;
    openai?: string;
    custom?: string;
  };
  github: {
    appId?: string;
    privateKey?: string;
    clientId?: string;
    clientSecret?: string;
    connected: boolean;
    installations: GitHubInstallation[];
  };
  preferences: {
    theme: 'matrix';
    maxTurnsPerTask: number;
    maxTokenBudget: number;
    maxRetries: number;
    autoApproveReadOnly: boolean;
    autoApproveWrite: boolean;
  };
  // Sprint 16: Model selection persistence
  selectedModel?: string;
}

export interface GitHubInstallation {
  installationId: number;
  accountLogin: string;
  accountType: 'Organization' | 'User';
  repositories: Repository[];
}

// ─── Activity Event ───
export interface ActivityEvent {
  id: string;
  sessionId: string;
  type: 'branch_created' | 'commit' | 'pr_created' | 'pr_merged' | 'task_completed' | 'verification' | 'mcp_connected';
  title: string;
  description: string;
  branch?: string;
  sha?: string;
  prNumber?: number;
  status: 'success' | 'pending' | 'error';
  timestamp: string;
}
