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
  DIFF_GET: 'diff:get',

  // ─── Workspace Management (Sprint 9) ───
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_GET: 'workspace:get',
  WORKSPACE_ADD: 'workspace:add',
  WORKSPACE_REMOVE: 'workspace:remove',
  WORKSPACE_SET_ACTIVE: 'workspace:set-active',
  WORKSPACE_GET_ACTIVE: 'workspace:get-active',
  WORKSPACE_UPDATE_PATH: 'workspace:update-path',
  WORKSPACE_CLONE: 'workspace:clone',
  WORKSPACE_OPEN_LOCAL: 'workspace:open-local',

  // ─── Git Operations (Sprint 9) ───
  GIT_STATUS: 'git:status',
  GIT_PULL: 'git:pull',
  GIT_PUSH: 'git:push',
  GIT_FETCH: 'git:fetch',
  GIT_BRANCHES: 'git:branches',
  GIT_CHECKOUT: 'git:checkout',
  GIT_CREATE_BRANCH: 'git:create-branch',
  GIT_STASH: 'git:stash',
  GIT_STASH_POP: 'git:stash-pop',
  GIT_STAGE_ALL: 'git:stage-all',
  GIT_UNSTAGE_ALL: 'git:unstage-all',
  GIT_STAGE_FILE: 'git:stage-file',
  GIT_UNSTAGE_FILE: 'git:unstage-file',
  GIT_COMMIT: 'git:commit',
  GIT_COMMIT_PUSH: 'git:commit-push',
  GIT_LOG: 'git:log',
  GIT_DIFF: 'git:diff',
  GIT_DISCARD: 'git:discard',
  GIT_RESET_SOFT: 'git:reset-soft',
  GIT_RESET_HARD: 'git:reset-hard',
  GIT_RESET_TO_REMOTE: 'git:reset-to-remote',

  // ─── Terminal (Sprint 9) ───
  TERMINAL_EXECUTE: 'terminal:execute',
  TERMINAL_DETECT_SHELLS: 'terminal:detect-shells',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
