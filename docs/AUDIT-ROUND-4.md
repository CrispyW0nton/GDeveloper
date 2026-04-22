# GDeveloper Audit Round 4 — User-reported Chat-Box Bugs

Fourth-round audit from the seven specific bugs reported by the user
after Rounds 1-3 shipped. Every finding below was traced to
specific file:line locations on commit `72d6841` before this doc was
written. None of these findings are duplicates of the earlier audits —
they are fresh, concrete, actionable.

## Summary table

| Pri | ID | Bug | Status |
|---|---|---|---|
| **P0** | **CTX-COMPACT-STUB** | `/compact` + Compact button + `context:compact` IPC are a **complete no-op** | Confirmed |
| **P0** | **TOKEN-CUMULATIVE-MISMATCH** | TokenCounter shows "cumulative input tokens ever sent" vs "max context" — the fraction is semantically wrong and climbs to 100%+ in normal use | Confirmed |
| **P0** | **TURN-OVERWRITE** | In multi-turn agent loops, each turn's streamed text **overwrites** the previous turn's in the UI. User sees "my answer got replaced by a follow-up message" | Confirmed |
| **P0** | **BLANK-ASSISTANT-MSG** | When `loopResult.content === ''` (terminal-tool-only turn, stuck_repeat, etc.) the renderer pushes a blank assistant message | Confirmed |
| P1 | **FRESH-CHAT-DOES-NOT-RESET-RATE-LIMITER** | `CHAT_CLEAR` resets `sessionUsage` but NOT `rateLimiter` or `retryHandler`. Sliding-window counters keep charging from the previous conversation | Confirmed |
| P1 | **TOOLRESULT-AS-USER-ON-RELOAD** | On history reload, the persisted `role: 'user'` messages containing `[Tool Result: …]` render as user bubbles labeled "You" | Confirmed (carried from Phase-2 audit as `CHAT-HIST-TOOLS`) |
| P1 | **EDITOR-FOCUS** | Clicking a file in the tree opens the CodeEditor but the `<textarea>` never auto-focuses — user has to click again before typing works | Confirmed |
| P2 | MCP-429-01 follow-up | Still in the 429 path but architecturally big — defer_loading is the remaining single biggest fix | Carried from AUDIT-MCP-429 |

---

## Evidence per bug

### CTX-COMPACT-STUB — `/compact` / Compact button are no-op (P0)

`src/main/index.ts:2517-2523`:

```ts
ipcMain.handle(IPC_CHANNELS.CONTEXT_SUMMARIZE, async (_event, _sessionId: string) => {
  return { success: true, message: 'Context summarized' };
});

ipcMain.handle(IPC_CHANNELS.CONTEXT_COMPACT, async (_event, _sessionId: string) => {
  return { success: true, message: 'History compacted' };
});
```

The underscore-prefixed parameters and the trivial return give it away: these
handlers do nothing. Yet:

- `src/main/providers/contextManager.ts:302-316` has a fully-implemented
  `compactHistory(messages, keepLast)` method that summarises older messages
  and returns `{ kept, summary, trimmedCount }`.
- `src/renderer/components/chat/ChatWorkspace.tsx:574` wires the `/compact`
  slash command to `api.compactHistory(session.id)` (which invokes the stub).
- `src/renderer/components/chat/ChatWorkspace.tsx:1443` wires the "Compact"
  composer-footer button to the same stub.

Consequence: every user attempt to compact history silently succeeds and
changes nothing. The `ContextManager.compactHistory` work is dead code.

**Fix shape**: wire the real implementation. The compact flow needs to:

1. Pull the session's messages from the DB (`db.getMessages(sessionId)`).
2. Call `getContextManager().compactHistory(messages, keepLast=5)` to get
   `{ kept, summary, trimmedCount }`.
3. Replace the session's messages in the DB with `[summary, ...kept]` (delete
   old rows, insert new ones — or mark a summary anchor so pagination works).
