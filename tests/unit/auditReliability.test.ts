import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  formatAuditReliabilityProtocolForPrompt,
  isAuditLikeRequest,
} from '../../src/main/orchestration/auditReliability';

describe('audit reliability protocol', () => {
  it('activates for audit and cross-check requests', () => {
    expect(isAuditLikeRequest('Do a full audit of this repo')).toBe(true);
    expect(isAuditLikeRequest('Cross check the previous bug report')).toBe(true);
    expect(isAuditLikeRequest('Is this production-ready?')).toBe(true);
    expect(isAuditLikeRequest('Rename this button label')).toBe(false);
  });

  it('requires full-path evidence, stale-claim handling, and permission checks', () => {
    const prompt = formatAuditReliabilityProtocolForPrompt('Audit this payment portal');

    expect(prompt).toContain('Audit Reliability Protocol');
    expect(prompt).toContain('component -> data loader/action -> API route/server action -> database/schema/RLS');
    expect(prompt).toContain('Confirmed, Refuted/Stale, Inferred Risk, or Needs Runtime Verification');
    expect(prompt).toContain('snake_case/camelCase');
    expect(prompt).toContain('service-role usage');
    expect(prompt).toContain('agree/disagree/refine comparison');
  });

  it('is injected by the enhanced prompt builder only through the targeted formatter', () => {
    const promptBuilderSrc = readFileSync(resolve(__dirname, '../../src/main/orchestration/promptBuilder.ts'), 'utf-8');

    expect(promptBuilderSrc).toContain('formatAuditReliabilityProtocolForPrompt(ctx.currentUserMessage)');
    expect(promptBuilderSrc).toContain('Audit Reliability');
  });
});
