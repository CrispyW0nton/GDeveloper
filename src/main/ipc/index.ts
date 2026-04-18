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

  // ─── Sprint 12: Slash Commands & Mode ───
  SLASH_COMMAND_EXECUTE: 'slash:execute',
  SLASH_COMMAND_LIST: 'slash:list',
  MODE_GET: 'mode:get',
  MODE_SET: 'mode:set',

  // ─── Sprint 13: Discovery, Migration, Environment, Research ───
  DISCOVERY_SCAN: 'discovery:scan',
  DISCOVERY_IMPORT: 'discovery:import',
  MIGRATION_GET_MANAGED_ROOT: 'migration:get-managed-root',
  MIGRATION_SET_MANAGED_ROOT: 'migration:set-managed-root',
  MIGRATION_MOVE_WORKSPACE: 'migration:move-workspace',
  MIGRATION_MOVE_TO_MANAGED: 'migration:move-to-managed',
  ENV_DETECT_STACK: 'env:detect-stack',
  ENV_GET_PROFILE: 'env:get-profile',
  ENV_CREATE_PYTHON: 'env:create-python',
  ENV_SYNC_DEPS: 'env:sync-deps',
  ENV_IS_UV_AVAILABLE: 'env:is-uv-available',
  RESEARCH_EXECUTE: 'research:execute',
  RESEARCH_COMPARE: 'research:compare',
  EXTERNAL_DOWNLOAD: 'external:download',
  EXTERNAL_LIST: 'external:list',
  EXTERNAL_REMOVE: 'external:remove',
  // MCP Health (Sprint 13)
  MCP_HEALTH: 'mcp:health',
  // GitHub auth info (Sprint 13)
  GITHUB_AUTH_STATUS: 'github:auth-status',
  // Task lifecycle verification (Sprint 13)
  TASK_VERIFY: 'task:verify',

  // ─── Sprint 16: Model Selection, Sandbox Monitor ───
  MODEL_LIST: 'model:list',
  MODEL_GET_SELECTED: 'model:get-selected',
  MODEL_SET_SELECTED: 'model:set-selected',
  MODEL_DISCOVER: 'model:discover',
  MODEL_CHECK_TOOLS: 'model:check-tools',
  MODEL_REFRESH: 'model:refresh',        // Sprint 25.5: force-refresh model list
  MODEL_VALIDATE_SELECTED: 'model:validate-selected', // Sprint 25.5: validate + auto-switch
  SANDBOX_GET_LOG: 'sandbox:get-log',
  SANDBOX_CLEAR_LOG: 'sandbox:clear-log',

  // ─── Sprint 14: MCP Forge / App Adapter Studio ───
  FORGE_SCAN: 'forge:scan',
  FORGE_GENERATE: 'forge:generate',
  FORGE_SAVE: 'forge:save',
  FORGE_LIST_ADAPTERS: 'forge:list-adapters',
  FORGE_GET_ADAPTER: 'forge:get-adapter',
  FORGE_UPDATE_ADAPTER: 'forge:update-adapter',
  FORGE_REMOVE_ADAPTER: 'forge:remove-adapter',
  FORGE_TEST: 'forge:test',
  FORGE_REGISTER: 'forge:register',
  FORGE_UNREGISTER: 'forge:unregister',
  FORGE_RESEARCH: 'forge:research',
  FORGE_ANALYSIS_CLONE: 'forge:analysis-clone',
  FORGE_ANALYSIS_LIST: 'forge:analysis-list',
  FORGE_ANALYSIS_REMOVE: 'forge:analysis-remove',
  FORGE_APP_RECORDS: 'forge:app-records',
  FORGE_APP_RECORD_SAVE: 'forge:app-record-save',
  FORGE_APP_RECORD_REMOVE: 'forge:app-record-remove',
  FORGE_APP_TOGGLE_FAVORITE: 'forge:app-toggle-favorite',

  // ─── Sprint 17: Git Worktrees ───
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_ADD: 'worktree:add',
  WORKTREE_REMOVE: 'worktree:remove',
  WORKTREE_PRUNE: 'worktree:prune',
  WORKTREE_REPAIR: 'worktree:repair',
  WORKTREE_LOCK: 'worktree:lock',
  WORKTREE_UNLOCK: 'worktree:unlock',
  WORKTREE_MOVE: 'worktree:move',
  WORKTREE_COMPARE: 'worktree:compare',
  WORKTREE_CONTEXT: 'worktree:context',
  WORKTREE_CREATE_TASK: 'worktree:create-task',
  WORKTREE_COMPLETE_TASK: 'worktree:complete-task',
  WORKTREE_ABANDON_TASK: 'worktree:abandon-task',
  WORKTREE_HANDOFF: 'worktree:handoff',
  WORKTREE_TASK_LIST: 'worktree:task-list',
  WORKTREE_RECOMMEND: 'worktree:recommend',

  // ─── Sprint 19: File Tree ───
  FILE_TREE_GET: 'filetree:get',
  FILE_TREE_READ: 'filetree:read-file',

  // ─── Sprint 19 + Sprint 22: Auto-Continue ───
  AUTO_CONTINUE_START: 'auto-continue:start',
  AUTO_CONTINUE_STOP: 'auto-continue:stop',
  AUTO_CONTINUE_STATUS: 'auto-continue:status',
  AUTO_CONTINUE_PAUSE: 'auto-continue:pause',
  AUTO_CONTINUE_RESUME: 'auto-continue:resume',
  AUTO_CONTINUE_LOG: 'auto-continue:log',
  AUTO_CONTINUE_CONFIG: 'auto-continue:config',

  // ─── Sprint 23: File Writing (Editor) ───
  FILE_WRITE: 'filetree:write-file',
  FILE_CHECK_WRITABLE: 'filetree:check-writable',

  // ─── Sprint 23: Model Metadata ───
  MODEL_GET_DEFAULT: 'model:get-default',
  MODEL_SET_DEFAULT: 'model:set-default',
  MODEL_GET_META_LIST: 'model:get-meta-list',

  // ─── Sprint 21: Rate Limiting & Token Budget ───
  RATE_LIMIT_GET_SNAPSHOT: 'rate-limit:get-snapshot',
  RATE_LIMIT_RESET: 'rate-limit:reset',
  RATE_LIMIT_PAUSE_RESUME: 'rate-limit:pause-resume',
  TOKEN_BUDGET_GET: 'token-budget:get',
  TOKEN_BUDGET_SET: 'token-budget:set',
  RETRY_STATE_GET: 'retry:get-state',
  CONTEXT_SUMMARIZE: 'context:summarize',
  CONTEXT_COMPACT: 'context:compact',

  // ─── Sprint 24: Session Usage ───
  SESSION_USAGE_GET: 'session-usage:get',
  SESSION_USAGE_RESET: 'session-usage:reset',

  // ─── Sprint 25: Attachments & Vision ───
  ATTACHMENT_PROCESS: 'attachment:process',
  ATTACHMENT_PROCESS_CLIPBOARD: 'attachment:process-clipboard',
  ATTACHMENT_LOAD: 'attachment:load',
  ATTACHMENT_DELETE_CONVERSATION: 'attachment:delete-conversation',
  ATTACHMENT_CONFIG_GET: 'attachment:config-get',
  ATTACHMENT_CONFIG_SET: 'attachment:config-set',
  ATTACHMENT_CHECK_VISION: 'attachment:check-vision',

  // ─── Sprint 27: Compare Agent ───
  COMPARE_FILES: 'compare:files',
  COMPARE_FOLDERS: 'compare:folders',
  COMPARE_MERGE3: 'compare:merge3',
  COMPARE_SYNC_PREVIEW: 'compare:sync-preview',
  COMPARE_GET_SESSION: 'compare:get-session',
  COMPARE_LIST_SESSIONS: 'compare:list-sessions',
  COMPARE_DELETE_SESSION: 'compare:delete-session',
  COMPARE_HUNK_ACTION: 'compare:hunk-action',
  COMPARE_HUNK_DETAIL: 'compare:hunk-detail',
  COMPARE_FOLDER_ENTRY_DIFF: 'compare:folder-entry-diff',
  COMPARE_COMPACT_OUTPUT: 'compare:compact-output',
  COMPARE_SAVE_MERGE: 'compare:save-merge',

  // ─── Sprint 27: Todo Manager ───
  TODO_GET: 'todo:get',
  TODO_CREATE: 'todo:create',
  TODO_UPDATE_ITEM: 'todo:update-item',
  TODO_APPEND: 'todo:append',
  TODO_CLEAR: 'todo:clear',
  TODO_PROGRESS: 'todo:progress',
  // Sprint 27.2: Live push channel for Task Queue Panel
  TODO_CHANGED: 'todo:changed',

  // ─── Sprint 27: Checkpoints ───
  CHECKPOINT_LIST: 'checkpoint:list',
  CHECKPOINT_CREATE: 'checkpoint:create',
  CHECKPOINT_LATEST: 'checkpoint:latest',

  // ─── Sprint 27: Verify ───
  VERIFY_RUN: 'verify:run',
  VERIFY_HISTORY: 'verify:history',

  // ─── Sprint 27.1: Write-Scope ───
  WRITE_SCOPE_GET: 'write-scope:get',
  WRITE_SCOPE_SET: 'write-scope:set',
  WRITE_SCOPE_CLEAR: 'write-scope:clear',

  // ─── Sprint 27.1: Verify Spec ───
  VERIFY_SPEC_LIST: 'verify-spec:list',
  VERIFY_SPEC_LOAD: 'verify-spec:load',
  VERIFY_SPEC_RUN: 'verify-spec:run',

  // ─── Sprint 27.1: Rate Limit Lite ───
  RATE_LIMIT_LITE_SNAPSHOT: 'rate-limit-lite:snapshot',
  RATE_LIMIT_LITE_HEADERS: 'rate-limit-lite:headers',

  // ─── Sprint 27.2: Auto-Continue State Machine ───
  AUTO_CONTINUE_SHOULD_FIRE: 'auto-continue:should-fire',
  AUTO_CONTINUE_STATE_SNAPSHOT: 'auto-continue:state-snapshot',
  AUTO_CONTINUE_PAUSE_USER: 'auto-continue:pause-user',
  AUTO_CONTINUE_RESUME_USER: 'auto-continue:resume-user',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
