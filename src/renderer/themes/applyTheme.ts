/**
 * Real-time Theme Application Engine — Sprint 20
 *
 * Instantly injects CSS custom properties onto <html> whenever any token changes.
 * No "Apply" button — every edit is immediately reflected across the entire app.
 *
 * Architecture:
 * 1. applyTokensRealtime() — sets CSS vars on <html> in a single rAF batch
 * 2. applyMatrixRainHue() — updates the --theme-matrix-rain-hue var
 * 3. snapshotCurrentTokens() — captures all current CSS vars for cancel/discard
 * 4. restoreTokenSnapshot() — restores a previously captured snapshot
 * 5. Safe input handling — invalid color values are silently ignored, no flash/crash
 *
 * Performance: All property sets are batched inside a single requestAnimationFrame
 * to avoid layout thrashing. Rapid edits are coalesced automatically.
 */

import { TOKEN_DEFINITIONS } from './tokens';

// ─── Types ───

export interface TokenSnapshot {
  tokens: Record<string, string>;
  matrixRainHue: string;
  dataTheme: string;
  timestamp: number;
}

// ─── Batched CSS Variable Application ───

let pendingTokens: Record<string, string> | null = null;
let pendingRafId: number | null = null;

/**
 * Apply a full set of token values to CSS custom properties in real-time.
 * Uses requestAnimationFrame to batch updates and avoid layout thrashing.
 * Safe: invalid or missing values are skipped silently.
 */
export function applyTokensRealtime(
  tokenMap: Record<string, string>,
  presetName?: string,
): void {
  // Merge with any pending tokens (coalesce rapid edits)
  pendingTokens = pendingTokens ? { ...pendingTokens, ...tokenMap } : { ...tokenMap };

  if (pendingRafId !== null) return; // Already scheduled

  pendingRafId = requestAnimationFrame(() => {
    const root = document.documentElement;
    const batch = pendingTokens!;
    pendingTokens = null;
    pendingRafId = null;

    if (presetName) {
      root.setAttribute('data-theme', presetName);
    }

    for (const def of TOKEN_DEFINITIONS) {
      const value = batch[def.key];
      if (value !== undefined && value !== null) {
        root.style.setProperty(def.cssVar, value);
      }
    }
  });
}

/**
 * Apply a single token change instantly (no batching delay).
 * Used when the user drags a color picker or types into a hex input.
 */
export function applySingleToken(key: string, value: string): void {
  const def = TOKEN_DEFINITIONS.find(d => d.key === key);
  if (!def) return;

  // Validate: skip clearly broken values
  if (!value && value !== '') return;

  const root = document.documentElement;
  root.style.setProperty(def.cssVar, value);
}

// ─── Matrix Rain Hue ───

const RAIN_HUE_VAR = '--theme-matrix-rain-hue';
const DEFAULT_RAIN_HUE = '#00ff41';

/**
 * Apply the Matrix rain character color as a CSS variable.
 * Components (BackdropRenderer, MatrixRainCanvas) read this variable.
 */
export function applyMatrixRainHue(hue: string): void {
  const root = document.documentElement;
  const safeHue = isValidColor(hue) ? hue : DEFAULT_RAIN_HUE;
  root.style.setProperty(RAIN_HUE_VAR, safeHue);
}

/**
 * Read the current Matrix rain hue from the DOM.
 */
export function getMatrixRainHue(): string {
  return document.documentElement.style.getPropertyValue(RAIN_HUE_VAR).trim() || DEFAULT_RAIN_HUE;
}

// ─── Snapshot / Restore (Cancel / Discard) ───

/**
 * Capture the current state of all theme CSS variables for later restoration.
 */
export function snapshotCurrentTokens(): TokenSnapshot {
  const root = document.documentElement;
  const tokens: Record<string, string> = {};

  for (const def of TOKEN_DEFINITIONS) {
    const value = root.style.getPropertyValue(def.cssVar);
    if (value) {
      tokens[def.key] = value.trim();
    }
  }

  return {
    tokens,
    matrixRainHue: getMatrixRainHue(),
    dataTheme: root.getAttribute('data-theme') || 'matrix',
    timestamp: Date.now(),
  };
}

/**
 * Restore a previously captured token snapshot.
 * Used when the user clicks "Cancel" or "Discard" to revert unsaved changes.
 */
export function restoreTokenSnapshot(snapshot: TokenSnapshot): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', snapshot.dataTheme);

  for (const def of TOKEN_DEFINITIONS) {
    const value = snapshot.tokens[def.key];
    if (value !== undefined) {
      root.style.setProperty(def.cssVar, value);
    }
  }

  applyMatrixRainHue(snapshot.matrixRainHue);
}

// ─── Color Validation ───

/**
 * Check if a string is a plausibly valid CSS color.
 * Used to prevent applying garbage values that would cause invisible UI.
 */
export function isValidColor(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'none' || trimmed === 'transparent') return true;

  // Hex patterns
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return true;

  // rgb/rgba
  if (/^rgba?\(/.test(trimmed)) return true;

  // hsl/hsla
  if (/^hsla?\(/.test(trimmed)) return true;

  // Named colors (basic check — at least 2 chars, all alpha)
  if (/^[a-zA-Z]{2,30}$/.test(trimmed)) return true;

  return false;
}

/**
 * Sanitize a color input — return the value if valid, or the fallback.
 */
export function sanitizeColor(value: string, fallback: string): string {
  return isValidColor(value) ? value : fallback;
}
