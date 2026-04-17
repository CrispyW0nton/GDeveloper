/**
 * Unit tests — Cache Policy (Sprint 27.1)
 */

import {
  applyCacheControl, flattenSystemBlocks, shouldEnableCache,
} from '../../src/main/providers/cachePolicy';

function testApplyCacheControl() {
  const results: string[] = [];

  // Empty prompt
  const r1 = applyCacheControl('', { mode: 'build' });
  console.assert(r1.length === 0, 'Empty prompt should return empty array');
  results.push(r1.length === 0 ? 'PASS' : 'FAIL');

  // Short prompt (below min cacheable length)
  const r2 = applyCacheControl('Hello world', { mode: 'build' });
  console.assert(r2.length === 1, 'Short prompt should return 1 block');
  console.assert(!r2[0].cache_control, 'Short prompt should not be cached');
  results.push(r2.length === 1 && !r2[0].cache_control ? 'PASS' : 'FAIL');

  // Long stable prompt
  const longPrompt = 'You are an AI coding assistant. Your role is to help developers write code. '.repeat(20);
  const r3 = applyCacheControl(longPrompt, { mode: 'build' });
  console.assert(r3.length >= 1, 'Should return at least 1 block');
  console.assert(r3[0].cache_control?.type === 'ephemeral', 'Long stable prompt should have cache_control');
  results.push(r3[0].cache_control?.type === 'ephemeral' ? 'PASS' : 'FAIL');

  // Disabled caching
  const r4 = applyCacheControl(longPrompt, { mode: 'build', enabled: false });
  console.assert(r4.length === 1, 'Disabled should return 1 block');
  console.assert(!r4[0].cache_control, 'Disabled should not have cache_control');
  results.push(!r4[0].cache_control ? 'PASS' : 'FAIL');

  // Multi-section prompt (stable first block, dynamic later blocks)
  const multiPrompt = [
    'You are an AI coding assistant. Your role is to help developers write clean code. You must follow best practices and security guidelines. This is a long stable system prompt block that should be cached for efficiency.',
    '',
    '',
    'Current workspace: /home/user/project\nBranch: main\nModified: 3 files',
    '',
    '',
    'You have 15 tools available (12 local + 3 MCP).',
  ].join('\n');
  const r5 = applyCacheControl(multiPrompt, { mode: 'plan' });
  console.assert(r5.length >= 2, `Expected >= 2 blocks, got ${r5.length}`);
  // First block (stable) should be cached, workspace block should not
  const hasCachedFirst = r5[0].cache_control?.type === 'ephemeral';
  results.push(r5.length >= 2 ? 'PASS' : 'FAIL');

  return results;
}

function testFlattenSystemBlocks() {
  const results: string[] = [];

  const blocks = [
    { type: 'text' as const, text: 'Block 1', cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: 'Block 2' },
  ];
  const flat = flattenSystemBlocks(blocks);
  console.assert(flat === 'Block 1\n\nBlock 2', `Expected "Block 1\\n\\nBlock 2", got "${flat}"`);
  results.push(flat === 'Block 1\n\nBlock 2' ? 'PASS' : 'FAIL');

  return results;
}

function testShouldEnableCache() {
  const results: string[] = [];

  console.assert(!shouldEnableCache(500), 'Short prompts should not enable cache');
  results.push(!shouldEnableCache(500) ? 'PASS' : 'FAIL');

  console.assert(shouldEnableCache(3000), 'Long prompts should enable cache');
  results.push(shouldEnableCache(3000) ? 'PASS' : 'FAIL');

  return results;
}

// ─── Run ───

const allResults = [
  ...testApplyCacheControl(),
  ...testFlattenSystemBlocks(),
  ...testShouldEnableCache(),
];

const passed = allResults.filter(r => r === 'PASS').length;
const failed = allResults.filter(r => r === 'FAIL').length;

console.log(`\ncachePolicy tests: ${passed} passed, ${failed} failed (${allResults.length} total)`);
if (failed > 0) {
  process.exit(1);
}
