/**
 * Unit tests — Verify Spec Loader (Sprint 27.1)
 */

import { existsSync } from 'fs';
import { join } from 'path';
import {
  loadVerifySpec, listVerifySpecs, findVerifySpec, resolveSpecArg,
} from '../../src/main/orchestration/verifySpecLoader';

const WORKSPACE = join(__dirname, '..', '..');

function testLoadSpec() {
  const results: string[] = [];

  // Load d19-preflight.yaml
  const r1 = loadVerifySpec(join(WORKSPACE, '.gdeveloper/verify-specs/d19-preflight.yaml'));
  console.assert(r1.success, `Expected success, got error: ${r1.error}`);
  console.assert(r1.spec!.name === 'D19 Pre-flight Audit', `Expected name "D19 Pre-flight Audit", got "${r1.spec?.name}"`);
  console.assert(r1.spec!.assertions.length > 0, 'Assertions should be non-empty');
  console.assert(r1.spec!.threshold === 0.95, `Expected threshold 0.95, got ${r1.spec?.threshold}`);
  results.push(r1.success && r1.spec!.assertions.length > 0 ? 'PASS' : 'FAIL');

  // Load self-audit.yaml
  const r2 = loadVerifySpec(join(WORKSPACE, '.gdeveloper/verify-specs/self-audit.yaml'));
  console.assert(r2.success, `Expected success, got error: ${r2.error}`);
  console.assert(r2.spec!.tags.includes('sprint-27.1'), 'Should have sprint-27.1 tag');
  results.push(r2.success ? 'PASS' : 'FAIL');

  // Non-existent file
  const r3 = loadVerifySpec('/nonexistent/spec.yaml');
  console.assert(!r3.success, 'Should fail for non-existent file');
  results.push(!r3.success ? 'PASS' : 'FAIL');

  // Unsupported extension
  const r4 = loadVerifySpec(join(WORKSPACE, 'package.json'));
  // package.json is valid JSON but won't have assertions
  console.assert(!r4.success || (r4.spec?.assertions.length === 0), 'package.json should fail validation');
  results.push(!r4.success ? 'PASS' : 'FAIL');

  return results;
}

function testListSpecs() {
  const results: string[] = [];

  const specs = listVerifySpecs(WORKSPACE);
  console.assert(specs.length >= 2, `Expected >= 2 specs, got ${specs.length}`);
  results.push(specs.length >= 2 ? 'PASS' : 'FAIL');

  // Check names
  const names = specs.map(s => s.name);
  console.assert(names.includes('D19 Pre-flight Audit'), `Missing D19 Pre-flight Audit spec`);
  console.assert(names.includes('Self-Audit Dry Run'), `Missing Self-Audit Dry Run spec`);
  results.push(names.includes('D19 Pre-flight Audit') && names.includes('Self-Audit Dry Run') ? 'PASS' : 'FAIL');

  return results;
}

function testFindSpec() {
  const results: string[] = [];

  // Find by name
  const r1 = findVerifySpec(WORKSPACE, 'D19 Pre-flight Audit');
  console.assert(r1 !== null, 'Should find by name');
  results.push(r1 !== null ? 'PASS' : 'FAIL');

  // Find by tag
  const r2 = findVerifySpec(WORKSPACE, 'sprint-27.1');
  console.assert(r2 !== null, 'Should find by tag');
  results.push(r2 !== null ? 'PASS' : 'FAIL');

  // Find by filename
  const r3 = findVerifySpec(WORKSPACE, 'd19-preflight');
  console.assert(r3 !== null, 'Should find by filename');
  results.push(r3 !== null ? 'PASS' : 'FAIL');

  // Not found
  const r4 = findVerifySpec(WORKSPACE, 'nonexistent-spec');
  console.assert(r4 === null, 'Should return null for unknown spec');
  results.push(r4 === null ? 'PASS' : 'FAIL');

  return results;
}

function testResolveSpecArg() {
  const results: string[] = [];

  // Resolve by file path
  const r1 = resolveSpecArg('.gdeveloper/verify-specs/d19-preflight.yaml', WORKSPACE);
  console.assert(r1.success, `Should resolve by path, got: ${r1.error}`);
  results.push(r1.success ? 'PASS' : 'FAIL');

  // Resolve by name
  const r2 = resolveSpecArg('d19-preflight', WORKSPACE);
  console.assert(r2.success, `Should resolve by name, got: ${r2.error}`);
  results.push(r2.success ? 'PASS' : 'FAIL');

  // Resolve non-existent
  const r3 = resolveSpecArg('nonexistent', WORKSPACE);
  console.assert(!r3.success, 'Should fail for non-existent');
  results.push(!r3.success ? 'PASS' : 'FAIL');

  return results;
}

// ─── Run ───

const allResults = [
  ...testLoadSpec(),
  ...testListSpecs(),
  ...testFindSpec(),
  ...testResolveSpecArg(),
];

const passed = allResults.filter(r => r === 'PASS').length;
const failed = allResults.filter(r => r === 'FAIL').length;

console.log(`\nverifySpecLoader tests: ${passed} passed, ${failed} failed (${allResults.length} total)`);
if (failed > 0) {
  process.exit(1);
}
