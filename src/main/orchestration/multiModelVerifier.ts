import type { ILLMProvider, LLMResponse } from '../domain/interfaces';
import type { CardboardScanReport } from './cardboardDetector';

export interface MultiModelVerificationInput {
  provider: ILLMProvider;
  providerName: string;
  modelId?: string;
  diffText: string;
  statusSummary: string;
  cardboardScan?: CardboardScanReport;
}

export interface MultiModelVerificationResult {
  providerName: string;
  modelId?: string;
  review: string;
  usage?: LLMResponse['usage'];
}

const MAX_DIFF_CHARS = 24000;

export function buildMultiModelVerificationPrompt(input: Omit<MultiModelVerificationInput, 'provider'>): string {
  const diff = input.diffText.trim() || '(no diff text available)';
  const clippedDiff = diff.length > MAX_DIFF_CHARS
    ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated: ${diff.length - MAX_DIFF_CHARS} chars omitted]`
    : diff;

  const safetyFindings = input.cardboardScan?.findings.length
    ? input.cardboardScan.findings
        .slice(0, 12)
        .map(f => `- ${f.severity} ${f.ruleId} at ${f.filePath}${f.line ? `:${f.line}` : ''}: ${f.summary}`)
        .join('\n')
    : '- No deterministic Cardboard-Muffin findings were detected.';

  return [
    'You are acting as an independent second-model verifier for an AI coding workspace.',
    '',
    'Review the current diff for correctness, regression risk, incomplete implementation, missing tests, and hollow or misleading verification.',
    'Be direct. Do not rewrite the whole patch. Return concise Markdown with these sections:',
    '',
    '1. Verdict: PASS, PASS_WITH_NOTES, or BLOCK',
    '2. Highest-risk issues',
    '3. Missing verification',
    '4. Suggested next action',
    '',
    'Workspace status:',
    input.statusSummary,
    '',
    'Deterministic safety scan:',
    safetyFindings,
    '',
    'Diff:',
    '```diff',
    clippedDiff,
    '```',
  ].join('\n');
}

export async function runMultiModelVerification(input: MultiModelVerificationInput): Promise<MultiModelVerificationResult> {
  const previousModel = input.provider.getModelId?.();
  if (input.modelId && input.provider.setModel) {
    input.provider.setModel(input.modelId);
  }

  try {
    const effectiveModel = input.provider.getModelId?.() || input.modelId;
    const response = await input.provider.sendMessage(
      [{ role: 'user', content: buildMultiModelVerificationPrompt(input) }],
      undefined,
      'You are a rigorous code-review verifier. You look for real defects, hollow tests, unsafe shortcuts, and missing evidence. Keep the answer concise and actionable.'
    );

    return {
      providerName: input.providerName,
      modelId: effectiveModel,
      review: response.content.trim() || '(verifier returned no text)',
      usage: response.usage,
    };
  } finally {
    if (input.modelId && previousModel && input.provider.setModel) {
      input.provider.setModel(previousModel);
    }
  }
}

export function formatMultiModelVerificationResult(result: MultiModelVerificationResult): string {
  const usage = result.usage
    ? `\n\nTokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`
    : '';
  return [
    `## Multi-Model Verification: ${result.providerName}${result.modelId ? ` / ${result.modelId}` : ''}`,
    '',
    result.review,
    usage,
  ].join('\n');
}
