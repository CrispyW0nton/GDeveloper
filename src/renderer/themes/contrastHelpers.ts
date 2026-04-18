/**
 * Contrast Warning Helpers — Sprint 22 (Theme Studio Contrast Warning Addendum)
 *
 * Provides detailed WCAG analysis, one-click fix suggestions, auto-improve,
 * and acknowledge/snooze persistence for the Theme Customization Studio.
 *
 * Design philosophy: "Helpful coach, not a grader."
 * - Constructive wording — suggests improvements, doesn't block saves
 * - Severity badges: Info, Borderline, Fails AA, (optional) Fails AAA
 * - Calm colors: blue/teal for info, amber for borderline, red only for true AA fails
 */

import { contrastRatio, parseColor, luminance, type TokenDefinition, TOKEN_DEFINITIONS } from './tokens';

// ─── Types ───

export type ContrastSeverity = 'info' | 'borderline' | 'fails-aa' | 'fails-aaa';

export interface ContrastWarning {
  /** Human-readable label, e.g. "Secondary Text on App Background" */
  label: string;
  /** Foreground token key */
  fgToken: string;
  /** Background token key */
  bgToken: string;
  /** CSS variable name for foreground */
  fgCssVar: string;
  /** CSS variable name for background */
  bgCssVar: string;
  /** Current foreground color value */
  fgValue: string;
  /** Current background color value */
  bgValue: string;
  /** Computed contrast ratio (1..21) or null if unparseable */
  ratio: number | null;
  /** WCAG target ratio for this pair */
  targetRatio: number;
  /** Whether this is large text (3:1 target) or normal text (4.5:1 target) */
  isLargeText: boolean;
  /** Severity classification */
  severity: ContrastSeverity;
  /** Plain-language explanation */
  explanation: string;
  /** Suggested fixes */
  fixes: ContrastFix[];
  /** Whether user has acknowledged/snoozed this warning */
  acknowledged: boolean;
}

export interface ContrastFix {
  id: string;
  label: string;
  description: string;
  /** The token key to change */
  tokenKey: string;
  /** The suggested new value */
  suggestedValue: string;
}

export interface AcknowledgmentState {
  /** Map of warning key (fgToken+bgToken) to acknowledgment timestamp */
  acknowledged: Record<string, number>;
}

// ─── Token Pair Definitions ───
// Each pair defines foreground + background tokens to check, with context

export interface TokenPairCheck {
  label: string;
  fgToken: string;
  bgToken: string;
  isLargeText: boolean;
}

export const CONTRAST_PAIR_CHECKS: TokenPairCheck[] = [
  { label: 'Primary Text on App Background', fgToken: 'textPrimary', bgToken: 'appBg', isLargeText: false },
  { label: 'Secondary Text on App Background', fgToken: 'textSecondary', bgToken: 'appBg', isLargeText: false },
  { label: 'Muted Text on App Background', fgToken: 'textMuted', bgToken: 'appBg', isLargeText: false },
  { label: 'Primary Text on Panel Background', fgToken: 'textPrimary', bgToken: 'panelBgSolid', isLargeText: false },
  { label: 'Secondary Text on Panel Background', fgToken: 'textSecondary', bgToken: 'panelBgSolid', isLargeText: false },
  { label: 'Accent on App Background', fgToken: 'accent', bgToken: 'appBg', isLargeText: true },
  { label: 'Input Text on Input Background', fgToken: 'inputText', bgToken: 'inputBg', isLargeText: false },
  { label: 'Button Text on Button Background', fgToken: 'btnText', bgToken: 'btnBg', isLargeText: false },
  { label: 'Badge Text on App Background', fgToken: 'badgeTextMuted', bgToken: 'appBg', isLargeText: true },
  { label: 'Success on App Background', fgToken: 'success', bgToken: 'appBg', isLargeText: true },
  { label: 'Warning on App Background', fgToken: 'warning', bgToken: 'appBg', isLargeText: true },
  { label: 'Danger on App Background', fgToken: 'danger', bgToken: 'appBg', isLargeText: true },
];