4. Emit a renderer event so the chat UI reloads from DB.
5. Also reset `sessionUsage` since we've shrunk the actual conversation.

### TOKEN-CUMULATIVE-MISMATCH — TokenCounter's denominator math is wrong (P0)

`src/main/providers/index.ts:225-233` (recordSessionUsage):

```ts
function recordSessionUsage(input: number, output: number, contextMax?: number): void {
  sessionUsage.lastInputTokens = input;
  sessionUsage.lastOutputTokens = output;
  sessionUsage.cumulativeInputTokens += input;     // ← monotonically GROWS
  sessionUsage.cumulativeOutputTokens += output;
  sessionUsage.cumulativeRequests += 1;
  sessionUsage.contextWindowUsed = sessionUsage.cumulativeInputTokens;  // ← BUG
  if (contextMax) sessionUsage.contextWindowMax = contextMax;
}
```

`contextWindowUsed` is set to `cumulativeInputTokens`, the **sum** of every
input ever sent in the session. But the TokenCounter UI at
`src/renderer/components/chat/TokenCounter.tsx:66-67` uses it to compute a
percentage against `contextWindowMax` (default 200_000) and trips the
red warning at ≥95%:

```ts
const contextMax = usage.contextWindowMax || maxContextTokens;
const contextPercent = contextMax > 0 ? usage.cumulativeInputTokens / contextMax : 0;
```

So after a 25-turn agent loop where each turn's API payload is ~8k tokens,
`cumulativeInputTokens` = 200k → UI says "Context nearly full! Consider
/clear or Compact." — even though the CURRENT payload for the next turn
might be only 40k.

Two things wrong here:
1. Semantic: "cumulative tokens ever sent" ≠ "current context window usage".
2. Missing: no automatic consolidation when approaching the limit — the UI
   suggests the user manually press `/clear`, but the button for that is
   the stub above.

**Fix shape**:
- Replace `contextWindowUsed = cumulativeInputTokens` with the LAST
  request's payload size: `contextWindowUsed = input` (the actual
  most-recent input-token count, which is what matters for the NEXT
  request's context).
- Auto-trigger `compactHistory` when the real current payload
  (system + tools + messages) exceeds some threshold (say 80% of
  `getMaxAllowedSize(model)` = 128k for Claude). This is what
  Genspark AI Developer does automatically per user's observation.
- Fix the TokenCounter to show "current context" not "ever-sent sum".

### TURN-OVERWRITE — earlier turns' text vanishes in multi-turn UI (P0)

`src/renderer/components/chat/ChatWorkspace.tsx:351-362` (stream handler):

```ts
const unsubscribe = api.onStreamChunk((data: any) => {
  if (data.sessionId !== session.id) return;
  if (data.type === 'text') {
    const content = data.fullContent || '';
    // ...
    streamingContentRef.current = content;
    setStreamingContent(content);        // ← REPLACES, doesn't append
  }
  ...
  else if (data.type === 'done') {
    streamingContentRef.current = '';
    setStreamingContent('');              // ← clears between turns
  }
});
```

And the UI at `ChatWorkspace.tsx:1218-1222` shows a SINGLE "in-progress"
bubble containing only the current `streamingContent`. When a multi-turn
agent-loop runs:

- Turn 1 streams "I'll check auth.ts first..." → user sees it.
- Tool runs. `done` chunk fires. `streamingContent = ''`.
- Turn 2 streams "The auth.ts file uses JWT..." → user sees only turn 2.
- `handleSend`'s `await api.sendMessage` resolves with `loopResult.content`
  which is the FINAL turn's text (per `lastContent` in agentLoop).
- One assistant message pushed — with only the final turn's content.

User-visible effect: "I asked a plain-text question, the AI wrote a good
answer, then that answer got immediately overwritten by a different
message." That's exactly what the user reported.

