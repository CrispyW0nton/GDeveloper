/**
 * attempt_completion Tool — Sprint 28 (Cline-style agent loop)
 *
 * Terminal tool: when Claude calls this, the agent loop exits cleanly.
 * The result is surfaced to the user as the final task output.
 *
 * Reference: https://github.com/cline/cline/blob/main/src/core/task/index.ts
 */

import { BrowserWindow } from 'electron';

// ─── Types ───

export interface AttemptCompletionInput {
  result: string;
  command?: string;
}

export interface AttemptCompletionResult {
  success: boolean;
  result: string;
  command?: string;
}

// ─── Tool Definition (Anthropic format) ───

export const ATTEMPT_COMPLETION_TOOL_DEF = {
  name: 'attempt_completion',
  description: `After each tool use, the user will respond with the result of that tool use. Once you've received the results of tool uses and can confirm that the task is complete, use this tool to present the result of your work to the user. The user may provide feedback, in which case you should address it and attempt completion again.
IMPORTANT NOTE: This tool CANNOT be used until you've confirmed from the user that any previous tool uses were successful. If the last tool use result indicates a failure, you must address the failure before using this tool.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      result: {
        type: 'string',
        description: 'The result of the task. Formulate this result in a way that is final and does not require further input from the user. Do not end your result with questions or offers for further assistance.',
      },
      command: {
        type: 'string',
        description: 'Optional CLI command to showcase the result (e.g., `open index.html`, `npm start`). Will be shown but not auto-executed.',
      },
    },
    required: ['result'],
  },
  /** Metadata: terminal tool — triggers loop exit */
  terminal: true,
};

// ─── Window reference for IPC ───

let completionWindow: BrowserWindow | null = null;

export function setCompletionWindow(win: BrowserWindow | null): void {
  completionWindow = win;
}

// ─── Execute ───

export function executeAttemptCompletion(input: AttemptCompletionInput): AttemptCompletionResult {
  const result = input.result?.trim();
  if (!result) {
    return { success: false, result: 'Error: "result" parameter is required and cannot be empty.' };
  }

  // Broadcast completion event to the renderer
  if (completionWindow && !completionWindow.isDestroyed()) {
    completionWindow.webContents.send('agent:completion', {
      result,
      command: input.command || null,
      timestamp: Date.now(),
    });
  }

  return {
    success: true,
    result,
    command: input.command,
  };
}
