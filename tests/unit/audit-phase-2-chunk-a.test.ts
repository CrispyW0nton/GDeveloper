/**
 * Audit Phase 2 — Chunk A regression tests
 *
 * Covers the two P0 findings from docs/AUDIT-PHASE-2.md:
 *
 *   CHAT-DUP  — CHAT_SEND no longer unconditionally inserts a final
 *               assistant row (used to duplicate the per-turn
 *               persistMessage row).
 *   AGL-TRUNC — streamChatToRenderer re-runs
 *               ensureToolResultsFollowToolUse after truncation to
 *               re-synthesize any tool_results sliced off by the
 *               half/quarter-keep strategy.
 *
 * Strategy:
 *   1. Source-scan tests that assert the fix is in place (lightweight,
 *      no Electron/electron-vite runtime needed).
 *   2. Functional tests that exercise an inline port of the pairing +
 *      truncation logic, so we can drive concrete fixtures through the
 *      composition and assert the end-to-end invariant: "no orphan
 *      tool_use after the full pipeline runs."
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const indexCode = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf-8');
const providersCode = readFileSync(resolve(__dirname, '../../src/main/providers/index.ts'), 'utf-8');
const dbCode = readFileSync(resolve(__dirname, '../../src/main/db/index.ts'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════
//  CHAT-DUP — Final assistant row no longer double-inserted
// ═══════════════════════════════════════════════════════════════════
describe('Audit Phase 2 / CHAT-DUP — dedup of final assistant insert', () => {
  it('DatabaseManager exports getLastMessage for dedup queries', () => {
    expect(dbCode).toMatch(/getLastMessage\s*\(\s*sessionId\s*:\s*string/);
    // Must sort by rowid not timestamp (timestamps are 1-sec resolution)
    expect(dbCode).toContain('ORDER BY rowid DESC LIMIT 1');
  });

  it('CHAT_SEND handler uses getLastMessage to dedup before inserting', () => {
    // Find the "Save final assistant response" block in CHAT_SEND
    const marker = 'CHAT-DUP';
    const idx = indexCode.indexOf(marker);
    expect(idx, 'CHAT_SEND must reference CHAT-DUP in its dedup comment').toBeGreaterThan(0);

    // The dedup block must:
    //   1. Query the most recent assistant row
    //   2. Compare content byte-for-byte
    //   3. Only insert when content differs
    const block = indexCode.substring(idx, idx + 2000);
    expect(block).toMatch(/db\.getLastMessage\(sessionId,\s*'assistant'\)/);
    expect(block).toMatch(/existingLast\.content\s*===\s*loopResult\.content/);
    expect(block).toMatch(/db\.insertMessage\(sessionId,\s*'assistant',\s*loopResult\.content\)/);
  });

  it('CHAT_SEND no longer unconditionally inserts with loopResult.toolCalls', () => {
    // The pre-fix line was:
    //   db.insertMessage(sessionId, 'assistant', loopResult.content,
    //     loopResult.toolCalls.length > 0 ? loopResult.toolCalls : undefined)
    // That exact pattern (insert + loopResult.toolCalls in the same call)
    // must no longer appear in the final-save block.
    const marker = 'CHAT-DUP';
    const idx = indexCode.indexOf(marker);
    const block = indexCode.substring(idx, idx + 2000);
    expect(block).not.toMatch(/db\.insertMessage\([^)]*loopResult\.toolCalls/);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  AGL-TRUNC — Pairing re-runs after truncation
// ═══════════════════════════════════════════════════════════════════
describe('Audit Phase 2 / AGL-TRUNC — pairing re-runs after truncation', () => {
  it('streamChatToRenderer references AGL-TRUNC in the post-truncation block', () => {
    expect(providersCode).toContain('AGL-TRUNC');
  });

  it('ensureToolResultsFollowToolUse is called both before AND after truncation', () => {
    // The fix pattern: pair → truncate → (if truncated) pair again.
    // Scan for two ensureToolResultsFollowToolUse call sites in the
    // streamChatToRenderer function body.
    const start = providersCode.indexOf('export async function streamChatToRenderer');
    expect(start, 'streamChatToRenderer must exist').toBeGreaterThan(0);
    const end = providersCode.indexOf('\n}', start);
    const fn = providersCode.substring(start, end > 0 ? end : providersCode.length);

    const calls = fn.match(/ensureToolResultsFollowToolUse\(/g) || [];
    expect(calls.length, 'must call ensureToolResultsFollowToolUse at least TWICE (pre + post truncation)').toBeGreaterThanOrEqual(2);
  });

  it('post-truncation pairing call is gated on wasTruncated so it is a no-op in the common case', () => {
    // Locate the AGL-TRUNC comment inside streamChatToRenderer specifically
    // (there's another AGL-TRUNC comment inside ensureToolResultsFollowToolUse
    // covering the partial-results fix; we want the post-truncation block).
    const streamStart = providersCode.indexOf('export async function streamChatToRenderer');
    expect(streamStart).toBeGreaterThan(0);
    const markerIdx = providersCode.indexOf('AGL-TRUNC', streamStart);
    expect(markerIdx, 'AGL-TRUNC marker must appear inside streamChatToRenderer').toBeGreaterThan(streamStart);

    // Trace upward from AGL-TRUNC to find the enclosing `if (truncResult.wasTruncated)`.
    const precontext = providersCode.substring(Math.max(streamStart, markerIdx - 400), markerIdx);
    expect(precontext).toMatch(/if\s*\(\s*truncResult\.wasTruncated\s*\)/);
  });

  it('the orphansFixed / orphansStripped counts from the second pass get rolled into pairingResult totals', () => {
    const streamStart = providersCode.indexOf('export async function streamChatToRenderer');
    const markerIdx = providersCode.indexOf('AGL-TRUNC', streamStart);
    const block = providersCode.substring(markerIdx, markerIdx + 2000);
    expect(block).toMatch(/pairingResult\.orphansFixed\s*\+=\s*secondPass\.orphansFixed/);
    expect(block).toMatch(/pairingResult\.orphansStripped\s*\+=\s*secondPass\.orphansStripped/);
  });

  // ─── Bonus: the upgraded ensureToolResultsFollowToolUse now fixes
  //           partial-results cases instead of just warning. Verify. ───
  it('ensureToolResultsFollowToolUse injects synthetic results when next user msg lacks some tool_use IDs (partial-results fix)', () => {
    const fnStart = providersCode.indexOf('export function ensureToolResultsFollowToolUse');
    expect(fnStart).toBeGreaterThan(0);
    const fnEnd = providersCode.indexOf('\n}', fnStart);
    const fn = providersCode.substring(fnStart, fnEnd);

    // We must now look for a `filter(id => !nextMsg.content.includes(id))`
    // pattern (computing the MISSING id list), followed by a synthetic
    // injection when missing.length > 0.
    expect(fn).toMatch(/\.filter\(id\s*=>\s*!\s*nextMsg\.content\.includes\(id\)\)/);
    expect(fn).toMatch(/missingIds\.length\s*>\s*0/);
    expect(fn).toMatch(/synthetic/);

    // And the old "silent warn and move on" pattern must no longer be the
    // ONLY response — i.e. there must be at least one orphansFixed
    // increment INSIDE the partial-results branch.
    const partialIdx = fn.indexOf('AGL-TRUNC');
    if (partialIdx > 0) {
      const partialBlock = fn.substring(partialIdx, partialIdx + 1500);
      expect(partialBlock).toMatch(/orphansFixed\s*\+=/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  AGL-TRUNC — Functional fixture: end-to-end invariant check
// ═══════════════════════════════════════════════════════════════════
//
// Inline port of the pairing and truncation logic, exercised against a
// crafted fixture that reproduces the pre-fix bug shape: a tool_use in
// the preserved prefix whose matching tool_result lives in the truncated
// middle. The composition MUST end with every tool_use paired to some
// (synthetic or real) tool_result — no orphans.

function ensurePairing(messages: Array<{ role: string; content: string }>): {
  messages: Array<{ role: string; content: string }>;
  orphansFixed: number;
  orphansStripped: number;
} {
  let orphansFixed = 0;
  let orphansStripped = 0;
  const result: Array<{ role: string; content: string }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      let ids: string[] = [];
      try {
        const parsed = JSON.parse(msg.content);
        if (Array.isArray(parsed)) {
          ids = parsed.filter((b: any) => b?.type === 'tool_use' && b.id).map((b: any) => b.id);
        }
      } catch { /* plain text */ }
      result.push(msg);
      if (ids.length > 0) {
        const next = messages[i + 1];
        if (!next || next.role !== 'user') {
          // No user message follows — synthesize a fresh one
          const synth = ids.map(id =>
            `[Tool Result: synthetic]\n{"error": "Tool result was lost", "tool_use_id": "${id}"}`
          ).join('\n\n');
          result.push({ role: 'user', content: synth });
          orphansFixed += ids.length;
        } else {
          // User message follows — but may lack some IDs. Prepend
          // synthetic results for the missing ones so every tool_use
          // is paired.
          const missing = ids.filter(id => !next.content.includes(id));
          if (missing.length > 0) {
            const synthPrefix = missing.map(id =>
              `[Tool Result: synthetic]\n{"error": "Tool result was lost", "tool_use_id": "${id}"}`
            ).join('\n\n');
            messages[i + 1] = { role: 'user', content: synthPrefix + '\n\n' + next.content };
            orphansFixed += missing.length;
          }
        }
      }
    } else if (msg.role === 'user') {
      const hasResult = msg.content.includes('[Tool Result:');
      if (hasResult && i > 0 && messages[i - 1]?.role !== 'assistant') {
        orphansStripped++;
        continue;
      }
      result.push(msg);
    } else {
      result.push(msg);
    }
  }
  return { messages: result, orphansFixed, orphansStripped };
}

