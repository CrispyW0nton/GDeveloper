/**
 * Theme Token Model — Sprint 16 Addendum
 *
 * Structured, editable tokens that map 1:1 to CSS custom properties.
 * Each token has a key, CSS variable name, display label, category,
 * value type (color, opacity, shadow, boolean), and default per built-in preset.
 *
 * The ThemeCustomizationStudio reads/writes these tokens.
 * applyThemeTokens() sets them on <html>.
 */

// ─── Backdrop Types ───

export type BackdropType = 'matrix-rain' | 'none' | 'puddles' | 'animated-gradient' | 'static-noise';

export const BACKDROP_OPTIONS: { id: BackdropType; label: string; description: string }[] = [
  { id: 'matrix-rain', label: 'Matrix Rain', description: 'Falling katakana characters — the classic' },
  { id: 'none', label: 'None', description: 'No background animation' },
  { id: 'puddles', label: 'Puddles', description: 'Animated ripple/puddle reflections' },
  { id: 'animated-gradient', label: 'Animated Gradient', description: 'Slow-cycling color gradient' },
  { id: 'static-noise', label: 'Static Noise', description: 'Subtle grain / film-noise texture' },
];

// ─── Token Categories ───

export type TokenCategory =
  | 'background'
  | 'text'
  | 'accent'
  | 'border'
  | 'semantic'
  | 'input'
  | 'button'
  | 'scrollbar'
  | 'glass'
  | 'glow'
  | 'code'
  | 'overlay';

export const TOKEN_CATEGORIES: { id: TokenCategory; label: string }[] = [
  { id: 'background', label: 'Backgrounds' },
  { id: 'text', label: 'Text' },
  { id: 'accent', label: 'Accent / Brand' },
  { id: 'border', label: 'Borders' },
  { id: 'semantic', label: 'Semantic (Status)' },
  { id: 'input', label: 'Inputs' },
  { id: 'button', label: 'Buttons' },
  { id: 'scrollbar', label: 'Scrollbar' },
  { id: 'glass', label: 'Glass Panel' },
  { id: 'glow', label: 'Glow Effects' },
  { id: 'code', label: 'Code / Diff' },
  { id: 'overlay', label: 'Overlay / Effects' },
];

// ─── Token Definition ───

export interface TokenDefinition {
  key: string;           // e.g. 'appBg'
  cssVar: string;        // e.g. '--theme-app-bg'
  label: string;         // Human-readable label
  category: TokenCategory;
  type: 'color' | 'shadow' | 'opacity';
  /** For colors that support opacity (rgba), show an opacity slider */
  supportsOpacity?: boolean;
}

