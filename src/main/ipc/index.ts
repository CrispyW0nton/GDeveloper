/**
 * IPC Channel Definitions & Handlers
 * Bridge between Electron main process and renderer
 * In web preview mode, these are called directly
 */

// ─── IPC Channel Names ───
export const IPC_CHANNELS = {
  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  API_KEY_SET: 'api-key:set',
  API_KEY_GET: 'api-key:get',
  API_KEY_REMOVE: 'api-key:remove',
  API_KEY_VALIDATE: 'api-key:validate',

  // GitHub
  GITHUB_CONNECT: 'github:connect',
  GITHUB_DISCONNECT: 'github:disconnect',
  GITHUB_LIST_REPOS: 'github:list-repos',
  GITHUB_SELECT_REPO: 'github:select-repo',
  GITHUB_GET_FILE: 'github:get-file',
  GITHUB_CREATE_BRANCH: 'github:create-branch',
  GITHUB_CREATE_COMMIT: 'github:create-commit',
  GITHUB_CREATE_PR: 'github:create-pr',

  // Chat / Orchestration
  CHAT_SEND: 'chat:send',
  CHAT_HISTORY: 'chat:history',
  CHAT_CLEAR: 'chat:clear',
  ORCHESTRATION_START: 'orchestration:start',
  ORCHESTRATION_PAUSE: 'orchestration:pause',
  ORCHESTRATION_STATUS: 'orchestration:status',

  // Tasks
  TASK_LIST: 'task:list',
  TASK_GET: 'task:get',
  TASK_UPDATE: 'task:update',

  // Roadmap
  ROADMAP_UPLOAD: 'roadmap:upload',
  ROADMAP_PARSE: 'roadmap:parse',
  ROADMAP_LIST: 'roadmap:list',

  // MCP
  MCP_LIST_SERVERS: 'mcp:list-servers',
  MCP_ADD_SERVER: 'mcp:add-server',
  MCP_REMOVE_SERVER: 'mcp:remove-server',
  MCP_CONNECT: 'mcp:connect',
  MCP_DISCONNECT: 'mcp:disconnect',
  MCP_TEST: 'mcp:test',
  MCP_GET_TOOLS: 'mcp:get-tools',
  MCP_TOGGLE_TOOL: 'mcp:toggle-tool',
  MCP_UPDATE_SERVER: 'mcp:update-server',

  // Tools
  TOOL_LIST: 'tool:list',
  TOOL_EXECUTE: 'tool:execute',
  TOOL_APPROVE: 'tool:approve',

  // Activity
  ACTIVITY_LIST: 'activity:list',

  // Verification
  VERIFICATION_LIST: 'verification:list',
  VERIFICATION_RUN: 'verification:run',

  // Diff
  DIFF_GET: 'diff:get'
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
