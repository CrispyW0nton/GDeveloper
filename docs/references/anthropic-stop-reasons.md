# Anthropic stop_reason Contract

Source: https://docs.anthropic.com/en/docs/build-with-claude/tool-use

## stop_reason values

- `end_turn`: Model finished normally. No more tool calls needed.
- `tool_use`: Model wants to call one or more tools. Execute them and send results back.
- `max_tokens`: Output was truncated. May need to continue.
- `stop_sequence`: A custom stop sequence was hit.

## Canonical Agent Loop Pattern

```
while stop_reason === 'tool_use':
    execute_tools(response.tool_calls)
    response = send_tool_results()
# Loop exits when stop_reason is NOT 'tool_use'
```

This is the ONLY correct termination signal. No timers, no nudges, no external step counters.
