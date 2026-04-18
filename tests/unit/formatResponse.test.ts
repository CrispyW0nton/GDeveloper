/**
 * formatResponse Tests — Sprint 28
 * Snapshot tests for the verbatim Cline-derived response strings.
 */

import { describe, it, expect } from 'vitest';
import { formatResponse } from '../../src/main/orchestration/formatResponse';

describe('formatResponse — Sprint 28 Snapshots', () => {

  // ─── noToolsUsed ───

  it('noToolsUsed contains the exact error preamble', () => {
    const msg = formatResponse.noToolsUsed();
    expect(msg).toContain('[ERROR] You did not use a tool in your previous response!');
  });

  it('noToolsUsed mentions attempt_completion', () => {
    const msg = formatResponse.noToolsUsed();
    expect(msg).toContain('attempt_completion');
  });

  it('noToolsUsed mentions ask_followup_question', () => {
    const msg = formatResponse.noToolsUsed();
    expect(msg).toContain('ask_followup_question');
  });

  it('noToolsUsed is marked as automated message', () => {
    const msg = formatResponse.noToolsUsed();
    expect(msg).toContain('This is an automated message');
  });

  it('noToolsUsed snapshot', () => {
    expect(formatResponse.noToolsUsed()).toMatchSnapshot();
  });

  // ─── toolDenied ───

  it('toolDenied returns exact string', () => {
    const msg = formatResponse.toolDenied();
    expect(msg).toBe('The user denied this operation.');
  });

  it('toolDenied snapshot', () => {
    expect(formatResponse.toolDenied()).toMatchSnapshot();
  });

  // ─── toolError ───

  it('toolError wraps error in XML tags', () => {
    const msg = formatResponse.toolError('Something broke');
    expect(msg).toContain('<error>');
    expect(msg).toContain('Something broke');
    expect(msg).toContain('</error>');
  });

  it('toolError handles undefined input', () => {
    const msg = formatResponse.toolError();
    expect(msg).toContain('<error>');
    expect(msg).toContain('</error>');
  });

  it('toolError snapshot', () => {
    expect(formatResponse.toolError('test error')).toMatchSnapshot();
  });

  // ─── tooManyMistakes ───

  it('tooManyMistakes wraps feedback in XML tags', () => {
    const msg = formatResponse.tooManyMistakes('Try reading the file first');
    expect(msg).toContain('<feedback>');
    expect(msg).toContain('Try reading the file first');
    expect(msg).toContain('</feedback>');
  });

  it('tooManyMistakes snapshot', () => {
    expect(formatResponse.tooManyMistakes('test feedback')).toMatchSnapshot();
  });

  // ─── contextTruncationNotice ───

  it('contextTruncationNotice is present and mentions context window', () => {
    const msg = formatResponse.contextTruncationNotice();
    expect(msg).toContain('context window length');
    expect(msg).toContain('[NOTE]');
  });

  it('contextTruncationNotice snapshot', () => {
    expect(formatResponse.contextTruncationNotice()).toMatchSnapshot();
  });

  // ─── No legacy patterns ───

  it('module does not export COMPLETION_PATTERNS', () => {
    expect((formatResponse as any).COMPLETION_PATTERNS).toBeUndefined();
  });
});
