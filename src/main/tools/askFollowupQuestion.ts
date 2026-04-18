/**
 * ask_followup_question Tool — Sprint 28 (Cline-style agent loop)
 *
 * Terminal tool: pauses the agent loop and waits for user input.
 * The question is displayed in the chat, and the loop resumes
 * when the user provides an answer.
 *
 * Reference: https://github.com/cline/cline/blob/main/src/core/task/index.ts
 */

import { BrowserWindow } from 'electron';

// ─── Types ───

export interface AskFollowupQuestionInput {
  question: string;
}

export interface AskFollowupQuestionResult {
  success: boolean;
  question: string;
}

// ─── Tool Definition (Anthropic format) ───

export const ASK_FOLLOWUP_QUESTION_TOOL_DEF = {
  name: 'ask_followup_question',
  description: `If you need additional details to complete a task, use this tool to ask the user a question. Prefer this over guessing or making assumptions. The question should be specific and clear. Use this tool judiciously — only when you truly need more information and cannot proceed without it.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user. Be specific about what information you need and why.',
      },
    },
    required: ['question'],
  },
  /** Metadata: terminal tool — pauses loop for user input */
  terminal: true,
};

// ─── Window reference for IPC ───

let followupWindow: BrowserWindow | null = null;

export function setFollowupWindow(win: BrowserWindow | null): void {
  followupWindow = win;
}

// ─── Execute ───

export function executeAskFollowupQuestion(input: AskFollowupQuestionInput): AskFollowupQuestionResult {
  const question = input.question?.trim();
  if (!question) {
    return { success: false, question: 'Error: "question" parameter is required and cannot be empty.' };
  }

  // Broadcast followup question event to the renderer
  if (followupWindow && !followupWindow.isDestroyed()) {
    followupWindow.webContents.send('agent:followup-question', {
      question,
      timestamp: Date.now(),
    });
  }

  return {
    success: true,
    question,
  };
}
