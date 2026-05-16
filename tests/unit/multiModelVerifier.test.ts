import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildMultiModelVerificationPrompt,
  formatMultiModelVerificationResult,
  runMultiModelVerification,
} from '../../src/main/orchestration/multiModelVerifier';
import type { ILLMProvider } from '../../src/main/domain/interfaces';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('multiModelVerifier', () => {
  it('builds a second-model prompt with diff and deterministic safety findings', () => {
    const prompt = buildMultiModelVerificationPrompt({
      providerName: 'openai',
      modelId: 'gpt-4o-mini',
      statusSummary: 'Branch: main',
      diffText: '+expect(true).toBe(true)',
      cardboardScan: {
        score: 80,
        scannedFiles: 1,
        findings: [{
          ruleId: 'cardboard-hollow-assertion',
          severity: 'high',
          filePath: 'tests/example.test.ts',
          line: 1,
          summary: 'A test assertion appears tautological or too shallow to prove behavior.',
          evidence: 'expect(true).toBe(true)',
        }],
      },
    });

    expect(prompt).toContain('independent second-model verifier');
    expect(prompt).toContain('cardboard-hollow-assertion');
    expect(prompt).toContain('```diff');
  });

  it('temporarily switches provider model and restores it after review', async () => {
    let model = 'original-model';
    const provider: ILLMProvider = {
      name: 'mock',
      sendMessage: vi.fn().mockResolvedValue({
        content: 'Verdict: PASS_WITH_NOTES',
        usage: { inputTokens: 10, outputTokens: 4 },
        stopReason: 'end_turn',
      }),
      streamMessage: vi.fn() as any,
      countTokens: vi.fn().mockReturnValue(1),
      getModelId: () => model,
      setModel: (next: string) => { model = next; },
    };

    const result = await runMultiModelVerification({
      provider,
      providerName: 'mock',
      modelId: 'second-model',
      diffText: '+const x = 1;',
      statusSummary: 'Branch: main',
    });

    expect(result.modelId).toBe('second-model');
    expect(result.review).toContain('PASS_WITH_NOTES');
    expect(model).toBe('original-model');
  });

  it('formats verification output as markdown', () => {
    const markdown = formatMultiModelVerificationResult({
      providerName: 'openai',
      modelId: 'gpt-4o-mini',
      review: 'Verdict: BLOCK',
      usage: { inputTokens: 12, outputTokens: 6 },
    });
    expect(markdown).toContain('Multi-Model Verification: openai / gpt-4o-mini');
    expect(markdown).toContain('Tokens: 12 in / 6 out');
  });

  it('wires /verify-with into commands and slash autocomplete', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    const dropdownSrc = readSrc('renderer/components/chat/SlashCommandDropdown.tsx');
    expect(commandsSrc).toContain("name: 'verify-with'");
    expect(commandsSrc).toContain('runMultiModelVerification');
    expect(commandsSrc).toContain('providerRegistry.get(providerName)');
    expect(dropdownSrc).toContain("'verify-with'");
  });
});
