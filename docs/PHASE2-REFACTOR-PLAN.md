# Phase 2 Refactor Plan — BUG-01 & PERF-01

Scoping doc for the two Phase-2 audit items that are too large for a
single drop-in commit. Each is its own multi-session project. Sequencing,
target module boundaries, risks, and a verification strategy are laid
out here so the work can start (and pause) without losing context.

Status as of this document: Phase 1 is complete (seven bug fixes + two
infrastructure commits landed on `genspark_ai_developer`). No Phase-2
work has started.

---

## BUG-01 — Decompose the `src/main/index.ts` god file

### Problem (verified)

- `src/main/index.ts` is 116 KB / 2422 lines / 100 `ipcMain.handle` calls.
- Every IPC handler, every cross-service wire-up, and most startup logic
  lives in one file.
- Effect: changing any handler means reading the whole file; two
  simultaneous edits collide constantly; individual handlers cannot be
  unit-tested because they close over the module-level singletons
  (`settings`, `db`, `github`, `providerRegistry`); new contributors
  cannot reason about state flow.

### Target end-state

```
src/main/index.ts                   // ~200 lines, thin bootstrapper
src/main/ipc/
  ├── index.ts                      // existing IPC_CHANNELS registry (unchanged)
  ├── validators.ts                 // existing SEC-02 schemas (unchanged)
  ├── settings.ts                   // SETTINGS_* + API_KEY_*
  ├── chat.ts                       // CHAT_SEND / CHAT_HISTORY / CHAT_CLEAR / CHAT_ABORT
  ├── github.ts                     // GITHUB_*
  ├── workspace.ts                  // WORKSPACE_*
  ├── mcp.ts                        // MCP_*
  ├── tools.ts                      // TOOL_LIST / TOOL_EXECUTE / TOOL_APPROVE
  ├── git.ts                        // GIT_*
  ├── terminal.ts                   // TERMINAL_*
  ├── filetree.ts                   // FILE_TREE_* / FILE_WRITE / FILE_CHECK_WRITABLE
  ├── model.ts                      // MODEL_*
  ├── rate-limit.ts                 // RATE_LIMIT_* / TOKEN_BUDGET_* / RETRY_STATE_*
  ├── session.ts                    // SESSION_USAGE_*
  ├── context.ts                    // CONTEXT_SUMMARIZE / CONTEXT_COMPACT
  ├── tasks.ts                      // TASK_*
  ├── roadmap.ts                    // ROADMAP_*
  ├── mode.ts                       // MODE_GET / MODE_SET / SLASH_COMMAND_*
  ├── discovery.ts                  // DISCOVERY_* / MIGRATION_*
  ├── env.ts                        // ENV_*
  ├── research.ts                   // RESEARCH_* / EXTERNAL_*
  ├── worktree.ts                   // WORKTREE_*
  ├── forge.ts                      // FORGE_*
  ├── attachment.ts                 // ATTACHMENT_*
  ├── compare.ts                    // COMPARE_*
  ├── todo.ts                       // TODO_*
  ├── checkpoint.ts                 // CHECKPOINT_*
  ├── verify.ts                     // VERIFY_*
  ├── orchestration.ts              // ORCHESTRATION_* / SETTINGS_*_ORCHESTRATION
  ├── sandbox.ts                    // SANDBOX_* + onSandboxEvent wiring
  ├── devconsole.ts                 // DEVCONSOLE_*
  └── discovery.ts                  // already listed; single module for DISCOVERY_*
```

Each module exports:

```ts
export function register(ctx: IPCContext): void;
```

`IPCContext` is a single `interface` injected into every module with the
shared handles previously closed over by the god file:

```ts
export interface IPCContext {
  mainWindow: BrowserWindow | null;
  settings: SecureSettings;
  db: Database;
  github: GitHubService;
  providerRegistry: ProviderRegistry;
  mcp: MCPClientManager;
  // …anything else that was a module-level singleton
}
```

`src/main/index.ts` shrinks to:

```ts
import * as chatIPC        from './ipc/chat';
import * as githubIPC      from './ipc/github';
// … one import per module …

function registerIPCHandlers(ctx: IPCContext): void {
  installValidationMonkeyPatch();   // SEC-02 (moved out of this fn)
  settingsIPC.register(ctx);
  chatIPC.register(ctx);
  githubIPC.register(ctx);
  // … one register call per module …
}
```