/** All editable theme tokens, ordered by category */
export const TOKEN_DEFINITIONS: TokenDefinition[] = [
  // ── Backgrounds ──
  { key: 'appBg', cssVar: '--theme-app-bg', label: 'App Background', category: 'background', type: 'color' },
  { key: 'panelBg', cssVar: '--theme-panel-bg', label: 'Panel Background', category: 'background', type: 'color', supportsOpacity: true },
  { key: 'panelBgSolid', cssVar: '--theme-panel-bg-solid', label: 'Panel Background (Solid)', category: 'background', type: 'color', supportsOpacity: true },
  { key: 'elevatedBg', cssVar: '--theme-elevated-bg', label: 'Elevated Surface', category: 'background', type: 'color' },
  { key: 'hoverBg', cssVar: '--theme-hover-bg', label: 'Hover Background', category: 'background', type: 'color' },
  { key: 'cardBg', cssVar: '--theme-card-bg', label: 'Card / Tool Background', category: 'background', type: 'color' },

  // ── Text ──
  { key: 'textPrimary', cssVar: '--theme-text-primary', label: 'Primary Text', category: 'text', type: 'color' },
  { key: 'textSecondary', cssVar: '--theme-text-secondary', label: 'Secondary Text', category: 'text', type: 'color' },
  { key: 'textMuted', cssVar: '--theme-text-muted', label: 'Muted Text', category: 'text', type: 'color' },
  { key: 'textDim', cssVar: '--theme-text-dim', label: 'Dim Text', category: 'text', type: 'color' },

  // ── Accent ──
  { key: 'accent', cssVar: '--theme-accent', label: 'Accent (Primary)', category: 'accent', type: 'color' },
  { key: 'accentDim', cssVar: '--theme-accent-dim', label: 'Accent (Dim)', category: 'accent', type: 'color' },
  { key: 'accentDark', cssVar: '--theme-accent-dark', label: 'Accent (Dark)', category: 'accent', type: 'color' },
  { key: 'accentDarker', cssVar: '--theme-accent-darker', label: 'Accent (Darker)', category: 'accent', type: 'color' },

  // ── Borders ──
  { key: 'border', cssVar: '--theme-border', label: 'Border', category: 'border', type: 'color' },
  { key: 'borderBright', cssVar: '--theme-border-bright', label: 'Border (Bright)', category: 'border', type: 'color' },

  // ── Semantic ──
  { key: 'success', cssVar: '--theme-success', label: 'Success', category: 'semantic', type: 'color' },
  { key: 'warning', cssVar: '--theme-warning', label: 'Warning', category: 'semantic', type: 'color' },
  { key: 'danger', cssVar: '--theme-danger', label: 'Danger', category: 'semantic', type: 'color' },
  { key: 'info', cssVar: '--theme-info', label: 'Info', category: 'semantic', type: 'color' },

  // ── Inputs ──
  { key: 'inputBg', cssVar: '--theme-input-bg', label: 'Input Background', category: 'input', type: 'color', supportsOpacity: true },
  { key: 'inputBorder', cssVar: '--theme-input-border', label: 'Input Border', category: 'input', type: 'color', supportsOpacity: true },
  { key: 'inputText', cssVar: '--theme-input-text', label: 'Input Text', category: 'input', type: 'color' },
  { key: 'inputPlaceholder', cssVar: '--theme-input-placeholder', label: 'Input Placeholder', category: 'input', type: 'color', supportsOpacity: true },

  // ── Buttons ──
  { key: 'btnBg', cssVar: '--theme-btn-bg', label: 'Button Background', category: 'button', type: 'color', supportsOpacity: true },
  { key: 'btnBorder', cssVar: '--theme-btn-border', label: 'Button Border', category: 'button', type: 'color', supportsOpacity: true },
  { key: 'btnText', cssVar: '--theme-btn-text', label: 'Button Text', category: 'button', type: 'color' },
  { key: 'btnPrimaryBg', cssVar: '--theme-btn-primary-bg', label: 'Primary Button BG', category: 'button', type: 'color', supportsOpacity: true },
  { key: 'btnPrimaryBorder', cssVar: '--theme-btn-primary-border', label: 'Primary Button Border', category: 'button', type: 'color' },

  // ── Scrollbar ──
  { key: 'scrollTrack', cssVar: '--theme-scroll-track', label: 'Scroll Track', category: 'scrollbar', type: 'color', supportsOpacity: true },
  { key: 'scrollThumb', cssVar: '--theme-scroll-thumb', label: 'Scroll Thumb', category: 'scrollbar', type: 'color', supportsOpacity: true },
  { key: 'scrollThumbHover', cssVar: '--theme-scroll-thumb-hover', label: 'Scroll Thumb Hover', category: 'scrollbar', type: 'color', supportsOpacity: true },

  // ── Glass Panel ──
  { key: 'glassBg', cssVar: '--theme-glass-bg', label: 'Glass Background', category: 'glass', type: 'color', supportsOpacity: true },
  { key: 'glassBorder', cssVar: '--theme-glass-border', label: 'Glass Border', category: 'glass', type: 'color', supportsOpacity: true },
  { key: 'glassBgSolid', cssVar: '--theme-glass-bg-solid', label: 'Glass BG (Solid)', category: 'glass', type: 'color', supportsOpacity: true },

  // ── Glow ──
  { key: 'glowText', cssVar: '--theme-glow-text', label: 'Text Glow', category: 'glow', type: 'shadow' },
  { key: 'glowTextDim', cssVar: '--theme-glow-text-dim', label: 'Dim Text Glow', category: 'glow', type: 'shadow' },

  // ── Code / Diff ──
  { key: 'codeBg', cssVar: '--theme-code-bg', label: 'Code Background', category: 'code', type: 'color', supportsOpacity: true },
  { key: 'codeBorder', cssVar: '--theme-code-border', label: 'Code Border', category: 'code', type: 'color', supportsOpacity: true },
  { key: 'diffAddBg', cssVar: '--theme-diff-add-bg', label: 'Diff Add BG', category: 'code', type: 'color', supportsOpacity: true },
  { key: 'diffAddText', cssVar: '--theme-diff-add-text', label: 'Diff Add Text', category: 'code', type: 'color' },
  { key: 'diffDelBg', cssVar: '--theme-diff-del-bg', label: 'Diff Delete BG', category: 'code', type: 'color', supportsOpacity: true },
  { key: 'diffDelText', cssVar: '--theme-diff-del-text', label: 'Diff Delete Text', category: 'code', type: 'color' },

  // ── Overlay ──
  { key: 'crtOverlay', cssVar: '--theme-crt-overlay', label: 'CRT Overlay Tint', category: 'overlay', type: 'color', supportsOpacity: true },
  { key: 'rainColor', cssVar: '--theme-rain-color', label: 'Rain Color', category: 'overlay', type: 'color', supportsOpacity: true },

  // Extra tokens from ThemeTokens that aren't directly editable via color picker
  { key: 'badgeTextMuted', cssVar: '--theme-badge-text-muted', label: 'Badge Text Muted', category: 'text', type: 'color', supportsOpacity: true },
  { key: 'selectionBg', cssVar: '--theme-selection-bg', label: 'Selection BG', category: 'accent', type: 'color', supportsOpacity: true },
  { key: 'selectionText', cssVar: '--theme-selection-text', label: 'Selection Text', category: 'accent', type: 'color' },
  { key: 'tabActiveBorder', cssVar: '--theme-tab-active-border', label: 'Tab Active Border', category: 'accent', type: 'color' },
  { key: 'tabActiveBg', cssVar: '--theme-tab-active-bg', label: 'Tab Active BG', category: 'accent', type: 'color', supportsOpacity: true },
];