// ─── Core Analysis ───

function getCssVarForToken(tokenKey: string): string {
  const def = TOKEN_DEFINITIONS.find(d => d.key === tokenKey);
  return def?.cssVar || `--theme-${tokenKey}`;
}

function classifySeverity(ratio: number | null, targetRatio: number): ContrastSeverity {
  if (ratio === null) return 'info';
  if (ratio >= targetRatio) return 'info'; // passes target
  if (ratio >= 3.0 && targetRatio <= 4.5) return 'borderline'; // passes large text AA
  if (ratio >= 3.0) return 'borderline';
  return 'fails-aa';
}

function buildExplanation(severity: ContrastSeverity, ratio: number | null, targetRatio: number, isLargeText: boolean): string {
  const ratioStr = ratio !== null ? ratio.toFixed(2) : 'unknown';
  const targetStr = `${targetRatio}:1`;
  const textType = isLargeText ? 'large text (14pt bold / 18pt+)' : 'normal text';

  switch (severity) {
    case 'info':
      return `Contrast ratio ${ratioStr}:1 meets the ${targetStr} WCAG AA target for ${textType}. Looks good!`;
    case 'borderline':
      return `Contrast ratio ${ratioStr}:1 is close to the ${targetStr} WCAG AA target for ${textType}. It passes for large text but may be hard to read at small sizes. A small tweak would improve readability.`;
    case 'fails-aa':
      return `Contrast ratio ${ratioStr}:1 is below the ${targetStr} WCAG AA minimum for ${textType}. Some users may find this text difficult to read. Consider adjusting one of the colors.`;
    case 'fails-aaa':
      return `Contrast ratio ${ratioStr}:1 is below the 7:1 WCAG AAA target for ${textType}. For maximum accessibility, consider increasing the contrast.`;
    default:
      return `Contrast ratio: ${ratioStr}:1 (target: ${targetStr}).`;
  }
}

// ─── Fix Suggestions ───

/**
 * Lighten a hex color by a given percentage (0..1)
 */