**Fix shape**: on `done` chunks with non-empty `streamingContent`, materialise
the current content as a committed assistant message in `messages[]` and
then clear `streamingContent`. When `api.sendMessage` finally resolves,
dedupe against the last committed message (same shape as the CHAT-DUP fix
in the DB layer from PR #22). The result: each turn's narration is
preserved and displayed as its own assistant bubble.

### BLANK-ASSISTANT-MSG — empty final content pushes an empty bubble (P0)

`src/renderer/components/chat/ChatWorkspace.tsx:853-869` (handleSend's success path):

```ts
const assistantMsg: Message = {
  id: result.id || `msg-${Date.now() + 1}`,
  role: 'assistant',
  content: sanitizeContent(result.content),  // ← can be ''
  toolCalls: result.toolCalls?.map(...),
  timestamp: new Date().toISOString(),
};
setMessages(prev => [...prev, assistantMsg]);
```

Paths that produce empty `loopResult.content`:
- Agent loop exits with `reason: 'stuck_repeat'` / `'stuck_after_todo'` /
  `'no_tools'` — `lastContent` may be the stale last streaming text or ''.
- Terminal turn consists only of `attempt_completion` with an empty
  `completionResult.result` field (some models do this on short requests).
- `max_tokens` exit mid-stream with no text emitted.
- Rare: streaming errors early, `fullContent` never populates.

Either of those two push a completely blank "GDeveloper" bubble, which is
what the user described as "sometimes the AI responds with blank messages
and fails to be able to generate a response."

**Fix shape**: in `handleSend`, before pushing `assistantMsg`, check
if `trimmedContent` (and toolCalls) are both empty → push a system-role
diagnostic message instead ("GDeveloper exited without output
(reason: <exitReason>). Try rephrasing or use /compact to free context.").
Fall back to the empty-bubble-style skip only as a last resort.

### FRESH-CHAT-DOES-NOT-RESET-RATE-LIMITER (P1)

`src/main/index.ts:903-942` (CHAT_CLEAR handler):

- Line 905: `db.deleteMessages(sessionId)` ✓
- Line 909: `resetSessionUsage()` ✓
- Line 912: `clearActivePlan(sessionId)` ✓
- Line 917-926: emits plan-clear event ✓
- Line 929-936: emits `session-cleared` agent loop event ✓

But NOT:
- `rateLimiter.reset()` — the sliding-window counters from the previous
  conversation's last 60 seconds still charge against the fresh chat.
- `retryHandler.reset()` / `getRetryHandler()` — retry state could still
  reflect a previous 429.

Additionally, **`sessionUsage` is module-global in
`src/main/providers/index.ts:234` — not per-session**. If the user
switches between sessions without clicking Fresh Chat, the token counter
shows the accumulated total across all sessions. Session switching
(selecting a different chat) does NOT currently reset `sessionUsage`.

**Fix shape**:
- Add `rateLimiter.reset()` + `retryHandler.reset()` calls to CHAT_CLEAR.
- Decide (with user) whether session-switch should ALSO reset the counters,
  or whether the counters should be per-session maps. Per-session is more
  correct but requires a bigger refactor; resetting on switch is the
  smaller fix that matches the user's mental model.

### TOOLRESULT-AS-USER-ON-RELOAD (P1)

`src/renderer/components/chat/ChatWorkspace.tsx:321-345` (history loader):

```ts
api.getChatHistory(session.id).then((history: any[]) => {
  if (history && history.length > 0) {
    const dbMessages: Message[] = history.map((m: any) => ({
      id: m.id,
      role: m.role,                 // ← takes DB role verbatim
      content: sanitizeContent(m.content),
      toolCalls: m.tool_calls?.map(...),
      timestamp: m.timestamp,
    }));
    setMessages(dbMessages);
  }
});
```

The agent loop persists tool results as `role: 'user'` messages in the DB
(Anthropic's tool-result format). Examples from `persistMessage` call-sites
in `agentLoop.ts`:

- `options.persistMessage?.('user', toolResultMessage)` where
  `toolResultMessage` is `[Tool Result: read_file]\n...\n\n[Tool Result: …]\n…`.

When the user reloads the session, these rows render as user bubbles
labeled "You". That's the "AI posts as me during tool calls" bug — except
it's not during tool calls, it's on history reload after tool calls.

Render code at `ChatWorkspace.tsx:1132-1134`:

```tsx
{msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : msg.role === 'command' ? 'Command' : 'GDeveloper'}
```

So any `role: 'user'` with tool-result content looks like the user typed it.

**Fix shape**: detect "synthetic" user messages in the history loader —
any user row whose content starts with `[Tool Result:` — and either
(a) drop them from the display list entirely (they're for the model, not
the human), (b) fold them into the preceding assistant message's tool
cards for display, or (c) render them as a special "Tool Result" role
with a different style.

Option (a) is the simplest and matches most other chat UIs. The DB rows
remain untouched (needed for agent-loop context reconstruction on next
send).

### EDITOR-FOCUS — CodeEditor textarea never auto-focuses on file open (P1)

`src/renderer/components/editor/CodeEditor.tsx:112-115`:

```ts
// Sync content when file changes externally (AI edit / file switch)
useEffect(() => {
  setContent(file.content);
}, [file.content, file.filePath]);
```

This effect re-initialises `content` when the file changes but never
focuses the `<textarea ref={editorRef}>` at line 480. Clicking a file in
the tree opens it in the editor pane, but the textarea has no focus — the
user has to click into it before typing works.

**Fix shape**: add a second useEffect that keyed on `file.filePath` (and
`file.isBinary`/`isOutsideWorktree`) that calls `editorRef.current?.focus()`
when the file switches AND the editor is editable. Use `setTimeout(0)` or
`requestAnimationFrame` to defer past React's layout pass so the textarea
is mounted before focus() runs.

---

## Priority-ordered execution plan

Four P0s + three P1s, sequenced by effort and dependency.

### Chunk A — "The chat actually works again" (all four P0s; ~3-4h)

1. **CTX-COMPACT-STUB** — wire the stub handlers to the real
   `ContextManager.compactHistory`, replace DB rows, emit reload event.
2. **TOKEN-CUMULATIVE-MISMATCH** — change `contextWindowUsed` semantics
   to last-request size; add auto-compact trigger at ≥80% of model budget.
3. **TURN-OVERWRITE** — materialise intermediate turns into committed
   assistant messages on `done` chunks; dedupe on final send resolve.
4. **BLANK-ASSISTANT-MSG** — show a diagnostic system message instead of
   a blank assistant bubble when `loopResult.content` is empty.

These are coupled: (1) is depended on by (2)'s auto-compact trigger, and
(3) + (4) both need to cooperate on the dedup logic against the handoff
from streaming → final message.

### Chunk B — "Fresh chat means fresh" + "AI stops posting as me" (~1-2h)

5. **FRESH-CHAT-DOES-NOT-RESET-RATE-LIMITER** — add `rateLimiter.reset()`
   + `retryHandler.reset()` to `CHAT_CLEAR`. Decide session-switch
   behaviour (confirm with user).
6. **TOOLRESULT-AS-USER-ON-RELOAD** — filter tool-result user rows out of
   the renderer's display list on history load. Preserve in DB for the
   agent loop.

### Chunk C — Polish (~15m)

7. **EDITOR-FOCUS** — two-line useEffect. Trivial.

### Deferred (carries over from earlier rounds)

- **MCP-429-01** (defer_loading) — the remaining 429 driver. Big
  architectural project; own PR.
- `docs/AUDIT-PHASE-2.md` Chunks B / C.
- `docs/PHASE2-REFACTOR-PLAN.md` (god file + async IO).

---

## What's not in this audit

- Still unresolved: `CACHE-DEAD`, `MCP-HEARTBEAT`, `MCP-SPAWN`, the
  remaining SEC-02 schemas, and all the standard refactor-debt items.
- External claims about "Genspark AI Developer auto-consolidation" are
  not re-verified — the behaviour described (auto-compact when context
  threshold crossed) is the right *pattern*, which is what Chunk A
  implements.
