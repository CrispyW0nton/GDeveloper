# GDeveloper Roadmap Refresh: Book-Informed Product Direction

Updated after reviewing:

- Louise Macfadyen, *Designing AI Interfaces*
- Chip Huyen, *Designing Machine Learning Systems*
- Michael E. Miller and Christina F. Rusnock, *Integrating Artificial and Human Intelligence through Agent Oriented Systems Design*

## Executive Adjustment

The previous roadmap correctly pushed GDeveloper toward a "Vibe Coding OS": specs, worktrees, MCP, guardrails, verification, and multi-agent workflows. The new book review changes the emphasis:

GDeveloper should not merely add more agent features. It should become a **measurable human-AI teaming workspace** where every agent action has visible intent, clear responsibility, recoverable state, and feedback loops that improve practical reliability over time.

The strategic product promise becomes:

> GDeveloper helps developers safely direct AI coding work by making plans, uncertainty, responsibilities, evidence, and recovery paths visible.

## What Changes

### 1. Prioritize AI Interface Quality Before More Autonomy

From *Designing AI Interfaces*, the big product warning is that a plain chat box hides too much. It hides context, probability, latency, tool state, and uncertainty. GDeveloper already has a richer surface than chat, but it should now treat the whole workflow as an AI interface with three explicit layers:

- **Input:** specs, prompts, selected files, rules, active mode, active worktree, MCP permissions.
- **Computation:** visible plan, current tool call, wait state, retry state, cache status, uncertainty.
- **Output:** diff, evidence, tests, risk notes, alternatives, next action.

Roadmap impact:

- Add an **Intent Inspector** showing what context the model will receive before a run.
- Add **Plan Preview / Plan Agreement** before long-running autonomous work.
- Add **Computation State UX**: progress, current stage, tool queue, blocked/retrying state.
- Add **Uncertainty and Alternatives** to verification output.
- Add onboarding that teaches users GDeveloper is not search, not magic, and not a normal IDE.

### 2. Add Production Feedback Loops And Evals

From *Designing Machine Learning Systems*, the lesson is that deployment is not the finish line. Systems need evaluation, monitoring, data lineage, feedback loops, and measurable regressions.

For GDeveloper, prompts, providers, tools, specs, and agent runs are the production system.

Roadmap impact:

- Add an **Agent Eval Harness** for recurring tasks:
  - spec adherence
  - test honesty
  - diff minimality
  - build/test success
  - hallucinated file/path detection
  - user correction rate
- Add **Run Telemetry**:
  - provider/model
  - prompt size
  - context sources
  - tools used
  - retries
  - cost/tokens
  - duration
  - tests run
  - verification result
- Add **Feedback Capture**:
  - thumbs up/down per run
  - "accepted", "edited", "reverted", "verified", "failed in use"
  - user correction notes attached to specs/mementos
- Add **Artifact Lineage**:
  - which spec, prompt, rules, model, provider, MCP tools, and files produced a diff.

### 3. Treat Agents As Teammates With Responsibilities

From *Integrating Artificial and Human Intelligence*, the key model is not "AI replaces developer." It is **human-AI teaming**. Good teams need shared mental models, responsibility allocation, backup behaviors, observability, predictability, and directability.

Roadmap impact:

- Add an **Agent Responsibility Matrix**:
  - human owner
  - agent role
  - allowed files
  - allowed tools
  - approval gates
  - backup behavior
- Add **RASCI-style task ownership**:
  - Responsible: assigned agent
  - Accountable: user
  - Support: helper agents/tools
  - Consulted: verifier/model/tool
  - Informed: activity log/memento
- Add **Directability Controls**:
  - pause
  - redirect
  - narrow scope
  - change mode
  - require test first
  - forbid file paths
  - force verification
- Add **Backup Behaviors**:
  - if tests fail twice, stop and ask
  - if files outside scope are touched, halt
  - if model/tool unavailable, degrade to plan-only
  - if uncertainty is high, produce alternatives instead of editing