Plus app lifecycle code (app.on('ready'), createMainWindow, etc.) stays
in `index.ts`. That should fit in ~150-250 lines.

### Sequencing (incremental, commit-per-module)

The refactor is **sliceable** — do one module per commit, verify the
app still boots between each. Proposed order (safe → risky):

1. `settings.ts` (smallest, pure state)
2. `github.ts` (self-contained, mostly CRUD)
3. `roadmap.ts`
4. `tasks.ts`
5. `mode.ts` + slash commands
6. `model.ts`
7. `filetree.ts` + `terminal.ts`
8. `git.ts` (touches worktree, do these together)
9. `worktree.ts`
10. `mcp.ts` + `tools.ts` (tangled with providerRegistry; do together)
11. `chat.ts` + `orchestration.ts` (the hottest path; leave for last)
12. `forge.ts`, `compare.ts`, `todo.ts`, `checkpoint.ts`, `verify.ts`,
    `attachment.ts`, `devconsole.ts`, `sandbox.ts`, `rate-limit.ts`,
    `session.ts`, `context.ts`, `research.ts`, `env.ts`,
    `discovery.ts` — any order, all independent.

### Risk hotspots

- **Singletons captured by closures.** Any handler that references
  `mainWindow` from the enclosing scope (and there are many) must accept
  `ctx.mainWindow` as a parameter or read from `ctx` at call time —
  subtle re-introduction of stale refs is the #1 regression risk.
- **Handler *ordering* mattered.** Some registrations (e.g. streaming)
  install renderer-side subscriptions that other handlers reference.
  The `register(ctx)` calls must be invoked in the same logical order
  as today. Keep the order of `register()` calls identical to the order
  the corresponding `ipcMain.handle` appeared in `index.ts`.
- **SEC-02 monkey-patch placement.** It must still run BEFORE any
  module's register() is called. Move it to a helper
  `installValidationMonkeyPatch()` and call it first in the new bootstrap.
- **Large test-suite impact** — none of the existing unit tests import
  `src/main/index.ts` directly, so the refactor shouldn't break tests,
  but run the full suite after each slice anyway.

### Verification strategy

Each per-module commit:
1. `tsc --noEmit` clean
2. `npx vitest run` — same 4 pre-existing failures, zero new regressions
3. App boots via `npm run start` and the main window opens
4. Smoke-check the handlers moved in this slice actually respond (e.g.
   if you moved `settings.ts`, open Settings and verify it loads)

### Estimated effort

- 8-12 focused hours, spread across 3-5 sessions of 2-3 hours each.
- Budget one session per "hot-path" slice (chat, orchestration, mcp) —
  these need extra care.

---

## PERF-01 — Async file operations

### Problem (verified)

`src/main/tools/index.ts` uses 19 `*Sync` calls (plus 2 more in
`bashCommand.ts` and 1 in another tool file):
`readFileSync`, `writeFileSync`, `mkdirSync`, `readdirSync`, `statSync`,
`existsSync`, `execSync`. Every one of these blocks the Electron main
process — which is also the one handling window events, IPC, and
sandbox-log routing. During heavy tool use (multi-edit across 20 files,
a search in a large repo, a `run_command` with a 20-second timeout) the
UI freezes.

### Target end-state

Two changes:

1. **Convert sync file ops to async.** All tool handlers are invoked
   from async IPC handlers already, so adopting the async variants is
   a refactor, not an API break. Use `fs/promises`:

   ```ts
   import {
     readFile, writeFile, mkdir, readdir, stat, access,
   } from 'fs/promises';
   ```

   Replace each `readFileSync(path, 'utf-8')` with
   `await readFile(path, 'utf-8')`, etc.

2. **Convert `execSync` to `execFile` with a promisified wrapper.**
   BUG-02 already moved `toolSearchFiles` to `execFileSync`; PERF-01
   makes it async. `toolRunCommand` and `executeBashCommand` go async
   via `promisify(execFile)` — but keep the shell-mode option for
   bash_command (still needs shell semantics for pipes / redirects).

   ```ts
   import { execFile } from 'child_process';
   import { promisify } from 'util';
   const execFileAsync = promisify(execFile);
   ```

