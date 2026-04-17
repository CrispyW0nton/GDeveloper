/**
 * External Verify Spec Loader — Sprint 27.1 (Block 2)
 *
 * Loads human-authored verification specifications from YAML/JSON files.
 * These specs define deterministic assertions for /verify-last --spec.
 * Prevents the AI from hallucinating its own pass criteria — the source of
 * truth is always the spec file committed to the repo.
 *
 * Spec file format (YAML):
 *   name: "D19 Pre-flight Audit"
 *   version: "1.0"
 *   description: "Assertions for GhostRigger D19 handoff readiness"
 *   assertions:
 *     - FILE_EXISTS src/main/mcp/index.ts
 *     - FILE_CONTAINS package.json "@modelcontextprotocol"
 *     - COMMAND_SUCCEEDS npx tsc --noEmit
 *   threshold: 0.95
 *   tags:
 *     - d19
 *     - pre-flight
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, extname, resolve, basename } from 'path';
import { parse as parseYAML } from 'yaml';

// ─── Types ───

export interface VerifySpec {
  /** Spec file path (absolute) */
  filePath: string;
  /** Human-readable spec name */
  name: string;
  /** Spec version */
  version: string;
  /** Description of what this spec validates */
  description: string;
  /** Array of assertion strings (same DSL as /verify) */
  assertions: string[];
  /** Minimum pass threshold (0-1, default 0.95) */
  threshold: number;
  /** Optional tags for filtering */
  tags: string[];
}

export interface SpecLoadResult {
  success: boolean;
  spec?: VerifySpec;
  error?: string;
}

// ─── Constants ───

/** Default directory for verify specs (relative to workspace root) */
export const SPEC_DIR = '.gdeveloper/verify-specs';

/** Supported extensions */
const SUPPORTED_EXTENSIONS = new Set(['.yaml', '.yml', '.json']);

// ─── Public API ───

/**
 * Load a verify spec from a file path.
 * Supports YAML (.yaml, .yml) and JSON (.json).
 */
export function loadVerifySpec(filePath: string): SpecLoadResult {
  try {
    if (!existsSync(filePath)) {
      return { success: false, error: `Spec file not found: ${filePath}` };
    }

    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return { success: false, error: `Unsupported file extension: ${ext}. Use .yaml, .yml, or .json` };
    }

    const raw = readFileSync(filePath, 'utf-8');
    let parsed: any;

    if (ext === '.json') {
      parsed = JSON.parse(raw);
    } else {
      parsed = parseYAML(raw);
    }

    // Validate required fields
    if (!parsed || typeof parsed !== 'object') {
      return { success: false, error: 'Spec file is empty or not a valid object' };
    }

    if (!parsed.assertions || !Array.isArray(parsed.assertions) || parsed.assertions.length === 0) {
      return { success: false, error: 'Spec must contain a non-empty "assertions" array' };
    }

    // Validate each assertion is a non-empty string
    for (let i = 0; i < parsed.assertions.length; i++) {
      if (typeof parsed.assertions[i] !== 'string' || parsed.assertions[i].trim().length === 0) {
        return { success: false, error: `Assertion ${i + 1} is not a valid non-empty string` };
      }
    }

    const spec: VerifySpec = {
      filePath: resolve(filePath),
      name: parsed.name || basename(filePath, ext),
      version: String(parsed.version || '1.0'),
      description: parsed.description || '',
      assertions: parsed.assertions.map((a: string) => a.trim()),
      threshold: typeof parsed.threshold === 'number' ? parsed.threshold : 0.95,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };

    return { success: true, spec };
  } catch (err) {
    return {
      success: false,
      error: `Failed to load spec: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * List all spec files in the workspace's .gdeveloper/verify-specs directory.
 */
export function listVerifySpecs(workspacePath: string): VerifySpec[] {
  const specDir = join(workspacePath, SPEC_DIR);
  if (!existsSync(specDir)) return [];

  const specs: VerifySpec[] = [];

  try {
    const files = readdirSync(specDir);
    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const fullPath = join(specDir, file);
      const result = loadVerifySpec(fullPath);
      if (result.success && result.spec) {
        specs.push(result.spec);
      }
    }
  } catch {
    // Directory read failed — return empty
  }

  return specs;
}

/**
 * Find a spec by name or tag in the workspace.
 */
export function findVerifySpec(
  workspacePath: string,
  nameOrTag: string,
): VerifySpec | null {
  const specs = listVerifySpecs(workspacePath);
  const normalized = nameOrTag.toLowerCase().trim();

  // First try exact name match
  const byName = specs.find(s => s.name.toLowerCase() === normalized);
  if (byName) return byName;

  // Then try filename match (without extension)
  const byFile = specs.find(s =>
    basename(s.filePath).toLowerCase().replace(/\.(yaml|yml|json)$/, '') === normalized
  );
  if (byFile) return byFile;

  // Then try tag match
  const byTag = specs.find(s => s.tags.some(t => t.toLowerCase() === normalized));
  if (byTag) return byTag;

  return null;
}

/**
 * Resolve a --spec argument to a VerifySpec.
 * Accepts:
 *   - An absolute or relative file path
 *   - A spec name or tag (looked up in .gdeveloper/verify-specs/)
 */
export function resolveSpecArg(
  specArg: string,
  workspacePath: string,
): SpecLoadResult {
  const trimmed = specArg.trim();

  // If it looks like a file path (has extension or path separator)
  if (trimmed.includes('/') || trimmed.includes('\\') || SUPPORTED_EXTENSIONS.has(extname(trimmed).toLowerCase())) {
    const absPath = trimmed.startsWith('/')
      ? trimmed
      : resolve(workspacePath, trimmed);
    return loadVerifySpec(absPath);
  }

  // Otherwise, try to find by name/tag
  const found = findVerifySpec(workspacePath, trimmed);
  if (found) {
    return { success: true, spec: found };
  }

  // Last resort: try as a path in the spec directory
  for (const ext of ['.yaml', '.yml', '.json']) {
    const candidate = join(workspacePath, SPEC_DIR, trimmed + ext);
    if (existsSync(candidate)) {
      return loadVerifySpec(candidate);
    }
  }

  return { success: false, error: `Spec "${trimmed}" not found. Check .gdeveloper/verify-specs/ or provide a file path.` };
}