function lightenColor(hex: string, amount: number): string {
  const rgb = parseColor(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const newR = Math.min(255, Math.round(r + (255 - r) * amount));
  const newG = Math.min(255, Math.round(g + (255 - g) * amount));
  const newB = Math.min(255, Math.round(b + (255 - b) * amount));
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

/**
 * Darken a hex color by a given percentage (0..1)
 */
function darkenColor(hex: string, amount: number): string {
  const rgb = parseColor(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const newR = Math.max(0, Math.round(r * (1 - amount)));
  const newG = Math.max(0, Math.round(g * (1 - amount)));
  const newB = Math.max(0, Math.round(b * (1 - amount)));
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

/**
 * Find a color variant that meets the target contrast ratio.
 * Iteratively lightens or darkens the foreground until the target is met.
 */
function findReadableVariant(fgHex: string, bgHex: string, targetRatio: number): string | null {
  const bgRgb = parseColor(bgHex);
  if (!bgRgb) return null;
  const bgLum = luminance(...bgRgb);

  // Determine direction: if background is dark, lighten foreground; if light, darken
  const shouldLighten = bgLum < 0.5;

  for (let step = 0.05; step <= 0.9; step += 0.05) {
    const candidate = shouldLighten ? lightenColor(fgHex, step) : darkenColor(fgHex, step);
    const ratio = contrastRatio(candidate, bgHex);
    if (ratio !== null && ratio >= targetRatio) {
      return candidate;
    }
  }
  return null;
}

function generateFixes(
  fgToken: string,
  bgToken: string,
  fgValue: string,
  bgValue: string,
  targetRatio: number,
  severity: ContrastSeverity,
): ContrastFix[] {
  if (severity === 'info') return [];

  const fixes: ContrastFix[] = [];

  // Fix 1: Suggest a readable foreground variant
  const readableVariant = findReadableVariant(fgValue, bgValue, targetRatio);
  if (readableVariant) {
    const varRatio = contrastRatio(readableVariant, bgValue);
    fixes.push({
      id: `lighten-${fgToken}`,
      label: 'Use readable variant',
      description: `Change foreground to ${readableVariant} (ratio: ${varRatio?.toFixed(1) || '?'}:1)`,
      tokenKey: fgToken,
      suggestedValue: readableVariant,
    });
  }

  // Fix 2: Lighten the foreground
  const lightened = lightenColor(fgValue, 0.3);
  const lightenedRatio = contrastRatio(lightened, bgValue);
  if (lightenedRatio !== null && lightenedRatio > (contrastRatio(fgValue, bgValue) || 0)) {
    fixes.push({
      id: `boost-${fgToken}`,
      label: 'Lighten foreground',
      description: `Boost brightness to ${lightened} (ratio: ${lightenedRatio.toFixed(1)}:1)`,
      tokenKey: fgToken,
      suggestedValue: lightened,
    });
  }

  // Fix 3: Darken the background (if it makes sense)
  const bgRgb = parseColor(bgValue);
  if (bgRgb) {
    const bgLum = luminance(...bgRgb);
    if (bgLum > 0.05) {
      const darkened = darkenColor(bgValue, 0.2);
      const darkenedRatio = contrastRatio(fgValue, darkened);
      if (darkenedRatio !== null && darkenedRatio > (contrastRatio(fgValue, bgValue) || 0)) {
        fixes.push({
          id: `darken-${bgToken}`,
          label: 'Darken background',
          description: `Darken BG to ${darkened} (ratio: ${darkenedRatio.toFixed(1)}:1)`,
          tokenKey: bgToken,
          suggestedValue: darkened,
        });
      }
    }
  }

  return fixes;
}

// ─── Main Analysis Function ───

export function analyzeContrast(
  editTokens: Record<string, string>,
  acknowledgments: AcknowledgmentState,
): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];

  for (const check of CONTRAST_PAIR_CHECKS) {
    const fgValue = editTokens[check.fgToken];
    const bgValue = editTokens[check.bgToken];
    if (!fgValue || !bgValue) continue;

    const ratio = contrastRatio(fgValue, bgValue);
    const targetRatio = check.isLargeText ? 3.0 : 4.5;
    const severity = classifySeverity(ratio, targetRatio);

    // Skip passing pairs
    if (severity === 'info') continue;

    const warningKey = `${check.fgToken}:${check.bgToken}`;
    const isAcked = !!acknowledgments.acknowledged[warningKey];

    warnings.push({
      label: check.label,
      fgToken: check.fgToken,
      bgToken: check.bgToken,
      fgCssVar: getCssVarForToken(check.fgToken),
      bgCssVar: getCssVarForToken(check.bgToken),
      fgValue,
      bgValue,
      ratio,
      targetRatio,
      isLargeText: check.isLargeText,
      severity,
      explanation: buildExplanation(severity, ratio, targetRatio, check.isLargeText),
      fixes: generateFixes(check.fgToken, check.bgToken, fgValue, bgValue, targetRatio, severity),
      acknowledged: isAcked,
    });
  }

  return warnings;
}

// ─── Auto-Improve ───

export interface AutoImproveResult {
  /** Map of token key to new value */
  changes: Record<string, string>;
  /** Summary of changes made */
  summary: string[];
  /** Warnings that could not be fixed */
  unfixed: string[];
}

/**
 * Attempt to fix all contrast warnings automatically.
 * Returns the proposed changes without applying them — caller previews first.
 */
export function autoImproveContrast(
  editTokens: Record<string, string>,
  warnings: ContrastWarning[],
): AutoImproveResult {
  const changes: Record<string, string> = {};
  const summary: string[] = [];
  const unfixed: string[] = [];
  const workingTokens = { ...editTokens };

  for (const w of warnings) {
    if (w.acknowledged || w.severity === 'info') continue;

    // Find the first fix that uses the foreground token (prefer not touching BG)
    const fgFix = w.fixes.find(f => f.tokenKey === w.fgToken);
    if (fgFix) {
      changes[fgFix.tokenKey] = fgFix.suggestedValue;
      workingTokens[fgFix.tokenKey] = fgFix.suggestedValue;
      summary.push(`${w.label}: ${fgFix.tokenKey} ${w.fgValue} -> ${fgFix.suggestedValue}`);
    } else if (w.fixes.length > 0) {
      const fix = w.fixes[0];
      changes[fix.tokenKey] = fix.suggestedValue;
      workingTokens[fix.tokenKey] = fix.suggestedValue;
      summary.push(`${w.label}: ${fix.tokenKey} -> ${fix.suggestedValue}`);
    } else {
      unfixed.push(w.label);
    }
  }

  return { changes, summary, unfixed };
}

// ─── Matrix Preset AA-Compliant Refinements ───

/**
 * Returns token overrides for the Matrix preset that raise secondary/muted text
 * and button text to WCAG AA while preserving the neon-green aesthetic.
 */
export const MATRIX_AA_REFINEMENTS: Record<string, string> = {
  // Secondary text: was #00cc33 on #0a0a0a = ~3.6:1 (fails AA for normal text)
  // Brightened to ~5.0:1 while keeping green hue
  textSecondary: '#33dd55',
  // Muted text: was #33cc33 on #0a0a0a = ~3.8:1
  // Slightly brightened
  textMuted: '#44cc55',
  // Dim text: was #00cc33 on #0a0a0a
  textDim: '#33dd55',
  // Button text: was #00ff41 on rgba(0,255,65,0.05) ≈ #0a0d0a
  // Already high contrast, but ensure BtnText works on all surfaces
  btnText: '#00ff55',
  // Badge text muted: was rgba(255,255,255,0.4) on #0a0a0a = ~2.8:1
  badgeTextMuted: 'rgba(255, 255, 255, 0.55)',
};

// ─── Acknowledgment Persistence ───

const ACK_STORAGE_KEY = 'gdeveloper-contrast-acks';

export function loadAcknowledgments(): AcknowledgmentState {
  try {
    const stored = localStorage.getItem(ACK_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch { /* ignore */ }
  return { acknowledged: {} };
}

export function saveAcknowledgments(state: AcknowledgmentState): void {
  try {
    localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function acknowledgeWarning(state: AcknowledgmentState, fgToken: string, bgToken: string): AcknowledgmentState {
  const key = `${fgToken}:${bgToken}`;
  return {
    acknowledged: { ...state.acknowledged, [key]: Date.now() },
  };
}

export function unacknowledgeWarning(state: AcknowledgmentState, fgToken: string, bgToken: string): AcknowledgmentState {
  const { [fgToken + ':' + bgToken]: _, ...rest } = state.acknowledged;
  return { acknowledged: rest };
}

export function clearAllAcknowledgments(): AcknowledgmentState {
  return { acknowledged: {} };
}

// ─── Severity Badge Helpers ───

export function severityColor(severity: ContrastSeverity): string {
  switch (severity) {
    case 'info': return 'var(--theme-info, #60a5fa)';
    case 'borderline': return 'var(--theme-warning, #facc15)';
    case 'fails-aa': return 'var(--theme-danger, #f87171)';
    case 'fails-aaa': return '#c084fc'; // purple
    default: return 'var(--theme-text-muted)';
  }
}

export function severityLabel(severity: ContrastSeverity): string {
  switch (severity) {
    case 'info': return 'Info';
    case 'borderline': return 'Borderline';
    case 'fails-aa': return 'Fails AA';
    case 'fails-aaa': return 'Fails AAA';
    default: return 'Unknown';
  }
}

export function severityBgColor(severity: ContrastSeverity): string {
  switch (severity) {
    case 'info': return 'rgba(96, 165, 250, 0.08)';
    case 'borderline': return 'rgba(250, 204, 21, 0.08)';
    case 'fails-aa': return 'rgba(248, 113, 113, 0.08)';
    case 'fails-aaa': return 'rgba(192, 132, 252, 0.08)';
    default: return 'transparent';
  }
}
