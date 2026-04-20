# GDeveloper Phase 2 Audit — Post-PR-#21

Second-pass audit commissioned after merging PR #21 (Sprint 38 chat UI
bugs + features + Phase-1 audit fixes). Focus area: **the chatbox** —
the central driver — traced end-to-end from renderer textarea to
Anthropic SSE stream to tool dispatcher to DB persistence. Audit
performed on commit `d156057` (tip of main post-merge).

All findings below were verified by opening the referenced file/line
and tracing the data flow manually, not guessed from filenames.

---

## Priority Matrix

| Pri | ID | Title | Severity | Effort | Area |
|---|---|---|---|---|---|
| **P0** | **CHAT-DUP** | Every agent-loop completion writes the final assistant message to DB **twice** | Critical / data integrity | Low | main/index.ts + agentLoop.ts |
| **P0** | **AGL-TRUNC** | Conversation truncation can generate *fresh* orphan tool_use blocks after pairing repair | Critical / 400 errors | Medium | providers/index.ts |
| P1 | MCP-SPAWN | `MCPClientManager.testConnection` spawns `server.command` with `shell: true` — undoes BUG-02 | High / security | Low | mcp/index.ts |
| P1 | MCP-HEARTBEAT | No MCP liveness ping → "dead but connected" servers | High / reliability | Medium | mcp/index.ts |
| P1 | MCP-TOGGLE | `toggleTool` mutates memory only; re-enables on app restart | Medium / UX | Low | mcp/index.ts + db/index.ts |
| P1 | CHAT-ABORT-UI | No Stop button in ChatWorkspace; only way to interrupt is a new send | Medium / UX | Low | ChatWorkspace.tsx |
| P1 | CHAT-SESS-LEAK | Session switch doesn't abort active stream — orphan SSE keeps eating tokens | Medium / cost | Medium | main/index.ts + preload |
| P1 | CACHE-DEAD | Prompt-caching code path declares `promptCachingEnabled: true`, recorder defined but never called, no `cache_control` markers set | Medium / cost | Medium | providers/index.ts |
| P2 | PATCH-FIRST | `patch_file` still first-occurrence-only; description explicitly says "first occurrence". No `replace_all` option | Medium / correctness | Low | tools/index.ts |
| P2 | LIST-EXCLUDE | `toolListFiles` only excludes `.git`, `node_modules`, `.worktrees`. Doesn't skip Python `__pycache__`, Rust `target`, Go `vendor`, `.venv`, `dist`, `build` etc. | Low / UX | Low | tools/index.ts |
| P2 | READ-LIMIT | `toolReadFile` hard 1 MB cap with no "truncate with notice" fallback — AI gets error instead of partial read | Medium / UX | Low | tools/index.ts |
| P2 | WRITE-NOLIMIT | `toolWriteFile` has no size cap at the tool layer (AI can bypass the 10 MB IPC cap when called via tool dispatch) | Medium / safety | Low | tools/index.ts |
| P2 | CHAT-RENDER-PERF | Token estimate recomputed on every render (O(n) over full message history) — long chats will lag | Low / perf | Low | ChatWorkspace.tsx |
| P2 | ATTACHMENT-IPC | Attachments serialized as `Array.from(Uint8Array)` — 1 MB file becomes ~4 MB JSON | Medium / perf | Low | ChatWorkspace.tsx |
| P2 | MCP-EVENTS-UNSUB | ChatWorkspace never subscribes to MCP `server_connected`/`server_disconnected` events; banner count is stale until session change | Low / UX | Low | ChatWorkspace.tsx + preload |
| P2 | CW-ERR-ROLE | Fetch-failure error message is role `'assistant'` (line 882); all other error messages use `'system'` | Low / UX consistency | Low | ChatWorkspace.tsx |
| P2 | TIMESTAMP-FMT | `chat_messages.timestamp` is SQLite text (`'YYYY-MM-DD HH:MM:SS'`) — mixes awkwardly with ISO-8601 timestamps the renderer generates | Low / future-bug | Low | db/index.ts |
| P3 | CW-SETTIMEOUT | `handleFollowupAction` uses `setTimeout(..., 0)` to sequence `setInput('')` before `executeSlashCommand` — cargo-cult race patch | Low / maintainability | Low | ChatWorkspace.tsx |
| P3 | PROV-ERR-LEAK | Raw Anthropic error text forwarded verbatim to renderer via `chat:stream-chunk` error event | Low / info-disclosure | Low | providers/index.ts |
| P3 | STOP-REASON-EMPTY | `event.type === 'message_stop'` is a no-op comment; unclear if we should record anything | Info | Zero | providers/index.ts |

