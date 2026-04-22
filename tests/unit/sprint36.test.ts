/**
 * Sprint 36 Test Suite — Stabilization & Stream Lifecycle
 *
 * Four bugs from Sprint 35:
 *   1. CHAT_CLEAR didn't emit plan:null to renderer → stale TaskPlanCard visible.
 *   2. No stream abort on new request / tab unmount → duplicate message-delta events.
 *   3. Nudge was ephemeral in Sprint 35 but lacked DB guard & DevConsole tagging.
 *   4. Cross-platform 'which' fails on Windows; parallel_read can't handle file:// URIs.
 *
 * Tests (16 total):
 *   1.  chat_clear_emits_plan_null_to_renderer
 *   2.  chat_clear_sends_action_clear_in_plan_update
 *   3.  chat_abort_ipc_channel_registered
 *   4.  abort_controller_field_in_claude_provider
 *   5.  abort_active_stream_method_exported
 *   6.  stream_abort_wired_into_fetch_signal
 *   7.  active_stream_cleared_after_completion
 *   8.  ephemeral_nudge_variable_renamed
 *   9.  nudge_db_guard_rejects_insert
 *  10.  nudge_event_includes_ephemeral_true
 *  11.  cross_platform_which_uses_process_platform
 *  12.  parallel_read_imports_file_url_to_path
 *  13.  parallel_read_handles_local_paths
 *  14.  parallel_read_workspace_path_parameter
 *  15.  backward_compat_sprint35_features_preserved
 *  16.  ipc_channel_chat_abort_exists
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════
//  Fix #1 (P0): CHAT_CLEAR clears active plan in renderer
// ═══════════════════════════════════════════════════════════════════

describe('Sprint 36 — Fix 1: CHAT_CLEAR emits plan:null to renderer', () => {
  const indexSrc = readSrc('main/index.ts');

  it('CHAT_CLEAR handler sends chat:active-plan-update with plan: null', () => {
    const chatClearIdx = indexSrc.indexOf('CHAT_CLEAR');
    expect(chatClearIdx).toBeGreaterThan(0);
    const handlerBody = indexSrc.substring(chatClearIdx, chatClearIdx + 1800);

    // Must emit plan update with null plan
    expect(handlerBody).toContain("'chat:active-plan-update'");
    expect(handlerBody).toContain('plan: null');
  });

  it('CHAT_CLEAR plan update includes action: clear', () => {
    const chatClearIdx = indexSrc.indexOf('CHAT_CLEAR');
    const handlerBody = indexSrc.substring(chatClearIdx, chatClearIdx + 1800);

    expect(handlerBody).toContain("action: 'clear'");
  });

  it('plan:null is emitted BEFORE session-cleared event', () => {
    const chatClearIdx = indexSrc.indexOf('CHAT_CLEAR');
    const handlerBody = indexSrc.substring(chatClearIdx, chatClearIdx + 1800);

    const planNullPos = handlerBody.indexOf('plan: null');
    const sessionClearedPos = handlerBody.indexOf("'session-cleared'");
    expect(planNullPos).toBeGreaterThan(0);
    expect(sessionClearedPos).toBeGreaterThan(planNullPos);
  });

  it('planId is set to null in the plan update', () => {
    const chatClearIdx = indexSrc.indexOf('CHAT_CLEAR');
    const handlerBody = indexSrc.substring(chatClearIdx, chatClearIdx + 1800);
    expect(handlerBody).toContain('planId: null');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Fix #2 (P0): Stream abort on new request / tab unmount
// ═══════════════════════════════════════════════════════════════════

describe('Sprint 36 — Fix 2: Stream abort lifecycle', () => {
  const providerSrc = readSrc('main/providers/index.ts');
  const indexSrc = readSrc('main/index.ts');
  const ipcSrc = readSrc('main/ipc/index.ts');

  it('ClaudeProvider has an activeStream AbortController field', () => {
    expect(providerSrc).toContain('private activeStream: AbortController | null');
  });

  it('abortActiveStream method is defined', () => {
    expect(providerSrc).toContain('abortActiveStream()');
    // Must call abort() on the controller
    const methodIdx = providerSrc.indexOf('abortActiveStream()');
    const methodBody = providerSrc.substring(methodIdx, methodIdx + 300);
    expect(methodBody).toContain('.abort()');
  });

  it('streamMessage aborts previous stream before starting a new one', () => {
    // Find streamMessage method
    const streamIdx = providerSrc.indexOf('async *streamMessage(');
    expect(streamIdx).toBeGreaterThan(0);
    const streamBody = providerSrc.substring(streamIdx, streamIdx + 4000);

    // Must call abortActiveStream before fetch
    expect(streamBody).toContain('this.abortActiveStream()');
    // Must create new AbortController
    expect(streamBody).toContain('new AbortController()');
    // Must pass signal to fetch
    expect(streamBody).toContain('signal: streamAbort.signal');
  });

  it('activeStream is cleared after stream completion (in finally block)', () => {
    const finallyIdx = providerSrc.indexOf('reader.releaseLock()');
    expect(finallyIdx).toBeGreaterThan(0);
    const afterFinally = providerSrc.substring(finallyIdx, finallyIdx + 200);
    expect(afterFinally).toContain('this.activeStream = null');
  });

  it('activeStream is cleared on HTTP error (non-200 response)', () => {
    // After the response.ok check in streamMessage
    const streamIdx = providerSrc.indexOf('async *streamMessage(');
    const streamBody = providerSrc.substring(streamIdx, streamIdx + 3000);
    const errorBlockIdx = streamBody.indexOf('if (!response.ok)');
    expect(errorBlockIdx).toBeGreaterThan(0);
    const errorBlock = streamBody.substring(errorBlockIdx, errorBlockIdx + 300);
    expect(errorBlock).toContain('this.activeStream = null');
  });

  it('CHAT_ABORT IPC channel is defined', () => {
    expect(ipcSrc).toContain("CHAT_ABORT: 'chat:abort'");
  });

  it('chat:abort IPC handler calls abortActiveStream', () => {
    expect(indexSrc).toContain('CHAT_ABORT');
    const abortIdx = indexSrc.indexOf('CHAT_ABORT');
    const handlerBody = indexSrc.substring(abortIdx, abortIdx + 400);
    expect(handlerBody).toContain('abortActiveStream');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Fix #3 (P1): Truly ephemeral nudge
// ═══════════════════════════════════════════════════════════════════

describe('Sprint 36 — Fix 3: Truly ephemeral nudge', () => {
  const agentLoopSrc = readSrc('main/orchestration/agentLoop.ts');
  const dbSrc = readSrc('main/db/index.ts');

  it('nudge variable is named ephemeralNudge (explicit transient intent)', () => {
    expect(agentLoopSrc).toContain('ephemeralNudge');
    expect(agentLoopSrc).toContain('const ephemeralNudge = formatResponse.noToolsUsed()');
  });

  it('DB has a guard to reject nudge inserts', () => {
    expect(dbSrc).toContain('NUDGE_SIGNATURE');
    expect(dbSrc).toContain('[ERROR] You did not use a tool');
    // The guard must return early without inserting
    expect(dbSrc).toContain('rejected-nudge');
  });

  it('DB guard logs a warning when rejecting nudge inserts', () => {
    expect(dbSrc).toContain('[DB:guard] Rejected nudge insert');
  });

  it('nudge event includes ephemeral: true', () => {
    // Find the second no-tools-used-nudge emission (Sprint 36 adds ephemeral: true)
    const nudgeEvents = agentLoopSrc.match(/event: 'no-tools-used-nudge'/g);
    // There may be two emissions (Sprint 33 + Sprint 36); the Sprint 36 one has ephemeral: true
    expect(nudgeEvents).toBeTruthy();
    expect(agentLoopSrc).toContain('ephemeral: true');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Fix #4 (P2): Cross-platform which & parallel_read file://
// ═══════════════════════════════════════════════════════════════════

describe('Sprint 36 — Fix 4: Cross-platform which command', () => {
  const indexSrc = readSrc('main/index.ts');

  it('shell detection uses process.platform-aware command', () => {
    // Must determine which/where based on platform
    expect(indexSrc).toContain("process.platform === 'win32' ? 'where' : 'which'");
  });

  it('whichCmd variable is used for zsh and pwsh detection', () => {
    // Both shell checks use the platform-aware variable
    expect(indexSrc).toContain('`${whichCmd} zsh`');
    expect(indexSrc).toContain('`${whichCmd} pwsh`');
  });
});

describe('Sprint 36 — Fix 4: parallel_read file:// URI support', () => {
  const parallelReadSrc = readSrc('main/tools/parallelRead.ts');

  it('imports fileURLToPath from url module', () => {
    expect(parallelReadSrc).toContain("import { fileURLToPath } from 'url'");
  });

  it('imports readFile from fs/promises', () => {
    expect(parallelReadSrc).toContain("import { readFile } from 'fs/promises'");
  });

  it('has isLocalPath helper that checks for file:// and absolute paths', () => {
    expect(parallelReadSrc).toContain('function isLocalPath');
    expect(parallelReadSrc).toContain("url.startsWith('file://')");
    expect(parallelReadSrc).toContain('isAbsolute(url)');
  });

  it('readLocalFile handles file:// URIs via fileURLToPath', () => {
    expect(parallelReadSrc).toContain('readLocalFile');
    expect(parallelReadSrc).toContain('fileURLToPath(url)');
  });

  it('readLocalFile resolves workspace-relative paths', () => {
    const fnIdx = parallelReadSrc.indexOf('readLocalFile');
    const fnBody = parallelReadSrc.substring(fnIdx, fnIdx + 1500);
    expect(fnBody).toContain('resolve(base, url)');
    expect(fnBody).toContain('workspacePath');
  });

  it('executeParallelRead accepts optional workspacePath parameter', () => {
    expect(parallelReadSrc).toContain('export async function executeParallelRead(input: ParallelReadInput, workspacePath?: string)');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Backward compatibility
// ═══════════════════════════════════════════════════════════════════

describe('Sprint 36 — Backward compat: Sprint 35 features preserved', () => {
  const providerSrc = readSrc('main/providers/index.ts');
  const agentLoopSrc = readSrc('main/orchestration/agentLoop.ts');
  const indexSrc = readSrc('main/index.ts');

  it('Sprint 35 truncateIfNeeded still present and functional', () => {
    expect(providerSrc).toContain('export function truncateIfNeeded');
    expect(providerSrc).toContain('getMaxAllowedSize');
    expect(providerSrc).toContain('160_000');
  });

  it('Sprint 35 ensureToolResultsFollowToolUse still present', () => {
    expect(providerSrc).toContain('export function ensureToolResultsFollowToolUse');
    expect(providerSrc).toContain('orphansFixed');
    expect(providerSrc).toContain('orphansStripped');
  });

  it('Sprint 35 deleteMessages still present in CHAT_CLEAR', () => {
    const chatClearIdx = indexSrc.indexOf('CHAT_CLEAR');
    const handlerBody = indexSrc.substring(chatClearIdx, chatClearIdx + 1800);
    expect(handlerBody).toContain('deleteMessages');
    expect(handlerBody).toContain('resetSessionUsage');
    expect(handlerBody).toContain('clearActivePlan');
  });

  it('Sprint 34 CRLF-aware SSE splitter still present', () => {
    expect(providerSrc).toContain('split(/\\r\\n|\\r|\\n/)');
  });

  it('Sprint 33 loop events still present', () => {
    expect(agentLoopSrc).toContain("event: 'turn-start'");
    expect(agentLoopSrc).toContain("event: 'turn-inspection'");
    expect(agentLoopSrc).toContain("event: 'turn-end'");
    expect(agentLoopSrc).toContain("event: 'terminal-tool-used'");
  });

  it('Sprint 35 ephemeral nudge comment preserved', () => {
    expect(agentLoopSrc).toContain('NOT persisted');
    expect(agentLoopSrc).toContain('EPHEMERAL');
  });
});