// ─── Theme Preset ───

export interface ThemePreset {
  id: string;
  name: string;
  /** Whether this is a built-in preset (cannot be deleted) */
  builtIn: boolean;
  /** Token values — maps token key to CSS value string */
  tokens: Record<string, string>;
  /** Backdrop selection */
  backdrop: BackdropType;
  /** Backdrop opacity (0..1) */
  backdropOpacity: number;
  /** Backdrop intensity (0..1) — for animated backdrops */
  backdropIntensity: number;
  /** Whether Matrix rain is enabled (can be used independently of backdrop) */
  matrixRainEnabled: boolean;
  /** Whether CRT scanline overlay is enabled */
  crtOverlayEnabled: boolean;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
}

// ─── Contrast Helpers ───

/**
 * Parse a CSS color string to [r, g, b] (0-255).
 * Supports #hex, rgb(), rgba(), and named CSS colors (limited).
 */
export function parseColor(css: string): [number, number, number] | null {
  if (!css || css === 'none' || css === 'transparent') return null;

  // Hex
  const hexMatch = css.match(/^#?([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length >= 6) {
      return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
    }
  }

  // rgb/rgba
  const rgbMatch = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  }

  return null;
}

/**
 * Relative luminance per WCAG 2.0.
 */
export function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r/255, g/255, b/255].map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * WCAG contrast ratio between two colors (1..21).
 */
export function contrastRatio(color1: string, color2: string): number | null {
  const c1 = parseColor(color1);
  const c2 = parseColor(color2);
  if (!c1 || !c2) return null;

  const l1 = luminance(...c1);
  const l2 = luminance(...c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if a text/bg combination meets WCAG AA standards.
 * Returns 'pass', 'warn', or 'fail'.
 */
export function checkContrast(textColor: string, bgColor: string): 'pass' | 'warn' | 'fail' {
  const ratio = contrastRatio(textColor, bgColor);
  if (ratio === null) return 'warn'; // Can't determine — assume OK but warn
  if (ratio >= 4.5) return 'pass';   // AA for normal text
  if (ratio >= 3.0) return 'warn';   // AA for large text only
  return 'fail';
}

/**
 * Validate a hex input string. Returns cleaned hex or null.
 * Accepts with/without # prefix, 3 or 6 char hex.
 */
export function validateHex(input: string): string | null {
  const cleaned = input.replace(/^#/, '').trim();
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return '#' + cleaned[0]+cleaned[0]+cleaned[1]+cleaned[1]+cleaned[2]+cleaned[2];
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return '#' + cleaned;
  }
  if (/^[0-9a-fA-F]{8}$/.test(cleaned)) {
    return '#' + cleaned.substring(0, 6); // strip alpha for color picker
  }
  return null;
}

/**
 * Extract a hex color from any CSS value (best effort).
 */
export function extractHexFromCss(value: string): string {
  if (!value || value === 'none' || value === 'transparent') return '#000000';
  const hexMatch = value.match(/#([0-9a-fA-F]{6})/);
  if (hexMatch) return '#' + hexMatch[1];
  const hex3Match = value.match(/#([0-9a-fA-F]{3})(?![0-9a-fA-F])/);
  if (hex3Match) {
    const h = hex3Match[1];
    return '#' + h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  }
  const rgb = parseColor(value);
  if (rgb) {
    return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
  }
  return '#000000';
}
