/**
 * Unit tests — Write-Scope Enforcement (Sprint 27.1)
 */

import {
  setWriteScope, getWriteScope, clearWriteScope,
  isWriteAllowed, parseWriteScopeArgs,
} from '../../src/main/mode/writeScope';

// ─── parseWriteScopeArgs ───

function testParseWriteScopeArgs() {
  const results: string[] = [];

  // No flag
  const r1 = parseWriteScopeArgs('');
  console.assert(r1.length === 0, 'Empty args should return []');
  results.push(r1.length === 0 ? 'PASS' : 'FAIL');

  // Single path
  const r2 = parseWriteScopeArgs('--write-scope audit/');
  console.assert(r2.length === 1 && r2[0] === 'audit/', `Expected ["audit/"], got ${JSON.stringify(r2)}`);
  results.push(r2.length === 1 && r2[0] === 'audit/' ? 'PASS' : 'FAIL');

  // Multiple paths
  const r3 = parseWriteScopeArgs('--write-scope audit/,reports/,docs/');
  console.assert(r3.length === 3, `Expected 3 prefixes, got ${r3.length}`);
  results.push(r3.length === 3 ? 'PASS' : 'FAIL');

  // Path without trailing slash
  const r4 = parseWriteScopeArgs('--write-scope audit');
  console.assert(r4[0] === 'audit/', `Expected "audit/", got "${r4[0]}"`);
  results.push(r4[0] === 'audit/' ? 'PASS' : 'FAIL');

  return results;
}

// ─── isWriteAllowed ───

function testIsWriteAllowed() {
  const results: string[] = [];

  // Build mode: always allowed
  const r1 = isWriteAllowed('write_file', { path: 'src/index.ts' }, '/ws', true, 'build');
  console.assert(r1.allowed, 'Build mode should allow all writes');
  results.push(r1.allowed ? 'PASS' : 'FAIL');

  // Plan mode, not a write tool: allowed
  const r2 = isWriteAllowed('read_file', { path: 'src/index.ts' }, '/ws', false, 'plan');
  console.assert(r2.allowed, 'Non-write tool in plan mode should be allowed');
  results.push(r2.allowed ? 'PASS' : 'FAIL');

  // Plan mode, write tool, no scope: blocked
  clearWriteScope();
  const r3 = isWriteAllowed('write_file', { path: 'src/index.ts' }, '/ws', true, 'plan');
  console.assert(!r3.allowed, 'Write tool in plan mode without scope should be blocked');
  results.push(!r3.allowed ? 'PASS' : 'FAIL');

  // Plan mode, write tool, scope active, inside scope: allowed
  setWriteScope(['audit/']);
  const r4 = isWriteAllowed('write_file', { path: 'audit/report.md' }, '/ws', true, 'plan');
  console.assert(r4.allowed, 'Write to audit/ should be allowed with audit/ scope');
  results.push(r4.allowed ? 'PASS' : 'FAIL');

  // Plan mode, write tool, scope active, outside scope: blocked
  const r5 = isWriteAllowed('write_file', { path: 'src/index.ts' }, '/ws', true, 'plan');
  console.assert(!r5.allowed, 'Write to src/ should be blocked with audit/ scope');
  results.push(!r5.allowed ? 'PASS' : 'FAIL');

  // Plan mode, run_command: always blocked with scope
  const r6 = isWriteAllowed('run_command', { command: 'echo hi' }, '/ws', true, 'plan');
  console.assert(!r6.allowed, 'run_command should be blocked in plan mode with scope');
  results.push(!r6.allowed ? 'PASS' : 'FAIL');

  // Cleanup
  clearWriteScope();

  return results;
}

// ─── getWriteScope / clearWriteScope ───

function testWriteScopeState() {
  const results: string[] = [];

  clearWriteScope();
  const s1 = getWriteScope();
  console.assert(!s1.active, 'Should be inactive after clear');
  results.push(!s1.active ? 'PASS' : 'FAIL');

  setWriteScope(['audit/', 'reports/']);
  const s2 = getWriteScope();
  console.assert(s2.active, 'Should be active after set');
  console.assert(s2.prefixes.length === 2, 'Should have 2 prefixes');
  results.push(s2.active && s2.prefixes.length === 2 ? 'PASS' : 'FAIL');

  clearWriteScope();
  const s3 = getWriteScope();
  console.assert(!s3.active, 'Should be inactive after clear');
  results.push(!s3.active ? 'PASS' : 'FAIL');

  return results;
}

// ─── Run all tests ───

const allResults = [
  ...testParseWriteScopeArgs(),
  ...testIsWriteAllowed(),
  ...testWriteScopeState(),
];

const passed = allResults.filter(r => r === 'PASS').length;
const failed = allResults.filter(r => r === 'FAIL').length;

console.log(`\nwriteScope tests: ${passed} passed, ${failed} failed (${allResults.length} total)`);
if (failed > 0) {
  process.exit(1);
}
