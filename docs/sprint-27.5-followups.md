# Sprint 27.5 Follow-ups

Known edge cases and future work items. Do NOT fix these now.

## Edge Cases

1. **MCP tool subprocess cleanup**: When an MCP tool times out via `AbortController`, the subprocess
   spawned by the MCP server may continue running. Needs a kill-signal propagation path from
   `toolExecutor.ts` → MCP manager → child process.

2. **Context-window overflow handling**: The agent loop does not check cumulative token usage against
   the model's context window limit. A long multi-turn session could exceed 200K tokens and receive
   a 400 error. Mitigation: add a pre-flight token estimate before each `streamTurn` call and
   compact the conversation if it exceeds 80% of the window.

3. **`pause_turn` stop_reason**: Anthropic may add a `pause_turn` stop_reason in future API versions.
   The current loop treats any unknown stop_reason as `end_turn`. This is safe but may not be optimal
   once `pause_turn` semantics are defined.

4. **Dead code in todoManager.ts**: The old `todoManager.ts` (Sprint 27) uses a different schema
   (five statuses, priorities, timestamps) than the new `taskTool.ts` (Sprint 27.5, three statuses,
   Claude Code schema). The old IPC handlers (`TODO_GET`, `TODO_CREATE`, etc.) still exist and could
   be removed once confirmed no UI relies on them.

5. **Old `task_plan` tool definition**: The tool definitions in `src/main/tools/index.ts` still
   include the old `task_plan` tool alongside the new `todo` tool. Consider removing `task_plan`
   once migration is validated.

6. **Settings panel placeholders**: The new "Agent Loop Settings" section uses static values
   (`maxTurns: 25`, `toolTimeout: 60`). Wire these to actual store state when the settings
   infrastructure supports dynamic agent loop config.

7. **Store cleanup**: The `src/renderer/store/index.ts` still exports the store hook with the
   auto-continue fields removed, but consumers that destructure `autoContinueEnabled` etc. would
   fail. All known consumers have been updated but any third-party or extension code would break.
