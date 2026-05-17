const AUDIT_KEYWORDS = /\b(audit|review|code review|cross[-\s]?check|inspect|bug(?:s)?|broken|functional|reliable|reliability|production[-\s]?ready|practical use|does it work|full audit)\b/i;

export function isAuditLikeRequest(message?: string | null): boolean {
  return AUDIT_KEYWORDS.test(message || '');
}

export function formatAuditReliabilityProtocolForPrompt(message?: string | null): string {
  if (!isAuditLikeRequest(message)) return '';

  return [
    '## Audit Reliability Protocol',
    'When auditing or cross-checking a codebase, behave like a rigorous senior reviewer, not a single-file linter.',
    '',
    'Required method:',
    '1. Evidence before verdict: inspect the files that produce, normalize, consume, and persist the behavior before declaring a bug.',
    '2. Trace full paths: for UI claims, follow component -> data loader/action -> API route/server action -> database/schema/RLS/env constraints when present.',
    '3. Distinguish status precisely: mark each finding as Confirmed, Refuted/Stale, Inferred Risk, or Needs Runtime Verification.',
    '4. Data-shape discipline: if a prop name appears wrong, inspect the mapper/adapter layer first. Do not report snake_case/camelCase issues until you verify raw rows reach the component unchanged.',
    '5. Empty-state discipline: if an undefined value is masked by fallback/demo data, report the real live-mode risk instead of the masked crash.',
    '6. Permission discipline: for auth, admin actions, payments, documents, or profile edits, verify route guards, server actions, service-role usage, and database/RLS policies together.',
    '7. UX action discipline: a button is functional only if it is reachable, wired to an action, handles loading/error/success states, and mutates or navigates as intended.',
    '8. Verification discipline: run available typecheck/lint/test/build commands when practical; if dependencies or environment are missing, say exactly what blocked verification.',
    '9. Comparison discipline: when the user gives an existing audit, create an agree/disagree/refine comparison and call out missed high-impact issues.',
    '',
    'Final audit shape:',
    '- Lead with confirmed high-severity findings and file evidence.',
    '- Then list refuted/stale claims separately so the user knows what not to chase.',
    '- Then list inferred risks and runtime checks still needed.',
    '- Avoid “fully functional” labels unless happy path, failure path, empty state, permissions, and persistence are all traced.',
  ].join('\n');
}
