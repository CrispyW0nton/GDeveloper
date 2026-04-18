/**
 * Format Response — Sprint 28 (Cline-style agent loop)
 *
 * Verbatim response strings from Cline's prompts/responses.ts,
 * adapted for GDeveloper. These strings are injected as user messages
 * to guide Claude's behavior when it fails to use tools.
 *
 * Reference: https://github.com/cline/cline/blob/main/src/core/prompts/responses.ts
 */

export const formatResponse = {
  /**
   * Sent when Claude responds with end_turn but used no tools.
   * Forces Claude to either use a tool or call attempt_completion.
   * This is the key string that replaces the regex-based COMPLETION_PATTERNS.
   */
  noToolsUsed: () =>
    `[ERROR] You did not use a tool in your previous response! Please retry with a tool use.

# Next Steps

If you have completed the user's task, use the attempt_completion tool. 
If you require additional information from the user, use the ask_followup_question tool. 
Otherwise, if you have not completed the task and do not need additional information, then proceed with the next step of the task. 
(This is an automated message, so do not respond to it conversationally.)`,

  /**
   * Sent when the user denies a tool operation (e.g., rejects a file write).
   */
  toolDenied: () => `The user denied this operation.`,

  /**
   * Sent when a tool call returns an error.
   */
  toolError: (error?: string) =>
    `The tool execution failed with the following error:\n<error>\n${error}\n</error>`,

  /**
   * Sent when too many consecutive mistakes are detected.
   */
  tooManyMistakes: (feedback?: string) =>
    `You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n<feedback>\n${feedback}\n</feedback>`,

  /**
   * Context truncation notice when conversation is compacted.
   */
  contextTruncationNotice: () =>
    `[NOTE] Some previous conversation history has been removed to maintain optimal context window length. The initial user task has been retained for continuity. Pay special attention to the user's latest messages.`,
};