---

## The Two P0 Bugs — Full Write-Ups

### P0 — CHAT-DUP: Final assistant message double-inserted per completion

**Severity:** Critical. Produces permanent DB corruption that compounds
every chat turn, visible as duplicated assistant messages on history
reload. Has been present since the Sprint-28 agent-loop rewrite.

**Path**

1. `runAgentLoop` in `src/main/orchestration/agentLoop.ts` invokes the
   `persistMessage` callback for every tool-using turn at line 435:

   ```ts
   options.persistMessage?.('assistant', result.content || '(tool execution)', toolCalls);
   options.persistMessage?.('user', toolResultMessage);
   ```

2. The callback wired in `src/main/index.ts:739-741` is literally:

   ```ts
   persistMessage: (role, content, toolCalls) => {
     db.insertMessage(sessionId, role, content, toolCalls);
   },
   ```

3. When the loop exits (via `attempt_completion`, `ask_followup_question`,
   `stuck_repeat`, `stuck_after_todo`, or `max_turns`), control returns
   to the CHAT_SEND handler — which at `src/main/index.ts:755` does:

   ```ts
   const msgId = db.insertMessage(sessionId, 'assistant', loopResult.content,
     loopResult.toolCalls.length > 0 ? loopResult.toolCalls : undefined);
   ```

4. `loopResult.content` is `lastContent` (final turn's streamed text).
   `loopResult.toolCalls` is `totalToolCalls` (accumulated across ALL
   turns). So:
   - Row N-1 (from `persistMessage`): `content = lastContent`,
     `tool_calls = [final turn's tool_use blocks]`.
   - Row N (from the handler): `content = lastContent` (same!),
     `tool_calls = [every tool_use block from every turn]`.

**Observable symptoms**

- After a 3-turn agent run, `chat_messages` has 7 rows instead of 6
  (user + 3× assistant-with-tools + 2× user-tool-results + 1 duplicate
  final assistant).
- `getChatHistory` returns the duplicate. Renderer renders it. User sees
  the AI's final message appear twice.
- Duplicate carries ALL tool calls → tool-card area at the end shows
  every tool ever run in that session as a single giant block.
- Context window gets polluted on the NEXT turn because `getMessages`
  returns the duplicate, and `ensureToolResultsFollowToolUse` then
  synthesizes MORE orphan results because the tool_use IDs in the
  duplicate row have no fresh result pairing.

**Fix shape**

Drop the redundant `db.insertMessage` at line 755. The per-turn
`persistMessage` calls already persist everything the UI needs. If we
want a canonical "final message id" for the return value, we can:
(a) have `persistMessage` return the inserted id and agentLoop track
the last id, or (b) query the DB for the most recent assistant row in
this session.

Alternative: skip per-turn persistence of the LAST turn when the loop
is about to return, and let line 755 handle it. But the current
structure already persists the per-turn turns during the loop for
crash-recovery, so removing the final duplicate is safer.

---

### P0 — AGL-TRUNC: Truncation can strip tool_results AFTER pairing repair

**Severity:** Critical. Produces Anthropic 400 errors that the user
experiences as "the chat just stopped working mid-session".

**Path**

`streamChatToRenderer` (`src/main/providers/index.ts:1047`) runs the
messages through TWO transforms, in this order:

1. `ensureToolResultsFollowToolUse(messages)` at line 1063 — fills in
   synthetic tool_results for any orphan tool_use blocks.
2. `truncateIfNeeded(cleanedMessages, ...)` at line 1070 — if the
   payload exceeds the model's budget, preserves `messages[0..1]` (the
   original task) + the last half OR quarter of the rest.

**The bug:** truncation may slice AWAY a tool_result that belongs to a
tool_use in the preserved `firstChunk`. After pairing runs and
truncation cuts, the resulting message list re-develops orphans:

```
Before truncation (after pairing repair):
  [0] user:      "Please refactor auth.ts"
  [1] assistant: { tool_use: read_file(auth.ts) } ← id tu_01
  [2] user:      "[Tool Result: read_file] ..."    ← result for tu_01
  [3] assistant: { tool_use: write_file(...) }
  [4] user:      "[Tool Result: write_file] ..."
  [5] …200 more messages…

After truncation (half-keep kept = messages[100:]):
  [0] user:      "Please refactor auth.ts"
  [1] assistant: { tool_use: read_file(auth.ts) } ← id tu_01 STILL HERE
  [2] user:      [TRUNCATION NOTICE]
  [3..] kept messages from index 100+
```

