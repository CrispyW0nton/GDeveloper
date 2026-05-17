# GDeveloper Testing Guide

This guide is the Phase 5A practical test pass for the current desktop app. It focuses on whether a vibe developer can start useful work, keep the workspace organized, and see enough evidence to trust the agent.

## Setup

From the repository root:

```powershell
npm install
npm run typecheck
npx vitest run tests\unit\agentEvals.test.ts tests\unit\agentRunTelemetry.test.ts tests\unit\specDriven.test.ts tests\unit\contextCache.test.ts tests\unit\guardrails.test.ts
npm run build
npm run dev
```

Use a small real repository for the manual pass. The best target is a project with a test command that completes in under two minutes.

## Manual Scenario Matrix

| Area | Action | Expected Evidence |
| --- | --- | --- |
| Eval Scenarios | Run `/evals list` | Chat shows built-in scenarios with recommended modes and prompts. |
| Agent Run Score | Complete one agent run, then run `/evals score latest` | Chat shows a 0-100 score, grade, and failed checks. |
| Activity Log | Open Activity Log after an agent run | Agent Run History shows provider/model, mode, status, lineage, feedback buttons, and a score badge. |
| Spec Mode | Run `/spec create # Tiny Change...`, then `/spec active` | Spec has an ID/path, acceptance criteria, task tree, and active prompt. |
| Spec Execution | Run `/spec run`, paste/send the generated prompt | The run links to active spec context and records files/tests when used. |
| Guardrails | Send a fake secret-like string to `scanGuardrails` or the configured UI path | Secret is blocked or redacted before model send. |
| Memento | Run `/memento tester handoff` | `.gd/memento` receives a markdown handoff file. |
| Tracer Bullet | Run `/tracer add import validation` | `.gd/tracer-bullets` receives a small task ladder and Vibe Loop moves to Decompose. |
| Worktree Board | Create or list a task worktree | Board/task surfaces show branch, path, status, and merge gate context. |
| MCP Controls | Open MCP marketplace/permissions/audit flows | Installs require permission context, and calls appear in audit history. |

## Eval Score Interpretation

- `excellent` means the run completed with tool lineage, file lineage, tests, clean exit, and feedback.
- `good` means the run is usable but may be missing one trust signal.
- `needs_review` means the developer should inspect the diff before relying on the result.
- `risky` means the run likely lacks the evidence needed for practical use.

The score is intentionally evidence-weighted. A useful coding run should leave receipts: tools used, files touched, tests run, linked spec/context, and human feedback.

## Tester Notes

Capture these notes during manual testing:

- Did the first screen make it clear where to start?
- Did the workspace feel organized after 15 minutes?
- Did the Activity Log explain what the agent actually did?
- Did any command claim success without tests or file evidence?
- Did the developer feel confident enough to accept, edit, or reject the result?

Use `/evals score latest` after each meaningful run and compare the score against the tester's gut feeling. Mismatches are product feedback: either the scoring rubric is too strict, or the UI is hiding important evidence.
