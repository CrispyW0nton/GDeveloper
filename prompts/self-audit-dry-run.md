# Self-Audit Dry Run — Sprint 27.1

## Purpose

This prompt exercises GDeveloper's D19 pre-flight audit capabilities
against its own codebase. It validates that all Sprint 27.1 hardening
blocks are functional without requiring an external repository.

## Pre-conditions

1. GDeveloper is running with a workspace pointing at its own repository.
2. An API key is configured (the audit runs in Plan mode — no writes needed).
3. The Sprint 27.1 branch has been built and passes `tsc --noEmit`.

## Dry-Run Steps

### Step 1: Switch to Plan mode with audit write-scope

```
/mode plan --write-scope audit/
```

Expected: Mode switches to PLAN. Write-scope set to `audit/`.

### Step 2: Run /status to verify repo state

```
/status
```

Expected: Shows branch, tracking, clean/dirty state, mode, write-scope,
rate-limit snapshot, and tool counts.

### Step 3: Load and display the self-audit spec

```
/verify --spec self-audit
```

Expected: Loads `.gdeveloper/verify-specs/self-audit.yaml`, runs all
assertions, and reports a score. Target: >= 0.95.

### Step 4: Load and display the D19 pre-flight spec

```
/verify --spec d19-preflight
```

Expected: Loads `.gdeveloper/verify-specs/d19-preflight.yaml`, runs all
assertions, and reports a score. Target: >= 0.95.

### Step 5: Verify write-scope enforcement

Try to write outside the allowed scope:

```
(Agent attempts to call write_file with path "src/main/index.ts")
```

Expected: Blocked with message indicating path is outside `audit/` scope.

Try to write inside the allowed scope:

```
(Agent attempts to call write_file with path "audit/test-output.md")
```

Expected: Allowed (in build mode) or blocked with appropriate message.

### Step 6: Check rate-limit awareness

```
/status
```

Expected: Rate-limit section shows parsed Anthropic headers (or "no headers
received yet" if no API calls have been made).

### Step 7: Review checkpoint and todo state

```
/checkpoint list
/todo list
```

Expected: Shows empty or current checkpoint/todo state.

## Success Criteria

| # | Criterion | Expected |
|---|-----------|----------|
| 1 | /mode plan --write-scope audit/ | Mode = plan, scope = audit/ |
| 2 | /status shows enriched output | Branch, mode, scope, rate limits |
| 3 | /verify --spec self-audit score | >= 0.95 |
| 4 | /verify --spec d19-preflight score | >= 0.95 |
| 5 | Write outside scope blocked | Error message |
| 6 | Rate-limit section in /status | Present |
| 7 | No TypeScript errors | tsc --noEmit passes |

## Post-Run

After running this dry-run:

1. Review the verification scores and fix any failing assertions.
2. If both specs pass at >= 0.95, GDeveloper is ready for the actual
   GhostRigger D19 audit.
3. Proceed to clone GhostRigger and run the D19 handoff prompt.
