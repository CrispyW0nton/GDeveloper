// ─── Task Status (State Machine) ───
export enum TaskStatus {
  TASK_CREATED = 'TASK_CREATED',
  SCOPED = 'SCOPED',
  PLANNED = 'PLANNED',
  EXECUTING = 'EXECUTING',
  VERIFYING = 'VERIFYING',
  COMMIT_READY = 'COMMIT_READY',
  PR_READY = 'PR_READY',
  DONE = 'DONE',
  BLOCKED = 'BLOCKED'
}

// ─── Permission Tiers ───
export enum PermissionTier {
  READ_ONLY = 'read-only',       // Auto-approved
  WRITE = 'write',               // Auto-approved in trusted workspace
  HIGH_RISK = 'high-risk'        // Requires explicit user approval
}

// ─── Prompt Roles ───
export enum PromptRole {
  SYSTEM = 'system',
  PLANNER = 'planner',
  EXECUTOR = 'executor',
  VERIFIER = 'verifier',
  REPAIR = 'repair',
  SUMMARIZER = 'summarizer',
  COMPACTOR = 'compactor',
  USER = 'user',
  ASSISTANT = 'assistant'
}

// ─── MCP Transport Types ───
export enum MCPTransportType {
  STDIO = 'stdio',
  HTTP = 'http',
  SSE = 'sse'
}

// ─── MCP Server Status ───
export enum MCPServerStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

// ─── Tool Category ───
export enum ToolCategory {
  FILE_OPS = 'file-ops',
  CODE_SEARCH = 'code-search',
  GIT = 'git',
  GITHUB_API = 'github-api',
  SHELL = 'shell',
  PACKAGE_MANAGER = 'package-manager',
  TEST_LINT_BUILD = 'test-lint-build',
  BROWSER = 'browser',
  MCP = 'mcp',
  ARTIFACT = 'artifact'
}

// ─── Verification Check Type ───
export enum VerificationCheckType {
  UNIT_TEST = 'unit-test',
  LINT = 'lint',
  TYPECHECK = 'typecheck',
  BUILD = 'build',
  ACCEPTANCE = 'acceptance'
}
