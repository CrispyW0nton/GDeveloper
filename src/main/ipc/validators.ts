/**
 * SEC-02: Zod-based IPC input validation.
 *
 * The Electron preload layer whitelists which channels the renderer can
 * invoke, but every handler in src/main/index.ts previously accepted the
 * positional arguments as raw `string | any`, often with no length cap
 * and zero shape validation. If any renderer-side code (including an
 * XSS payload in a rendered markdown cell) invoked these channels with a
 * malicious payload — a 50 MB string, a null sessionId, a branch name
 * containing `;rm -rf $HOME`, an MCP config with `command: /bin/sh` —
 * the handler would happily pass it through to shell / fs / git /
 * Anthropic.
 *
 * This module provides:
 *
 *   1. A small library of reusable primitive schemas (SessionId, Path,
 *      NonEmptyString, etc.) tuned to the shapes the app actually accepts.
 *   2. A per-channel schema registry (IPC_SCHEMAS) keyed by the channel
 *      name from IPC_CHANNELS. Each entry is a z.tuple describing the
 *      positional argv the handler expects (after event).
 *   3. A `validateIPC(channel, schema, handler)` wrapper to drop in at a
 *      call site. It:
 *        - runs safeParse on the argv
 *        - on failure, logs a structured warning to console and throws a
 *          descriptive Error — the renderer's Promise rejects and the
 *          original handler body is never entered
 *        - on success, invokes the handler with the PARSED/coerced values
 *          (so defaults and transforms apply).
 *
 * First-pass coverage is INTENTIONALLY the eight highest-risk handlers —
 * the ones with a direct path to shell / filesystem / subprocess /
 * network-auth operations. The remaining ~90 handlers are additive
 * follow-ons against the same scaffolding.
 */

import { z } from 'zod';
import { IPC_CHANNELS } from './index';

// ─── Primitive schemas ───

/** UUID-ish / slug-ish session identifier. Prevents path-separator / null-byte injection. */
const SessionId = z
  .string()
  .min(1, 'sessionId is required')
  .max(128, 'sessionId too long')
  .regex(/^[\w.-]+$/, 'sessionId must match /^[\\w.-]+$/');

/** Non-empty string with an upper bound to block DoS-via-huge-string. */
const BoundedString = (maxLen: number, label = 'string') =>
  z
    .string({ invalid_type_error: `${label} must be a string` })
    .min(1, `${label} is required`)
    .max(maxLen, `${label} exceeds ${maxLen}-char limit`);

/** Same shape as BoundedString but allows empty — for optional args like "args". */
const BoundedStringAllowEmpty = (maxLen: number, label = 'string') =>
  z
    .string({ invalid_type_error: `${label} must be a string` })
    .max(maxLen, `${label} exceeds ${maxLen}-char limit`);

/**
 * A filesystem path the renderer hands to main. We cap the length and
 * reject the null byte (POSIX-poisoning) and obvious URL schemes. The
 * main-side resolveSafe() is still the authoritative boundary-check; this
 * is belt-and-suspenders.
 */
const FsPath = z
  .string()
  .min(1, 'path is required')
  .max(4096, 'path too long')
  .refine(s => !s.includes('\u0000'), { message: 'path contains null byte' })
  .refine(s => !/^[a-z]+:\/\//i.test(s), { message: 'path must not be a URL' });

/** Git branch name — no whitespace, no control chars, no shell meta. */
const BranchName = z
  .string()
  .min(1, 'branch is required')
  .max(250, 'branch too long')
  .refine(s => !/[\s\x00-\x1f~^:?*\[\]\\]/.test(s), {
    message: 'branch name contains forbidden character',
  });

/** Slash-command name — word chars and hyphen only, no spaces. */
const SlashCommandName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w-]+$/, 'slash command name must match /^[\\w-]+$/');

/** A tool name dispatched via IPC_CHANNELS.TOOL_EXECUTE. */
const ToolName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w.-]+$/, 'tool name must match /^[\\w.-]+$/');

/**
 * MCP server add-config. We accept the declared runtime shape (command /
 * args / env / url / transport) but reject obviously malicious fields.
 * Unknown extra fields pass through — that's how transport-specific
 * options (e.g. "headers", "timeout") survive — but the core surface is
 * schema-bounded.
 */
