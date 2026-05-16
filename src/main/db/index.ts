/**
 * SQLite Database Layer using better-sqlite3
 * Real persistent storage for tasks, chat, activity, MCP configs
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { v4 as uuid } from 'uuid';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  token_count INTEGER DEFAULT 0,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'TASK_CREATED',
  file_scope TEXT DEFAULT '[]',
  acceptance_criteria TEXT DEFAULT '[]',
  verification_evidence TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_transitions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT DEFAULT '',
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  metadata TEXT DEFAULT '{}',
  status TEXT DEFAULT 'success',
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS diff_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,
  file_path TEXT NOT NULL,
  old_content TEXT DEFAULT '',
  new_content TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'stdio',
  command TEXT,
  args TEXT DEFAULT '[]',
  env TEXT DEFAULT '{}',
  url TEXT,
  remote_auth TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'disconnected',
  tools TEXT DEFAULT '[]',
  last_connected TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL,
  remote_url TEXT,
  github_owner TEXT,
  github_repo TEXT,
  default_branch TEXT DEFAULT 'main',
  cloned_at TEXT,
  last_opened_at TEXT,
  mcp_server_id TEXT,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS project_context_snapshots (
  workspace_path TEXT PRIMARY KEY,
  rule_files TEXT DEFAULT '[]',
  repo_map TEXT DEFAULT '{}',
  generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_context_retrievals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  query TEXT NOT NULL,
  chunks TEXT DEFAULT '[]',
  generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_diagnostics_snapshots (
  workspace_path TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  command TEXT NOT NULL,
  diagnostics TEXT DEFAULT '[]',
  error TEXT,
  duration_ms INTEGER DEFAULT 0,
  generated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_activity_session ON activity_events(session_id);
CREATE INDEX IF NOT EXISTS idx_diff_session ON diff_records(session_id);
CREATE INDEX IF NOT EXISTS idx_project_context_retrievals_session ON project_context_retrievals(session_id);
`;

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath || join(app.getPath('userData'), 'gdeveloper.db');
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    this.ensureColumn('mcp_servers', 'remote_auth', "TEXT DEFAULT '{}'");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some(c => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // ─── Chat Messages ─────────────────────────────────

  // Sprint 36 Fix 3: Known nudge signature that must never be persisted.
  // If the caller accidentally passes the noToolsUsed() text, we reject it
  // so the payload cannot grow unboundedly.
  private static readonly NUDGE_SIGNATURE = '[ERROR] You did not use a tool';

  insertMessage(sessionId: string, role: string, content: string, toolCalls?: any[], tokenCount = 0): string {
    // Sprint 36 Fix 3: DB guard — reject nudge messages from being persisted.
    // The nudge is ephemeral and must only live in the in-memory agent loop.
    if (content && content.includes(DatabaseManager.NUDGE_SIGNATURE)) {
      console.warn('[DB:guard] Rejected nudge insert — nudge messages must remain ephemeral');
      return 'rejected-nudge';
    }

    const id = uuid();
    this.db.prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, tool_calls, token_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null, tokenCount);
    return id;
  }

  getMessages(sessionId: string): any[] {
    return this.db.prepare(
      `SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC`
    ).all(sessionId).map((row: any) => ({
      ...row,
      tool_calls: row.tool_calls ? JSON.parse(row.tool_calls) : null
    }));
  }

  /**
   * CHAT-DUP (Phase-2 audit): Returns the most recently inserted row for
   * the given session + optional role filter.
   *
   * Used by the CHAT_SEND handler to dedup the "final assistant row" it
   * wants to write at end of agent loop against whatever the per-turn
   * persistMessage callback ALREADY wrote during the loop. If they match
   * byte-for-byte on content, we skip the duplicate insert and reuse the
   * existing row's id — preventing duplicate assistant messages on
   * history reload.
   *
   * Ordering is by rowid (autoincrement) rather than timestamp because
   * timestamps are 1-second-resolution in SQLite and multiple inserts
   * can share a timestamp — rowid is the only true "last inserted"
   * oracle.
   */
  getLastMessage(sessionId: string, role?: string): any | null {
    const row = role
      ? this.db.prepare(
          `SELECT * FROM chat_messages WHERE session_id = ? AND role = ?
           ORDER BY rowid DESC LIMIT 1`
        ).get(sessionId, role) as any
      : this.db.prepare(
          `SELECT * FROM chat_messages WHERE session_id = ?
           ORDER BY rowid DESC LIMIT 1`
        ).get(sessionId) as any;
    if (!row) return null;
    return { ...row, tool_calls: row.tool_calls ? JSON.parse(row.tool_calls) : null };
  }

  /** Sprint 35: Delete all messages for a session (used by New Task / chat clear) */
  deleteMessages(sessionId: string): number {
    const result = this.db.prepare(
      `DELETE FROM chat_messages WHERE session_id = ?`
    ).run(sessionId);
    return result.changes;
  }

  // ─── Tasks ─────────────────────────────────────────
  createTask(sessionId: string, title: string, description = ''): string {
    const id = uuid();
    this.db.prepare(
      `INSERT INTO tasks (id, session_id, title, description) VALUES (?, ?, ?, ?)`
    ).run(id, sessionId, title, description);
    // Record initial transition
    this.addTaskTransition(id, '', 'TASK_CREATED', 'Task created');
    return id;
  }

  updateTaskStatus(taskId: string, newStatus: string, reason = ''): void {
    const task = this.db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(taskId) as any;
    if (!task) return;
    const oldStatus = task.status;
    this.db.prepare(
      `UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(newStatus, taskId);
    this.addTaskTransition(taskId, oldStatus, newStatus, reason);
  }

  addTaskTransition(taskId: string, fromStatus: string, toStatus: string, reason = ''): void {
    this.db.prepare(
      `INSERT INTO task_transitions (id, task_id, from_status, to_status, reason)
       VALUES (?, ?, ?, ?, ?)`
    ).run(uuid(), taskId, fromStatus, toStatus, reason);
  }

  getTasks(sessionId: string): any[] {
    return this.db.prepare(
      `SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC`
    ).all(sessionId).map((row: any) => ({
      ...row,
      file_scope: JSON.parse(row.file_scope || '[]'),
      acceptance_criteria: JSON.parse(row.acceptance_criteria || '[]'),
      verification_evidence: JSON.parse(row.verification_evidence || '[]')
    }));
  }

  getTaskTransitions(taskId: string): any[] {
    return this.db.prepare(
      `SELECT * FROM task_transitions WHERE task_id = ? ORDER BY timestamp ASC`
    ).all(taskId);
  }

  getAllTasks(): any[] {
    return this.db.prepare(
      `SELECT * FROM tasks ORDER BY created_at DESC`
    ).all().map((row: any) => ({
      ...row,
      file_scope: JSON.parse(row.file_scope || '[]'),
      acceptance_criteria: JSON.parse(row.acceptance_criteria || '[]'),
      verification_evidence: JSON.parse(row.verification_evidence || '[]')
    }));
  }

  // ─── Activity Events ───────────────────────────────
  logActivity(sessionId: string, type: string, title: string, description = '', metadata = {}, status = 'success'): string {
    const id = uuid();
    this.db.prepare(
      `INSERT INTO activity_events (id, session_id, type, title, description, metadata, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, sessionId, type, title, description, JSON.stringify(metadata), status);
    return id;
  }

  getActivity(sessionId?: string): any[] {
    if (sessionId) {
      return this.db.prepare(
        `SELECT * FROM activity_events WHERE session_id = ? ORDER BY timestamp DESC LIMIT 100`
      ).all(sessionId).map((r: any) => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));
    }
    return this.db.prepare(
      `SELECT * FROM activity_events ORDER BY timestamp DESC LIMIT 100`
    ).all().map((r: any) => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));
  }

  // ─── Diff Records ──────────────────────────────────
  addDiff(sessionId: string, taskId: string | null, filePath: string, oldContent: string, newContent: string): string {
    const id = uuid();
    this.db.prepare(
      `INSERT INTO diff_records (id, session_id, task_id, file_path, old_content, new_content)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, sessionId, taskId, filePath, oldContent, newContent);
    return id;
  }

  getDiffs(sessionId: string): any[] {
    return this.db.prepare(
      `SELECT * FROM diff_records WHERE session_id = ? ORDER BY created_at DESC`
    ).all(sessionId);
  }

  // ─── MCP Servers ───────────────────────────────────
  saveMCPServer(config: any): string {
    const id = config.id || uuid();
    const existing = this.db.prepare(`SELECT id FROM mcp_servers WHERE id = ?`).get(id);
    const toolsJson = JSON.stringify(config.tools || []);
    const status = config.status || 'disconnected';
    const lastConnected = config.lastConnected || null;

    if (existing) {
      this.db.prepare(
        `UPDATE mcp_servers
         SET name=?, transport=?, command=?, args=?, env=?, url=?, remote_auth=?, enabled=?, status=?, tools=?, last_connected=?
         WHERE id=?`
      ).run(
        config.name,
        config.transport,
        config.command,
        JSON.stringify(config.args || []),
        JSON.stringify(config.env || {}),
        config.url || null,
        JSON.stringify(config.remoteAuth || {}),
        config.enabled ? 1 : 0,
        status,
        toolsJson,
        lastConnected,
        id,
      );
    } else {
      this.db.prepare(
        `INSERT INTO mcp_servers (id, name, transport, command, args, env, url, remote_auth, enabled, status, tools, last_connected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        config.name,
        config.transport,
        config.command,
        JSON.stringify(config.args || []),
        JSON.stringify(config.env || {}),
        config.url || null,
        JSON.stringify(config.remoteAuth || {}),
        config.enabled !== false ? 1 : 0,
        status,
        toolsJson,
        lastConnected,
      );
    }
    return id;
  }

  getMCPServers(): any[] {
    return this.db.prepare(`SELECT * FROM mcp_servers`).all().map((r: any) => ({
      ...r,
      args: JSON.parse(r.args || '[]'),
      env: JSON.parse(r.env || '{}'),
      remoteAuth: JSON.parse(r.remote_auth || '{}'),
      tools: JSON.parse(r.tools || '[]'),
      enabled: !!r.enabled
    }));
  }

  removeMCPServer(id: string): void {
    this.db.prepare(`DELETE FROM mcp_servers WHERE id = ?`).run(id);
  }

  // ─── Workspaces ─────────────────────────────────────
  saveWorkspace(ws: any): string {
    const id = ws.id || uuid();
    const existing = this.db.prepare(`SELECT id FROM workspaces WHERE id = ?`).get(id);
    if (existing) {
      this.db.prepare(
        `UPDATE workspaces SET name=?, local_path=?, remote_url=?, github_owner=?, github_repo=?,
         default_branch=?, last_opened_at=datetime('now'), mcp_server_id=?, status=? WHERE id=?`
      ).run(ws.name, ws.local_path || ws.localPath, ws.remote_url || ws.remoteUrl || null,
            ws.github_owner || ws.githubOwner || null, ws.github_repo || ws.githubRepo || null,
            ws.default_branch || ws.defaultBranch || 'main', ws.mcp_server_id || ws.mcpServerId || null,
            ws.status || 'active', id);
    } else {
      this.db.prepare(
        `INSERT INTO workspaces (id, name, local_path, remote_url, github_owner, github_repo,
         default_branch, cloned_at, last_opened_at, mcp_server_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?)`
      ).run(id, ws.name, ws.local_path || ws.localPath, ws.remote_url || ws.remoteUrl || null,
            ws.github_owner || ws.githubOwner || null, ws.github_repo || ws.githubRepo || null,
            ws.default_branch || ws.defaultBranch || 'main', ws.mcp_server_id || ws.mcpServerId || null,
            ws.status || 'active');
    }
    return id;
  }

  getWorkspaces(): any[] {
    return this.db.prepare(`SELECT * FROM workspaces WHERE status = 'active' ORDER BY last_opened_at DESC`).all();
  }

  getWorkspace(id: string): any | undefined {
    return this.db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id);
  }

  removeWorkspace(id: string): void {
    this.db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
  }

  updateWorkspacePath(id: string, newPath: string): void {
    this.db.prepare(`UPDATE workspaces SET local_path = ?, last_opened_at = datetime('now') WHERE id = ?`).run(newPath, id);
  }

  touchWorkspace(id: string): void {
    this.db.prepare(`UPDATE workspaces SET last_opened_at = datetime('now') WHERE id = ?`).run(id);
  }

  // ─── Project Context Snapshots ─────────────────────────
  saveProjectContextSnapshot(workspacePath: string, ruleFiles: any[], repoMap: any): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO project_context_snapshots (workspace_path, rule_files, repo_map, generated_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(workspacePath, JSON.stringify(ruleFiles || []), JSON.stringify(repoMap || {}));
  }

  getProjectContextSnapshot(workspacePath: string): any | null {
    const row = this.db.prepare(
      `SELECT * FROM project_context_snapshots WHERE workspace_path = ?`
    ).get(workspacePath) as any;
    if (!row) return null;
    return {
      ...row,
      rule_files: JSON.parse(row.rule_files || '[]'),
      repo_map: JSON.parse(row.repo_map || '{}'),
    };
  }

  saveProjectContextRetrieval(sessionId: string, workspacePath: string, query: string, chunks: any[]): string {
    const id = uuid();
    this.db.prepare(
      `INSERT INTO project_context_retrievals (id, session_id, workspace_path, query, chunks)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, sessionId, workspacePath, query, JSON.stringify(chunks || []));
    return id;
  }

  getProjectContextRetrievals(sessionId: string): any[] {
    return this.db.prepare(
      `SELECT * FROM project_context_retrievals WHERE session_id = ? ORDER BY generated_at DESC LIMIT 20`
    ).all(sessionId).map((row: any) => ({
      ...row,
      chunks: JSON.parse(row.chunks || '[]'),
    }));
  }

  saveDiagnosticsSnapshot(workspacePath: string, snapshot: any): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO workspace_diagnostics_snapshots
       (workspace_path, source, status, command, diagnostics, error, duration_ms, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      workspacePath,
      snapshot.source || 'typescript',
      snapshot.status || 'unavailable',
      snapshot.command || '',
      JSON.stringify(snapshot.diagnostics || []),
      snapshot.error || null,
      snapshot.durationMs || snapshot.duration_ms || 0,
      snapshot.generatedAt || new Date().toISOString()
    );
  }

  getDiagnosticsSnapshot(workspacePath: string): any | null {
    const row = this.db.prepare(
      `SELECT * FROM workspace_diagnostics_snapshots WHERE workspace_path = ?`
    ).get(workspacePath) as any;
    if (!row) return null;
    return {
      ...row,
      diagnostics: JSON.parse(row.diagnostics || '[]'),
    };
  }

  // ─── Settings (non-sensitive) ──────────────────────
  setSetting(key: string, value: string): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`
    ).run(key, value);
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
    return row?.value || null;
  }

  close(): void {
    this.db.close();
  }
}

let dbInstance: DatabaseManager | null = null;

export function getDatabase(): DatabaseManager {
  if (!dbInstance) {
    dbInstance = new DatabaseManager();
  }
  return dbInstance;
}
