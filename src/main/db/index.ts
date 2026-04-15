/**
 * SQLite Database Layer using better-sqlite3
 * Local persistence for tasks, chat, verification, tool calls, activity
 */

export interface DatabaseRow {
  [key: string]: unknown;
}

// Schema creation SQL
export const SCHEMA_SQL = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT,
  github_token TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Repositories
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  default_branch TEXT DEFAULT 'main',
  is_private INTEGER DEFAULT 0,
  description TEXT,
  language TEXT,
  installation_id INTEGER,
  clone_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Repo Sessions
CREATE TABLE IF NOT EXISTS repo_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  repository_full_name TEXT NOT NULL,
  working_branch TEXT DEFAULT 'main',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (repository_id) REFERENCES repositories(id)
);

-- Task Ledgers
CREATE TABLE IF NOT EXISTS task_ledgers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  repository_full_name TEXT NOT NULL,
  original_request TEXT NOT NULL,
  roadmap_item_id TEXT,
  status TEXT DEFAULT 'TASK_CREATED',
  current_task_id TEXT,
  tasks TEXT DEFAULT '[]',
  completed_tasks TEXT DEFAULT '[]',
  blocked_tasks TEXT DEFAULT '[]',
  working_branch TEXT DEFAULT 'main',
  relevant_files TEXT DEFAULT '[]',
  event_log TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES repo_sessions(id)
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ledger_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'TASK_CREATED',
  file_scope TEXT DEFAULT '[]',
  files_touched TEXT DEFAULT '[]',
  acceptance_criteria TEXT DEFAULT '[]',
  turn_count INTEGER DEFAULT 0,
  max_turns INTEGER DEFAULT 50,
  token_used INTEGER DEFAULT 0,
  token_budget INTEGER DEFAULT 500000,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  working_branch TEXT DEFAULT '',
  dependencies TEXT DEFAULT '[]',
  priority TEXT DEFAULT 'medium',
  estimated_complexity TEXT DEFAULT 'medium',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES repo_sessions(id),
  FOREIGN KEY (ledger_id) REFERENCES task_ledgers(id)
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  token_count INTEGER DEFAULT 0,
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES repo_sessions(id)
);

-- Tool Call Records
CREATE TABLE IF NOT EXISTS tool_call_records (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  category TEXT NOT NULL,
  input TEXT DEFAULT '{}',
  output TEXT DEFAULT '',
  status TEXT DEFAULT 'success',
  permission_tier TEXT DEFAULT 'read-only',
  duration INTEGER DEFAULT 0,
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Verification Results
CREATE TABLE IF NOT EXISTS verification_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  check_type TEXT NOT NULL,
  passed INTEGER DEFAULT 0,
  summary TEXT DEFAULT '',
  details TEXT DEFAULT '',
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Pull Request Records
CREATE TABLE IF NOT EXISTS pull_request_records (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  repository_full_name TEXT NOT NULL,
  pr_number INTEGER,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  url TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Roadmap Items
CREATE TABLE IF NOT EXISTS roadmap_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  acceptance_criteria TEXT DEFAULT '[]',
  file_scope TEXT DEFAULT '[]',
  estimated_complexity TEXT DEFAULT 'medium',
  dependencies TEXT DEFAULT '[]',
  FOREIGN KEY (session_id) REFERENCES repo_sessions(id)
);

-- MCP Server Configs
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'stdio',
  command TEXT,
  args TEXT DEFAULT '[]',
  env TEXT DEFAULT '{}',
  url TEXT,
  enabled INTEGER DEFAULT 1,
  auto_start INTEGER DEFAULT 0,
  status TEXT DEFAULT 'disconnected',
  tools TEXT DEFAULT '[]',
  last_connected TEXT
);

-- Activity Events
CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  branch TEXT,
  sha TEXT,
  pr_number INTEGER,
  status TEXT DEFAULT 'success',
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES repo_sessions(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_call_records(task_id);
CREATE INDEX IF NOT EXISTS idx_verification_task ON verification_results(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_session ON activity_events(session_id);
`;

/**
 * Database manager class - wraps better-sqlite3 for Electron main process.
 * In web preview mode, uses an in-memory mock.
 */
export class DatabaseManager {
  private db: Map<string, any[]> = new Map();

  constructor() {
    // In-memory store for web preview mode
    const tables = [
      'users', 'repositories', 'repo_sessions', 'task_ledgers',
      'tasks', 'chat_messages', 'tool_call_records', 'verification_results',
      'pull_request_records', 'roadmap_items', 'mcp_servers', 'activity_events'
    ];
    tables.forEach(t => this.db.set(t, []));
  }

  insert(table: string, record: Record<string, unknown>): void {
    const rows = this.db.get(table) || [];
    rows.push({ ...record });
    this.db.set(table, rows);
  }

  findById(table: string, id: string): Record<string, unknown> | undefined {
    return (this.db.get(table) || []).find((r: any) => r.id === id);
  }

  findAll(table: string, filter?: Record<string, unknown>): Record<string, unknown>[] {
    const rows = this.db.get(table) || [];
    if (!filter) return rows;
    return rows.filter((r: any) => {
      return Object.entries(filter).every(([k, v]) => r[k] === v);
    });
  }

  update(table: string, id: string, data: Record<string, unknown>): void {
    const rows = this.db.get(table) || [];
    const idx = rows.findIndex((r: any) => r.id === id);
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], ...data, updated_at: new Date().toISOString() };
    }
  }

  delete(table: string, id: string): void {
    const rows = this.db.get(table) || [];
    this.db.set(table, rows.filter((r: any) => r.id !== id));
  }
}

// Singleton
let dbInstance: DatabaseManager | null = null;

export function getDatabase(): DatabaseManager {
  if (!dbInstance) {
    dbInstance = new DatabaseManager();
  }
  return dbInstance;
}