The tool_result for `tu_01` was at index 2 before, now GONE. Anthropic
returns `400 messages.2: Expected 'tool_result' block for tool_use_id
tu_01`.

**Fix shape**

The cleanest fix is "pairing-aware truncation": when truncation decides
what to drop, it must either drop the preserved tool_use **along with
its result** or preserve BOTH. Two implementation options:

1. Re-run `ensureToolResultsFollowToolUse` AFTER truncation (it already
   handles this case by injecting synthetic results — just needs to
   happen post-truncation too).
2. Smarter preservation: when `firstChunk` contains a tool_use,
   extend `firstChunk` to include the matching tool_result message.

Option (1) is a 2-line change. Option (2) is more principled. Both
should be tested with a prepared fixture.

---

## Medium-severity findings — Short descriptions

### MCP-SPAWN (security regression)
`MCPClientManager.testConnection` at `src/main/mcp/index.ts:361` runs:
```ts
spawn(server.command!, ['--version'], { shell: true, timeout: 5000 });
```
`server.command` comes from renderer-saved config and is subject to the
MCP_ADD_SERVER validator, but the validator only caps length (4096
chars) — doesn't forbid shell metacharacters. Combined with `shell:
true`, a malicious MCP config like `{ command: "rm -rf /; curl ..." }`
would execute. This bypasses the BUG-02 blocklist. Fix: drop `shell: true`
and pass `server.command` as the literal executable with `['--version']`
as argv.

### MCP-HEARTBEAT (BUG-06 from original audit, still open)
No periodic ping / health check / auto-reconnect for MCP connections.
Servers can go "dead but connected" (process alive but unresponsive).
`executeTool` will throw but `server.status` stays `CONNECTED` in the
UI. Scoped in the original audit as P2.

### MCP-TOGGLE (toggleTool doesn't persist)
`toggleTool(serverId, toolName, enabled)` at `mcp/index.ts:411` mutates
the in-memory `server.tools` array. `db.saveMCPServer()` (at `db/index.ts:251`)
never writes the `tools` column — it only updates `name, transport,
command, args, env, url, enabled`. So tool-level enable/disable is lost
on restart. Fix: extend `saveMCPServer` to persist `tools` (it's already
in the schema at line 77), and call it from `toggleTool`.

### CHAT-ABORT-UI
The `chat:abort` IPC channel exists (`src/main/index.ts:797`) and
correctly calls `ClaudeProvider.abortActiveStream()`. But there's no
Stop button in the chat UI. Only way to interrupt a runaway agent loop
is to start a new message (which triggers the abort in `streamMessage`
at line 556). With the 25-turn safety cap plus doom-loop detection,
this is less urgent than it was, but still needed.

### CHAT-SESS-LEAK
When the user switches sessions mid-stream, `ChatWorkspace`'s
`onStreamChunk` handler filters by sessionId and ignores wrong-session
chunks (line 352) — but the underlying SSE stream keeps going in the
main process. Tokens are still being generated + billed. The
`chat:abort` IPC could be triggered on session change but isn't.

### CACHE-DEAD
`SessionUsage.promptCachingEnabled: true` suggests prompt caching is
on, and `sessionUsage` tracks `cacheHits / cacheMisses / cacheReadTokens
/ cacheCreationTokens / estimatedSavings`. But:
- `recordCacheUsage(usage)` at `providers/index.ts:236` is defined and
  never called anywhere in the codebase (verified via grep).
- Neither `sendMessage` nor `streamMessage` add `cache_control` markers
  to the outbound body. Without markers, Anthropic doesn't cache.
So the tracking is dead code and the UI counters for "cache savings"
always read 0. Matches P4-03 from the original audit.

### PATCH-FIRST (BUG-07 from original audit, still open)
`patch_file` tool description at `tools/index.ts:126` still says
`"Finds the first occurrence of 'search' and replaces it with
'replace'."`. Implementation at line 699 uses `String.replace(searchStr,
replaceStr)` which is first-occurrence-only. `multi_edit` supports
`replace_all` but `patch_file` doesn't. Low-effort fix: add an optional
`replace_all?: boolean` input and branch between `.replace` and
`.replaceAll` / global regex.

---

## Phase-1 follow-on checks (green)

Re-audited every file touched by PR #21 to confirm the Phase-1 fixes
are still correct and didn't introduce follow-on bugs:

- **BUG-02** command-injection hardening: still in place. Blocklist
  regex in `bashCommand.ts` looks complete; `run_command` correctly
  routes through `isBlockedCommand`; `toolSearchFiles` correctly uses
  `execFileSync` with argv array. Clean.
- **BUG-03** usage recording: still wired correctly. `apiInputTokens /
  apiOutputTokens / usageRecordedFromAPI` flags route to a single
  post-loop `recordSessionUsage` + `getRateLimiter().recordUsage` call.
  Clean.
- **BUG-05** doom-loop: coexists cleanly with Sprint 27.5.1's
  `stuck_after_todo` guard (merge resolved in commit `36c2589`).
  Both reason-union variants present. Nudge/exit escalation is
  correct. Clean.
- **BUG-08** search extensions: `grep -rnI` + `--exclude-dir` list;
  no regression. Clean. BUT `toolListFiles` uses a different, much
  narrower exclusion list — see LIST-EXCLUDE.
- **BUG-09** max_tokens resolver: both call sites invoke
  `this.resolveMaxOutputTokens()`. Chain (cache → fallback → 4096)
  is correct. Clean.
- **BUG-10** model defaults: all hardcoded `'claude-3-5-sonnet-20241022'`
  literals in `src/main/**` now import `DEFAULT_MODEL_ID`. Clean.
- **SEC-02** IPC validation: validators.ts schemas registered for 8
  highest-risk channels; monkey-patch installed at the top of
  `registerIPCHandlers`. Note: MCP-SPAWN shows that the
  MCPServerConfig schema isn't strong enough to block shell
  metacharacter injection in `command` — this is a gap, not a
  regression, and is flagged above.

---

## Scope proposal for Phase 2 implementation

Recommend **splitting into 3 landable chunks** rather than one big PR:

### Chunk A — "Stop the bleeding" (P0 fixes only)
- Fix CHAT-DUP (drop the duplicate `db.insertMessage`)
- Fix AGL-TRUNC (re-run `ensureToolResultsFollowToolUse` post-truncation,
  or pairing-aware preservation)
- Add a regression test for each that inserts a known chat run into the
  DB and asserts exactly one final assistant row.

Effort: ~2-3 hours. Self-contained.

### Chunk B — "Chat UX polish" (P1 / P2 UI and MCP items)
- CHAT-ABORT-UI (Stop button)
- CHAT-SESS-LEAK (auto-abort on session switch)
- MCP-EVENTS-UNSUB (subscribe to MCP events → keep banner live)
- MCP-TOGGLE (persist tool enable/disable)
- CW-ERR-ROLE (consistency fix)
- CW-RENDER-PERF (memoize token estimate)

Effort: ~3-4 hours.

### Chunk C — "Security + MCP reliability"
- MCP-SPAWN (drop `shell: true`, execFile with argv)
- MCP-HEARTBEAT (periodic ping + auto-reconnect)
- Extend SEC-02 schema list for the remaining ~90 channels (boilerplate)
- Harden MCPServerConfig schema: reject shell metacharacters in
  `command`; validate URL scheme on `url`

Effort: ~4-5 hours.

### Deferred to dedicated sessions (already scoped in PHASE2-REFACTOR-PLAN.md)
- BUG-01 god-file decomposition
- PERF-01 async-IO conversion
- QUAL-02 test-suite foundation

### Optional Phase-3 targets (if and only if cost becomes a driver)
- CACHE-DEAD → actually implement prompt caching (P4-03 from original audit)
- AGL-TRUNC → replace chars/4 estimator with `@anthropic-ai/tokenizer`
  (PERF-03 from original audit)
- Patch_file → add `replace_all`
- Storage retention policy (original PERF-02)

---

## What's NOT in this audit

Deliberate omissions for focus:
- The Forge (app-adapter studio) subsystem — large, self-contained, not
  on the chatbox critical path.
- The Compare / merge3 subsystem — self-contained. No complaints
  surfaced in this session's audit.
- The worktree subsystem — wired through IPC but orthogonal to chat.
- Settings / theme / telemetry — stable, out of scope.
- The `src/renderer/App.tsx` tab router — reviewed quickly, no new
  findings.

If any of those surface issues in use, bring them up and I'll triage
separately.