### Sequencing

All within `src/main/tools/`. One commit per tool function is the
cleanest review unit:

1. `toolListFiles` / `toolReadFile` — leaf file reads, safe and simple.
2. `toolSearchFiles` — already execFile-based after BUG-02; just promisify.
3. `toolWriteFile` / `toolMkdir` / `toolListDirectory` — file writes.
4. `toolGitStatus` / `toolGitDiff` / all `toolGit*` — exec-heavy.
5. `toolRunCommand` — convert to async execFile when no shell features
   are needed; promisify(execFile) with shell option for back-compat.
6. `executeBashCommand` (bashCommand.ts) — same treatment as above.
7. `executeMultiEdit` (multiEdit.ts) — file reads / writes.
8. `executeParallelSearch` / `executeParallelRead` — already chunk into
   parallel work, just swap the inner sync calls for async.

### Risk hotspots

- **Signature change propagation.** Every `toolXxx` function that
  currently returns `string` will become `Promise<string>`. The agent
  loop's tool dispatcher `options.executeTool` already returns a
  Promise, so the upstream API is unchanged; downstream callers that
  `await` are already correct. **But** the tool registry dispatcher in
  `tools/index.ts` itself (the big switch/case) needs to `await` every
  branch. Audit all return sites carefully.
- **Error-shape preservation.** `execSync` throws `err.stdout / err.stderr`
  on non-zero exit. `execFile` via promisify rejects with an Error that
  has the same fields — but double-check, because some wrappers lose them.
- **Performance of parallel read.** `executeParallelRead` currently
  loops synchronously and is slow because it serializes. Moving to
  `await Promise.all(paths.map(readFile))` is a net-negative blocking
  reduction AND a net-positive speedup — but only if the tool-level
  concurrency cap (currently implicit via sync loop) is enforced
  explicitly with something like `p-limit` to avoid hammering the disk.
- **Timeout semantics.** `execSync` timeout kills the child; promisified
  `execFile` does the same via `{ timeout }`, but the rejection shape
  differs slightly. Write a small integration test to pin this down.

### Verification strategy

- `tsc --noEmit` clean after each commit.
- Full vitest run after each commit — same 4 pre-existing failures,
  zero new regressions.
- Manual smoke: pick a tool-heavy task (e.g. "list the files in src
  and read 5 of them"), let the agent run, watch renderer responsiveness
  with DevTools → Performance while it runs. UI frames should stay at
  60fps; before this refactor they drop to ~10fps during file ops.
- Regression test for each tool's success AND error path — both the
  "happy path" `await readFile` AND the `await readFile` that rejects
  because the file doesn't exist.

### Estimated effort

- 6-8 focused hours, spread across 2-3 sessions.
- The bulk is mechanical; the thinking is in error-shape preservation.

---

## Cross-cutting notes

### Test-suite foundation (QUAL-02 / P3-05)

Both projects benefit from landing the test-suite foundation first.
Specific new test files to write before starting PERF-01:

- `tests/unit/agent-loop.test.ts` — exercise `batchSignature`, the
  3-nudge → 5-exit doom-loop escalation, and `runAgentLoop` with a
  mock provider that returns preset `message_delta` sequences.
- `tests/unit/providers-usage.test.ts` — lock in BUG-03's behaviour
  (`recordUsage` + `recordSessionUsage` called exactly once per stream,
  preferring API numbers over estimates).
- `tests/unit/tools-security.test.ts` — cover `isBlockedCommand` with
  every pattern from BUG-02 (positive and negative cases).
- `tests/unit/validators.test.ts` — cover `validateIPC` happy path,
  null-byte rejection, giant-string rejection, bad-URL rejection, bad
  MCP-config rejection.

Landing these tests BEFORE Phase 2 starts means both refactors have
instant regression coverage.

### Commit discipline

- Every commit in Phase 2 must leave `tsc --noEmit` clean and the app
  bootable. No "half-decomposed" commits.
- Prefer small, well-scoped commits over large "finished product" ones.
- Tag each commit body with the audit item it addresses (`BUG-01`,
  `PERF-01`) so changelog generation can filter by phase.
