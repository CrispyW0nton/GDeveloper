# GDeveloper 429 / MCP Audit (Audit Round 3)

Third-round audit focused specifically on the 429 rate-limit errors that
users hit when connecting MCP servers. Complements the previous rounds
(`docs/AUDIT-PHASE-2.md` is the general chatbox audit,
`docs/PHASE2-REFACTOR-PLAN.md` scopes the god-file and async-IO
refactors). This round's scope is narrower: **why does connecting 2-3
MCP servers cause the agent to start throwing 429s**, and what's the
minimum set of fixes that stops it.

Verified on commit `46aa96d` (post-PR-#22 main). Every finding below
has been traced to specific file:line locations.

---

## Verification report

| ID | Finding | Verification status | Evidence |
|---|---|---|---|
| **MCP-429-01** | Tool schemas re-sent on EVERY turn; no defer_loading | ✅ Confirmed | `src/main/providers/index.ts:530-540` — `streamMessage` unconditionally attaches `anthropicTools` to every API body. `runAgentLoop` runs up to 25 turns per user message. 50 tools × 300 tokens × 10 turns = 150k input tokens in a single minute, well over a Tier-2 user's 80k budget. |
| **MCP-429-02** | Pre-flight check is reactive, not predictive | ✅ Confirmed | `src/main/providers/rateLimiter.ts:83-96` — `preFlightCheck()` only inspects the already-consumed sliding window via `computeSnapshot()`. Nothing estimates the cost of the request that's about to be sent. A request that will blow past the window goes out anyway and gets 429'd at the server. |
| **MCP-429-03** | `estimateTokens` is `length/4`, systematically undercounts JSON | ✅ Confirmed | `src/main/providers/contextManager.ts` (PERF-03 from original audit). Tool schemas are JSON-Schema with `"description"`, `"properties"`, `"required"` — tokenizes poorly. Undercount of 30-50% means rate-limit % calculations are optimistic. |
| **MCP-429-04** | `providerTier: 'tier4'` hardcoded as default | ✅ **Confirmed + worse than audit described** | `src/main/providers/rateLimitConfig.ts:153` — `DEFAULT_TOKEN_BUDGET_CONFIG` hardcodes `providerTier: 'tier4'`. `BALANCED_CONFIG.softInputTokensPerMinute` = 400,000 (line 123), which is **10× a Tier-1 account's 40k/min hard limit**. Additionally: `validateSoftLimits()` (line 192) exists but is **never called** from anywhere — verified by repo-wide grep. Soft limits are never checked against hard limits, ever. |
| **MCP-429-05** | `ToolResultBudget` exists but is **dead code in the hot path** | ✅ Confirmed | `src/main/providers/toolResultBudget.ts:48-107` defines `processToolResult`. `src/main/orchestration/index.ts:192-200` wraps it as `Orchestrator.processToolResult` / `planToolBatches`. `getOrchestrationEngine` IS imported in `src/main/index.ts:20` but **the methods `processToolResult`/`planToolBatches` are never invoked in the CHAT_SEND flow** — grep for `orchestrator.processToolResult` or `planToolBatches` returns zero non-definition matches. `src/main/index.ts:689` truncates inline with `content.substring(0, maxResultLen)` instead. MCP results can be arbitrarily large. |
| **MCP-429-06** | `planToolCallBatches` is dead code (tools run in simple for-loop) | ✅ Confirmed | `src/main/orchestration/agentLoop.ts:393-423` executes tools in a plain `for (const tc of toolCalls)` loop. `planToolCallBatches` is never called. No concurrency cap or batching. |
| **MCP-429-07** | No MCP heartbeat / auto-reconnect | ✅ Confirmed | Already flagged as `MCP-HEARTBEAT` in Phase-2 audit. `MCPClientManager.connectServer` connects once; no periodic ping. Dead servers produce tool-execution errors that prompt Claude to retry — each retry is a full API turn with all schemas re-sent. 429 amplifier. |
| **MCP-429-08** | System prompt **text** lists every MCP tool name (on top of the `tools` parameter) | ✅ Confirmed | `src/main/orchestration/promptBuilder.ts:126-128` pushes `"MCP tools: ${mcpNames.join(', ')}"` into the system prompt body. `src/main/index.ts:520-521` adds further inventory. Redundant — the model already sees the schemas via the `tools` parameter. ~500-1,000 tokens/turn of pure overhead. |
| **MCP-429-09** | `truncateIfNeeded` budget doesn't include tool-schema cost | ✅ Confirmed | `src/main/providers/index.ts:48-96` — the budget is `systemTokens + msgTokens`. Tool schemas are sent as a separate `tools` parameter and counted nowhere. 50 tools × 300 tokens = ~15k tokens "hidden" from the budget. Can cause silent server-side truncation or 400s. |
| MCP-429-10 | Banner threshold too permissive (20 tools) | ✅ Confirmed | `src/renderer/components/chat/ChatWorkspace.tsx:967` — I set `MCP_TOOL_BANNER_THRESHOLD = 20` in Sprint 38. Token pressure becomes significant at 8-10 tools. Trivially tunable. |
| MCP-429-11 | `/mcp-off` is server-level only | ✅ Confirmed | Design choice from Sprint 38. No way to disable individual tools from chat — requires the MCP settings tab. Low severity. |

### One additional finding surfaced during verification

**MCP-429-12** — **`validateSoftLimits` is never called.** `src/main/providers/rateLimitConfig.ts:192` defines a function that checks whether configured soft limits exceed the declared tier's hard limits. Grep confirms it has zero call sites. So:
- User picks a preset in Settings → no validation.
- App boots with default `tier4` + `400k/min` → no validation.
- Rate-limit headers parsed from every response → never compared to the configured tier.

This is a meta-bug behind MCP-429-04: even if the user manually picks a correct tier, there's no guard that their custom limits make sense.

---

## Severity and effort matrix

| Pri | ID | Title | 429 impact | Effort | Phase |
|---|---|---|---|---|---|
| P0 | MCP-429-01 | Defer MCP tool schemas (ToolSearch meta-tool pattern) | ⭐⭐⭐⭐⭐ (60-80% reduction) | High (multi-session) | 1 |
| P0 | MCP-429-02 | Predictive pre-flight (estimate this request's cost) | ⭐⭐⭐⭐ | Medium | 1 |
| P0 | MCP-429-04 | Auto-detect tier from `x-ratelimit-limit-input-tokens`; remove `tier4` default; call `validateSoftLimits` on startup and settings change | ⭐⭐⭐⭐ | Low-Medium | 1 |
| P0 | MCP-429-05 | Route MCP tool results through `ToolResultBudget.processToolResult` (kill inline substring truncation) | ⭐⭐⭐ | Medium | 1 |
| P1 | MCP-429-08 | Remove "MCP tools: ..." redundant block from system prompt text | ⭐⭐ | Low | 1 |
| P1 | MCP-429-09 | Include tool-schema cost in `truncateIfNeeded` budget | ⭐⭐ | Low-Medium | 2 |
| P1 | MCP-429-03 | Replace `length/4` with `@anthropic-ai/tokenizer` (PERF-03) | ⭐⭐ | Medium | 2 |
| P1 | MCP-429-07 | MCP heartbeat + auto-reconnect (already scoped as MCP-HEARTBEAT) | ⭐⭐ | Medium | 2 |
| P1 | MCP-429-12 | Call `validateSoftLimits` on startup, settings change, and after 429 | ⭐ | Low | 1 |
| P2 | MCP-429-06 | Activate `planToolCallBatches` / cap MCP calls per turn | ⭐⭐ | Low | 2 |
| P2 | Prompt-caching | Add `cache_control` markers for system + tools (CACHE-DEAD from audit 2) | ⭐⭐⭐ ($$) | Medium | 3 |
| P3 | MCP-429-10 | Drop banner threshold 20 → 10 | Low | Trivial | 1 |
| P3 | MCP-429-11 | Per-tool `/mcp-off <server/tool>` | Low | Medium | 4 |

---

## The big one: MCP-429-01 (defer_loading)

The audit names this as "the single highest-impact change." That's correct, and it's also the most architecturally invasive. Real-world breakdown:

**What Claude Code / OpenCode do** (cited from audit, not re-verified):
- Tools are sent in two forms:
  - **Stub form** — `{ name, one_line_description }` — included in every request. Cheap (~30 tokens/tool).
  - **Full form** — `{ name, description, input_schema }` — included only after the model calls a `ToolSearch` meta-tool that returns matching full schemas. That schema then "joins" the available tools for subsequent turns in the same loop.
- Anthropic's `defer_loading: true` on a tool definition is the serialization hook that makes this work.

**Scope of changes needed in GDeveloper**:
1. A new `DeferredToolRegistry` (probably `src/main/tools/deferredRegistry.ts`) that tracks per-turn which tools are "activated" (full schema) vs "stubbed".
2. A `tool_search` built-in tool that queries the registry.
3. Changes to `promptBuilder.ts` to emit stub form by default.
4. Changes to `streamMessage` to serialize the correct shape per tool.
5. Changes to `agentLoop.ts` to handle a `tool_search` result by augmenting the `tools` array mid-loop.
6. A migration strategy — it should be opt-in via a settings flag initially, so we can fall back while we shake out bugs.
7. Tests: deferred-tool activation, lazy-schema expansion, cross-turn persistence of activated tools.

Realistic effort: **1-2 dedicated sessions (6-10 hours)**. Testing matters — getting this wrong means the agent can't use tools it needs.

**Alternative that gets 80% of the win with 20% of the effort**: ship tool-count reduction first (disable local tools from the plan-mode tool list that the user rarely uses, let users disable unused MCP servers aggressively via the new banner). This is a UX nudge, not an architectural change. Can ship same day.

---

## Recommended execution sequence

Rather than trying to do Phase 1 in one sitting, I'd split it into landable slices ordered by **effort-to-impact ratio**:

### Slice 1 — "Same-day quick wins" (~1-2 hours)
- **MCP-429-10** — drop banner threshold 20 → 10.
- **MCP-429-08** — delete the redundant `MCP tools: ...` block from `promptBuilder.ts`. Saves 500-1k tokens/turn immediately.
- **MCP-429-12** — call `validateSoftLimits` on startup and on every `setTokenBudget` IPC.

### Slice 2 — "Tier detection + MCP result budgeting" (~2-3 hours)
- **MCP-429-04** — parse `x-ratelimit-limit-input-tokens` in `ClaudeProvider.validateKey()` and/or after each response; auto-detect tier; replace `tier4` default. Also surface detected tier in Settings UI.
- **MCP-429-05** — wire `getToolResultBudget().processToolResult()` into the CHAT_SEND executeTool callback for BOTH local and MCP tools. Kills the dead code claim and gives us proper retention.
- Regression tests for both.

### Slice 3 — "Predictive pre-flight + schema-aware truncation" (~2-3 hours)
- **MCP-429-02** — estimate `this` request's cost (systemTokens + toolSchemaTokens + msgTokens) and subtract from remaining window; delay or warn if it would overflow. Not perfect (estimates are still chars/4) but closes the biggest gap.
- **MCP-429-09** — include tool-schema cost in `truncateIfNeeded`'s budget calculation.

### Slice 4 — "Deferred tool loading" (~6-10 hours, 1-2 sessions)
- **MCP-429-01** — the big architectural change. Separate PR, opt-in settings flag, extensive tests.

### Deferred to later passes
- **MCP-429-03** (accurate tokenization) — wait until `@anthropic-ai/tokenizer` is vetted against our test suite.
- **MCP-429-07** (MCP heartbeat) — already tracked in Phase-2 audit.
- **Prompt caching** — substantial, needs its own dedicated session.
- **MCP-429-06** — low-priority once defer_loading lands.
- **MCP-429-11** — UX polish.

---

## What's NOT in this audit

- The non-429 Phase-2 items (CHAT-ABORT-UI, CHAT-SESS-LEAK, etc.) still live in `docs/AUDIT-PHASE-2.md` Chunks B/C and are unchanged.
- BUG-01 god-file and PERF-01 async-IO are still scoped in `docs/PHASE2-REFACTOR-PLAN.md`.
- Verification of external claims (Claude Code's `defer_loading` syntax, specific Anthropic header names for tier detection) was NOT performed. Those claims come from the audit text. Before implementing Slice 4, we should pin the exact Anthropic API spec.

---

## References (from the audit, not re-verified)

| Project / Doc | Pattern |
|---|---|
| Claude Code | `defer_loading: true`, ToolSearch meta-tool, 5-layer context pipeline |
| Cline | Cross-turn similarity detection, 10-tool warning threshold |
| OpenCode | `defer_loading` passthrough (issue #23298), reasoning-loop guard (PR #12623) |
| Anthropic docs | Prompt caching, tool-use pricing, rate-limit headers |
| arXiv 2604.14228 | Five context-reduction strategies analysis |