function truncateSim(
  messages: Array<{ role: string; content: string }>,
  keepRatio: 'half' | 'quarter',
): Array<{ role: string; content: string }> {
  // Simplified: preserve first 2, then keep last half or last quarter
  const firstChunk = messages.slice(0, 2);
  const rest = messages.slice(2);
  const keepFrom = keepRatio === 'half'
    ? Math.floor(rest.length / 2)
    : Math.floor(rest.length * 3 / 4);
  const kept = rest.slice(keepFrom);
  const notice = { role: 'user', content: '[NOTE] Some previous conversation history has been removed.' };
  return [...firstChunk, notice, ...kept];
}

function countOrphanToolUse(messages: Array<{ role: string; content: string }>): number {
  let orphans = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    let ids: string[] = [];
    try {
      const parsed = JSON.parse(m.content);
      if (Array.isArray(parsed)) {
        ids = parsed.filter((b: any) => b?.type === 'tool_use' && b.id).map((b: any) => b.id);
      }
    } catch { /* noop */ }
    if (ids.length === 0) continue;
    const next = messages[i + 1];
    const nextHasAllIds = next && next.role === 'user' && ids.every(id => next.content.includes(id));
    if (!nextHasAllIds) orphans += ids.length;
  }
  return orphans;
}

describe('Audit Phase 2 / AGL-TRUNC — functional fixture', () => {
  it('pairing → truncation → pairing produces no orphan tool_use for a typical mid-session conversation', () => {
    // Build a 20-turn fixture: tool_use in turn 0 (preserved firstChunk),
    // tool_results in middle-to-late turns, final turn = pure text.
    const messages: Array<{ role: string; content: string }> = [];
    messages.push({ role: 'user', content: 'Please refactor auth.ts' });
    messages.push({
      role: 'assistant',
      content: JSON.stringify([
        { type: 'text', text: 'Reading auth.ts first.' },
        { type: 'tool_use', id: 'tu_01_root', name: 'read_file', input: { path: 'auth.ts' } },
      ]),
    });
    // This tool_result pairs with tu_01_root and will be truncated away.
    messages.push({ role: 'user', content: '[Tool Result: read_file]\nauth.ts contents (tu_01_root paired)' });

    // Now 8 more turns of misc chat to grow the middle.
    for (let i = 0; i < 8; i++) {
      messages.push({ role: 'assistant', content: `Mid-chat narration turn ${i}` });
      messages.push({ role: 'user', content: `User follow-up ${i}` });
    }
    // A later tool_use + result pair that WILL be kept post-truncation.
    messages.push({
      role: 'assistant',
      content: JSON.stringify([
        { type: 'text', text: 'Now patching.' },
        { type: 'tool_use', id: 'tu_99_late', name: 'patch_file', input: { path: 'auth.ts' } },
      ]),
    });
    messages.push({ role: 'user', content: '[Tool Result: patch_file]\npatch applied (tu_99_late paired)' });
    messages.push({ role: 'assistant', content: 'Refactor complete.' });

    // Full pipeline
    const pre = ensurePairing(messages);
    expect(countOrphanToolUse(pre.messages)).toBe(0);

    const truncated = truncateSim(pre.messages, 'half');
    // After truncation, tu_01_root's result was sliced → this is the bug case
    const orphansMid = countOrphanToolUse(truncated);
    expect(orphansMid, 'truncation alone produces orphans for tool_use in the preserved prefix').toBeGreaterThan(0);

    // Second pairing pass — the fix
    const post = ensurePairing(truncated);
    expect(countOrphanToolUse(post.messages), 'post-truncation pairing must eliminate all orphan tool_use').toBe(0);
    // Synthetic result for tu_01_root must have been injected somewhere
    // (either a fresh user msg, or prepended into the truncation notice
    // that sits right after the preserved assistant tool_use).
    expect(
      post.messages.some(m => m.role === 'user' && m.content.includes('tu_01_root') && m.content.includes('synthetic')),
      'expected a synthetic tool_result referencing tu_01_root somewhere in the post-truncation message stream',
    ).toBe(true);
  });

  it('pairing → truncation → pairing is a no-op when truncation wasn\'t needed', () => {
    // Short conversation: pairing + second-pass both zero-count.
    const messages: Array<{ role: string; content: string }> = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const pre = ensurePairing(messages);
    expect(pre.orphansFixed).toBe(0);
    expect(pre.orphansStripped).toBe(0);
    // Even if we ran truncation (we wouldn't), the second pass would be zero:
    const post = ensurePairing(pre.messages);
    expect(post.orphansFixed).toBe(0);
    expect(post.orphansStripped).toBe(0);
  });
});