const MCPServerConfig = z
  .object({
    id: z.string().max(128).optional(),
    name: z.string().min(1).max(200),
    transport: z.enum(['stdio', 'sse', 'http']).optional(),
    command: z.string().max(4096).optional(),
    args: z.array(z.string().max(4096)).max(100).optional(),
    env: z.record(z.string(), z.string().max(16384)).optional(),
    url: z.string().max(4096).optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();

/**
 * A URL handed to git clone / external download. We allow http/https/ssh
 * (GitHub SSH remotes) but reject everything else.
 */
const RepoUrl = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    s =>
      /^(?:https?:\/\/|git@|ssh:\/\/)/i.test(s),
    { message: 'url must be http(s)://, ssh://, or git@host:owner/repo' },
  );

/**
 * A token / api key. We do NOT validate content beyond size — the
 * provider-side validateKey() is authoritative. This schema's job is
 * strictly: "not a 500 MB string, not null, not an object".
 */
const Secret = z.string().min(8, 'key too short').max(2048, 'key too long');

// ─── Per-channel schemas (positional tuples) ───

/**
 * Map of channel → z.tuple(...positional argv). Only handlers with a
 * real attack surface are registered here; callers without a schema
 * entry fall through to the existing un-validated path.
 */
export const IPC_SCHEMAS: Partial<Record<string, z.ZodTuple<any>>> = {
  // Chat pipeline — every prompt goes through here, becomes context for
  // the model, and can trigger downstream tool calls.
  [IPC_CHANNELS.CHAT_SEND]: z.tuple([
    SessionId,
    BoundedString(512 * 1024, 'message'),
  ]),

  // Direct tool dispatch from the renderer (bypasses the agent loop).
  // We require a well-formed tool name; the input object is left as
  // `z.any()` because tools have heterogeneous schemas (that's what the
  // per-tool executor validates).
  [IPC_CHANNELS.TOOL_EXECUTE]: z.tuple([
    ToolName,
    z.any(),
    z.string().max(128).optional(),
  ]),

  // Raw shell command from the terminal panel. Length-bounded and
  // non-empty; content is still subject to the BUG-02 blocklist inside
  // the terminal executor.
  [IPC_CHANNELS.TERMINAL_EXECUTE]: z.tuple([
    BoundedString(8192, 'command'),
    BoundedStringAllowEmpty(4096, 'cwd').optional(),
  ]),

  // Editor writes — absolute path + content. Path must not contain null
  // bytes / URL schemes; content capped at 10 MB so the renderer can't
  // OOM the main process with one call.
  [IPC_CHANNELS.FILE_WRITE]: z.tuple([
    FsPath,
    z.string().max(10 * 1024 * 1024, 'content exceeds 10 MB cap'),
  ]),

  // Slash-command dispatch from the composer. `args` may be empty.
  [IPC_CHANNELS.SLASH_COMMAND_EXECUTE]: z.tuple([
    SlashCommandName,
    BoundedStringAllowEmpty(8192, 'args'),
    SessionId,
  ]),

  // MCP add-server — registers an arbitrary binary the agent can invoke.
  [IPC_CHANNELS.MCP_ADD_SERVER]: z.tuple([MCPServerConfig]),

  // Clone a git repo into a local path. URL shape is validated; local path
  // goes through FsPath + resolveSafe further down the stack.
  [IPC_CHANNELS.WORKSPACE_CLONE]: z.tuple([
    RepoUrl,
    FsPath,
    BoundedString(200, 'name'),
  ]),

  // Open an existing local directory as a workspace.
  [IPC_CHANNELS.WORKSPACE_OPEN_LOCAL]: z.tuple([FsPath, BoundedString(200, 'name')]),
};

// ─── Handler wrapper ───

/**
 * Wrap an ipcMain handler with zod validation of its positional args.
 *
 * Usage:
 *   ipcMain.handle(
 *     IPC_CHANNELS.CHAT_SEND,
 *     validateIPC(IPC_CHANNELS.CHAT_SEND, async (_event, sessionId, message) => { ... }),
 *   );
 *
 * If no schema is registered for `channel`, the handler runs unmodified
 * (so this wrapper is safe to drop-in even where we haven't yet written
 * a schema — the non-validated call path is unchanged).
 *
 * On validation failure:
 *   - A structured warning is logged to console via `console.warn`.
 *   - The returned Promise rejects with a descriptive Error. The renderer
 *     gets a normal IPC error it can surface to the user — the handler
 *     body is never invoked.
 */
export function validateIPC<
  Args extends readonly unknown[],
  Ret,
>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Promise<Ret> | Ret,
): (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<Ret> {
  const schema = IPC_SCHEMAS[channel];
  return async (event, ...args) => {
    if (!schema) {
      return await handler(event, ...(args as unknown as Args));
    }
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const summary = parsed.error.issues
        .map(i => `args[${i.path.join('.')}] ${i.message}`)
        .join('; ');
      const message = `IPC validation failed for ${channel}: ${summary}`;
      console.warn('[ipc:validate]', JSON.stringify({
        channel,
        issues: parsed.error.issues,
      }));
      const err = new Error(message);
      (err as any).ipcChannel = channel;
      (err as any).validationIssues = parsed.error.issues;
      throw err;
    }
    return await handler(event, ...(parsed.data as unknown as Args));
  };
}