## Revised Roadmap

### Phase 5A: Test Readiness And Product Telemetry

Goal: make current GDeveloper testable as a real product.

Build:

- Testing guide and scenario matrix.
- Run telemetry schema.
- Agent run history panel.
- Feedback capture on assistant outputs.
- Artifact lineage for specs, prompts, model, tools, files, and verification.
- Eval seed suite for common coding tasks.

Definition of done:

- A tester can run a task, inspect what happened, rate the result, and reproduce the run context.

### Phase 5B: AI Interface Maturity

Goal: make agent behavior legible before, during, and after execution.

Build:

- Intent Inspector.
- Context preview before send.
- Plan Preview for long-running tasks.
- Computation state card with current stage, tool queue, retry state, and wait reason.
- Uncertainty and alternatives panel.
- First-run onboarding for AI coding mental models.

Definition of done:

- A user can answer: "What is the agent about to do, why, with what context, and how do I stop or redirect it?"

### Phase 5C: Human-AI Teaming Controls

Goal: turn specialist modes and worktrees into accountable agent teamwork.

Build:

- Agent Responsibility Matrix.
- RASCI allocation per spec/task/worktree.
- Directability controls for running agents.
- Backup behavior policies.
- Shared mental model panel: active spec, active rules, active mode, active file scope, active constraints.

Definition of done:

- A user can assign work confidently because every agent has a scope, role, owner, and fallback behavior.

### Phase 5D: Production-Grade Evaluation

Goal: measure whether GDeveloper is getting safer and more effective.

Build:

- Eval harness for spec-driven coding tasks.
- Verification scorecards.
- Prompt/provider regression comparisons.
- Test honesty checks integrated into evals.
- Token/cost/duration dashboards.
- Feedback-loop reports.

Definition of done:

- Every release can answer: "Did agent quality improve, regress, or merely change?"

### Phase 6: Controlled Autonomy

Goal: expand autonomy only after observability and directability are strong.

Build:

- Background agent runner.
- Scheduled agent execution.
- Multi-agent dependency board.
- Merge orchestration with gates.
- Human approval checkpoints.
- Mobile/remote agent steering.

Definition of done:

- Agents can work in the background without making the workspace feel mysterious or risky.

### Phase 7: Delight And Power

Goal: make the workspace feel fast, fun, and empowering without hiding complexity.

Build:

- Voice mode.
- Browser automation and visual bug fixing.
- More expressive Theme Studio presets.
- Shareable workflows/recipes.
- Lightweight team collaboration.
- Explainability panel for why code changed.

Definition of done:

- A developer feels fast and in control, not merely impressed.

## Updated Testing Priorities

Before broad testing, validate these product questions:

1. **Legibility:** Can the tester tell what the agent is doing and why?
2. **Directability:** Can the tester redirect or constrain the agent easily?
3. **Recovery:** Can the tester resume, verify, or roll back work without confusion?
4. **Workspace order:** Do `.gd/specs`, `.gd/tracers`, `.gd/memento`, task ledger, activity log, and diff view feel like useful memory rather than clutter?
5. **Trust calibration:** Does GDeveloper surface uncertainty and evidence clearly enough that users neither over-trust nor under-trust the agent?
6. **Practical power:** Does a small feature feel faster, safer, and more organized than using a normal AI chat tool?

## Immediate Next Build Recommendation

Do not jump straight to voice, mobile, or more autonomy.

The next development slice should be:

> **Phase 5A: Agent Run Telemetry + Artifact Lineage**

This is the backbone needed for product testing, evals, debugging, trust, and later enterprise readiness.

Minimum implementation:

- Persist each agent run as a structured record.
- Attach session id, workspace, active spec, active mode, provider/model, context sources, tools used, files touched, tests run, verification result, token/cost estimate, duration, and user feedback.
- Add a simple Run History panel or Activity Log detail view.
- Add tests proving runs are recorded and inspectable.

