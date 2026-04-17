/**
 * GDeveloper Theme System — Sprint 15 + Sprint 16 Addendum (Theme Customization Studio)
 *
 * Central source of truth for all theme definitions.
 * Each theme provides CSS variable values that are injected onto <html>.
 * Components should consume these variables, NOT hard-coded colors.
 *
 * Sprint 16 Addendum: Adds preset conversion, custom token map application,
 * and built-in preset factories for the Theme Customization Studio.
 */

import { ThemePreset, TOKEN_DEFINITIONS, type BackdropType } from './tokens';

// ─── Theme ID Enum ───

export type ThemeId = 'matrix' | 'dark' | 'white' | 'red';

export const THEME_IDS: ThemeId[] = ['matrix', 'dark', 'white', 'red'];

// ─── Theme Token Shape ───

export interface ThemeTokens {
  // Backgrounds
  appBg: string;
  panelBg: string;
  panelBgSolid: string;
  elevatedBg: string;
  hoverBg: string;
  cardBg: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;

  // Accent / brand
  accent: string;
  accentDim: string;
  accentDark: string;
  accentDarker: string;

  // Borders
  border: string;
  borderBright: string;

  // Semantic
  success: string;
  warning: string;
  danger: string;
  info: string;

  // Component surfaces
  inputBg: string;
  inputBorder: string;
  inputText: string;
  inputPlaceholder: string;

  btnBg: string;
  btnBorder: string;
  btnText: string;
  btnPrimaryBg: string;
  btnPrimaryBorder: string;

  badgeTextMuted: string;

  // Scrollbar
  scrollTrack: string;
  scrollThumb: string;
  scrollThumbHover: string;

  // Selection
  selectionBg: string;
  selectionText: string;

  // Glass panel
  glassBg: string;
  glassBorder: string;
  glassBgSolid: string;

  // Glow effects (empty string = no glow)
  glowText: string;
  glowTextDim: string;

  // Tab active
  tabActiveBorder: string;
  tabActiveBg: string;

  // Code / diff
  codeBg: string;
  codeBorder: string;
  diffAddBg: string;
  diffAddText: string;
  diffDelBg: string;
  diffDelText: string;

  // CRT overlay
  crtOverlay: string;

  // Rain sidebar color
  rainColor: string;

  /** Whether the Matrix rain canvas should render */
  showMatrixRain: boolean;
  /** Whether the CRT scanline overlay should render */
  showCrtOverlay: boolean;
}

// ─── Theme Metadata ───

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  /** Swatch preview colors: [bg, accent, text] */
  swatches: [string, string, string];
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  matrix: {
    id: 'matrix',
    name: 'Matrix',
    description: 'The original green-on-black with rain effects',
    swatches: ['#0a0a0a', '#00ff41', '#00cc33'],
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    description: 'Calm dark theme for extended sessions',
    swatches: ['#1a1a2e', '#7c83ff', '#c8c8d8'],
  },
  white: {
    id: 'white',
    name: 'White',
    description: 'Clean light theme with high readability',
    swatches: ['#f5f5f7', '#2563eb', '#1e293b'],
  },
  red: {
    id: 'red',
    name: 'Red',
    description: 'Warm dark theme with red accents',
    swatches: ['#1a0a0a', '#ff4444', '#ff8888'],
  },
};

// ─── Theme Definitions ───

const matrixTokens: ThemeTokens = {
  appBg: '#0a0a0a',
  panelBg: 'rgba(10, 21, 10, 0.85)',
  panelBgSolid: 'rgba(10, 21, 10, 0.95)',
  elevatedBg: '#0d120d',
  hoverBg: '#0f1f0f',
  cardBg: '#0a150a',

  textPrimary: '#00ff41',
  textSecondary: '#00cc33',
  textMuted: '#33cc33',
  textDim: '#00cc33',

  accent: '#00ff41',
  accentDim: '#00cc33',
  accentDark: '#009926',
  accentDarker: '#006b1a',

  border: '#003300',
  borderBright: '#00ff41',

  success: '#00ff41',
  warning: '#ccff00',
  danger: '#ff0040',
  info: '#00ccff',

  inputBg: 'rgba(0, 51, 0, 0.15)',
  inputBorder: 'rgba(0, 255, 65, 0.2)',
  inputText: '#00ff41',
  inputPlaceholder: 'rgba(0, 204, 51, 0.3)',

  btnBg: 'rgba(0, 255, 65, 0.05)',
  btnBorder: 'rgba(0, 255, 65, 0.3)',
  btnText: '#00ff41',
  btnPrimaryBg: 'rgba(0, 255, 65, 0.15)',
  btnPrimaryBorder: '#00ff41',

  badgeTextMuted: 'rgba(255, 255, 255, 0.4)',

  scrollTrack: 'rgba(0, 51, 0, 0.2)',
  scrollThumb: 'rgba(0, 255, 65, 0.3)',
  scrollThumbHover: 'rgba(0, 255, 65, 0.5)',

  selectionBg: 'rgba(0, 255, 65, 0.3)',
  selectionText: '#ffffff',

  glassBg: 'rgba(10, 21, 10, 0.85)',
  glassBorder: 'rgba(0, 255, 65, 0.15)',
  glassBgSolid: 'rgba(10, 21, 10, 0.95)',

  glowText: '0 0 5px #00ff41, 0 0 10px #00ff41',
  glowTextDim: '0 0 3px rgba(0, 255, 65, 0.5)',

  tabActiveBorder: '#00ff41',
  tabActiveBg: 'rgba(0, 255, 65, 0.08)',

  codeBg: 'rgba(0, 20, 0, 0.6)',
  codeBorder: 'rgba(0, 255, 65, 0.1)',
  diffAddBg: 'rgba(0, 255, 65, 0.08)',
  diffAddText: '#00ff41',
  diffDelBg: 'rgba(255, 0, 64, 0.08)',
  diffDelText: '#ff6688',

  crtOverlay: 'rgba(0, 255, 65, 0.015)',
  rainColor: 'rgba(0, 255, 65, 0.15)',

  showMatrixRain: true,
  showCrtOverlay: true,
};

const darkTokens: ThemeTokens = {
  appBg: '#1a1a2e',
  panelBg: 'rgba(22, 22, 44, 0.92)',
  panelBgSolid: 'rgba(22, 22, 44, 0.98)',
  elevatedBg: '#1e1e38',
  hoverBg: '#262650',
  cardBg: '#1e1e38',

  textPrimary: '#e0e0f0',
  textSecondary: '#a0a0c0',
  textMuted: '#7070a0',
  textDim: '#b0b0d0',

  accent: '#7c83ff',
  accentDim: '#6366b0',
  accentDark: '#4a4d90',
  accentDarker: '#363878',

  border: '#2a2a50',
  borderBright: '#7c83ff',

  success: '#4ade80',
  warning: '#facc15',
  danger: '#f87171',
  info: '#60a5fa',

  inputBg: 'rgba(30, 30, 60, 0.5)',
  inputBorder: 'rgba(124, 131, 255, 0.25)',
  inputText: '#e0e0f0',
  inputPlaceholder: 'rgba(160, 160, 192, 0.4)',

  btnBg: 'rgba(124, 131, 255, 0.08)',
  btnBorder: 'rgba(124, 131, 255, 0.3)',
  btnText: '#7c83ff',
  btnPrimaryBg: 'rgba(124, 131, 255, 0.18)',
  btnPrimaryBorder: '#7c83ff',

  badgeTextMuted: 'rgba(200, 200, 220, 0.4)',

  scrollTrack: 'rgba(42, 42, 80, 0.3)',
  scrollThumb: 'rgba(124, 131, 255, 0.3)',
  scrollThumbHover: 'rgba(124, 131, 255, 0.5)',

  selectionBg: 'rgba(124, 131, 255, 0.3)',
  selectionText: '#ffffff',

  glassBg: 'rgba(22, 22, 44, 0.92)',
  glassBorder: 'rgba(124, 131, 255, 0.15)',
  glassBgSolid: 'rgba(22, 22, 44, 0.98)',

  glowText: 'none',
  glowTextDim: 'none',

  tabActiveBorder: '#7c83ff',
  tabActiveBg: 'rgba(124, 131, 255, 0.1)',

  codeBg: 'rgba(15, 15, 35, 0.7)',
  codeBorder: 'rgba(124, 131, 255, 0.1)',
  diffAddBg: 'rgba(74, 222, 128, 0.1)',
  diffAddText: '#4ade80',
  diffDelBg: 'rgba(248, 113, 113, 0.1)',
  diffDelText: '#fca5a5',

  crtOverlay: 'transparent',
  rainColor: 'transparent',

  showMatrixRain: false,
  showCrtOverlay: false,
};

const whiteTokens: ThemeTokens = {
  appBg: '#f5f5f7',
  panelBg: 'rgba(255, 255, 255, 0.92)',
  panelBgSolid: 'rgba(255, 255, 255, 0.98)',
  elevatedBg: '#ffffff',
  hoverBg: '#e8eaed',
  cardBg: '#ffffff',

  textPrimary: '#1e293b',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textDim: '#64748b',

  accent: '#2563eb',
  accentDim: '#3b82f6',
  accentDark: '#1d4ed8',
  accentDarker: '#1e40af',

  border: '#e2e8f0',
  borderBright: '#2563eb',

  success: '#16a34a',
  warning: '#ca8a04',
  danger: '#dc2626',
  info: '#2563eb',

  inputBg: '#ffffff',
  inputBorder: '#cbd5e1',
  inputText: '#1e293b',
  inputPlaceholder: '#94a3b8',

  btnBg: '#f1f5f9',
  btnBorder: '#cbd5e1',
  btnText: '#2563eb',
  btnPrimaryBg: '#2563eb',
  btnPrimaryBorder: '#2563eb',

  badgeTextMuted: '#64748b',

  scrollTrack: '#f1f5f9',
  scrollThumb: '#cbd5e1',
  scrollThumbHover: '#94a3b8',

  selectionBg: 'rgba(37, 99, 235, 0.2)',
  selectionText: '#1e293b',

  glassBg: 'rgba(255, 255, 255, 0.92)',
  glassBorder: '#e2e8f0',
  glassBgSolid: 'rgba(255, 255, 255, 0.98)',

  glowText: 'none',
  glowTextDim: 'none',

  tabActiveBorder: '#2563eb',
  tabActiveBg: 'rgba(37, 99, 235, 0.06)',

  codeBg: '#f8fafc',
  codeBorder: '#e2e8f0',
  diffAddBg: 'rgba(22, 163, 74, 0.08)',
  diffAddText: '#16a34a',
  diffDelBg: 'rgba(220, 38, 38, 0.08)',
  diffDelText: '#dc2626',

  crtOverlay: 'transparent',
  rainColor: 'transparent',

  showMatrixRain: false,
  showCrtOverlay: false,
};

const redTokens: ThemeTokens = {
  appBg: '#1a0a0a',
  panelBg: 'rgba(30, 12, 12, 0.92)',
  panelBgSolid: 'rgba(30, 12, 12, 0.98)',
  elevatedBg: '#241010',
  hoverBg: '#301818',
  cardBg: '#201010',

  textPrimary: '#ffb8b8',
  textSecondary: '#d48888',
  textMuted: '#a06060',
  textDim: '#cc9090',

  accent: '#ff4444',
  accentDim: '#cc3333',
  accentDark: '#992222',
  accentDarker: '#771818',

  border: '#3a1515',
  borderBright: '#ff4444',

  success: '#4ade80',
  warning: '#facc15',
  danger: '#ff4444',
  info: '#60a5fa',

  inputBg: 'rgba(60, 20, 20, 0.4)',
  inputBorder: 'rgba(255, 68, 68, 0.25)',
  inputText: '#ffb8b8',
  inputPlaceholder: 'rgba(160, 96, 96, 0.5)',

  btnBg: 'rgba(255, 68, 68, 0.08)',
  btnBorder: 'rgba(255, 68, 68, 0.3)',
  btnText: '#ff4444',
  btnPrimaryBg: 'rgba(255, 68, 68, 0.18)',
  btnPrimaryBorder: '#ff4444',

  badgeTextMuted: 'rgba(255, 180, 180, 0.4)',

  scrollTrack: 'rgba(60, 20, 20, 0.3)',
  scrollThumb: 'rgba(255, 68, 68, 0.3)',
  scrollThumbHover: 'rgba(255, 68, 68, 0.5)',

  selectionBg: 'rgba(255, 68, 68, 0.3)',
  selectionText: '#ffffff',

  glassBg: 'rgba(30, 12, 12, 0.92)',
  glassBorder: 'rgba(255, 68, 68, 0.15)',
  glassBgSolid: 'rgba(30, 12, 12, 0.98)',

  glowText: 'none',
  glowTextDim: 'none',

  tabActiveBorder: '#ff4444',
  tabActiveBg: 'rgba(255, 68, 68, 0.1)',

  codeBg: 'rgba(20, 5, 5, 0.7)',
  codeBorder: 'rgba(255, 68, 68, 0.1)',
  diffAddBg: 'rgba(74, 222, 128, 0.1)',
  diffAddText: '#4ade80',
  diffDelBg: 'rgba(255, 68, 68, 0.12)',
  diffDelText: '#fca5a5',

  crtOverlay: 'transparent',
  rainColor: 'transparent',

  showMatrixRain: false,
  showCrtOverlay: false,
};

export const THEMES: Record<ThemeId, ThemeTokens> = {
  matrix: matrixTokens,
  dark: darkTokens,
  white: whiteTokens,
  red: redTokens,
};

// ─── CSS Variable Application ───

/**
 * Apply a theme by setting CSS custom properties on <html> and a data-theme attribute.
 * This is the single entry point for theme switching.
 */
export function applyTheme(themeId: ThemeId): void {
  const tokens = THEMES[themeId];
  if (!tokens) return;

  const root = document.documentElement;
  root.setAttribute('data-theme', themeId);

  // Map tokens to CSS custom properties
  root.style.setProperty('--theme-app-bg', tokens.appBg);
  root.style.setProperty('--theme-panel-bg', tokens.panelBg);
  root.style.setProperty('--theme-panel-bg-solid', tokens.panelBgSolid);
  root.style.setProperty('--theme-elevated-bg', tokens.elevatedBg);
  root.style.setProperty('--theme-hover-bg', tokens.hoverBg);
  root.style.setProperty('--theme-card-bg', tokens.cardBg);

  root.style.setProperty('--theme-text-primary', tokens.textPrimary);
  root.style.setProperty('--theme-text-secondary', tokens.textSecondary);
  root.style.setProperty('--theme-text-muted', tokens.textMuted);
  root.style.setProperty('--theme-text-dim', tokens.textDim);

  root.style.setProperty('--theme-accent', tokens.accent);
  root.style.setProperty('--theme-accent-dim', tokens.accentDim);
  root.style.setProperty('--theme-accent-dark', tokens.accentDark);
  root.style.setProperty('--theme-accent-darker', tokens.accentDarker);

  root.style.setProperty('--theme-border', tokens.border);
  root.style.setProperty('--theme-border-bright', tokens.borderBright);

  root.style.setProperty('--theme-success', tokens.success);
  root.style.setProperty('--theme-warning', tokens.warning);
  root.style.setProperty('--theme-danger', tokens.danger);
  root.style.setProperty('--theme-info', tokens.info);

  root.style.setProperty('--theme-input-bg', tokens.inputBg);
  root.style.setProperty('--theme-input-border', tokens.inputBorder);
  root.style.setProperty('--theme-input-text', tokens.inputText);
  root.style.setProperty('--theme-input-placeholder', tokens.inputPlaceholder);

  root.style.setProperty('--theme-btn-bg', tokens.btnBg);
  root.style.setProperty('--theme-btn-border', tokens.btnBorder);
  root.style.setProperty('--theme-btn-text', tokens.btnText);
  root.style.setProperty('--theme-btn-primary-bg', tokens.btnPrimaryBg);
  root.style.setProperty('--theme-btn-primary-border', tokens.btnPrimaryBorder);

  root.style.setProperty('--theme-badge-text-muted', tokens.badgeTextMuted);

  root.style.setProperty('--theme-scroll-track', tokens.scrollTrack);
  root.style.setProperty('--theme-scroll-thumb', tokens.scrollThumb);
  root.style.setProperty('--theme-scroll-thumb-hover', tokens.scrollThumbHover);

  root.style.setProperty('--theme-selection-bg', tokens.selectionBg);
  root.style.setProperty('--theme-selection-text', tokens.selectionText);

  root.style.setProperty('--theme-glass-bg', tokens.glassBg);
  root.style.setProperty('--theme-glass-border', tokens.glassBorder);
  root.style.setProperty('--theme-glass-bg-solid', tokens.glassBgSolid);

  root.style.setProperty('--theme-glow-text', tokens.glowText);
  root.style.setProperty('--theme-glow-text-dim', tokens.glowTextDim);

  root.style.setProperty('--theme-tab-active-border', tokens.tabActiveBorder);
  root.style.setProperty('--theme-tab-active-bg', tokens.tabActiveBg);

  root.style.setProperty('--theme-code-bg', tokens.codeBg);
  root.style.setProperty('--theme-code-border', tokens.codeBorder);
  root.style.setProperty('--theme-diff-add-bg', tokens.diffAddBg);
  root.style.setProperty('--theme-diff-add-text', tokens.diffAddText);
  root.style.setProperty('--theme-diff-del-bg', tokens.diffDelBg);
  root.style.setProperty('--theme-diff-del-text', tokens.diffDelText);

  root.style.setProperty('--theme-crt-overlay', tokens.crtOverlay);
  root.style.setProperty('--theme-rain-color', tokens.rainColor);
}

/**
 * Get current theme tokens by reading data-theme attribute.
 */
export function getCurrentTheme(): ThemeId {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr && THEME_IDS.includes(attr as ThemeId)) return attr as ThemeId;
  return 'matrix';
}

// ─── Sprint 16 Addendum: Preset Conversion & Custom Token Application ───

/**
 * Convert a ThemeTokens object + metadata into a ThemePreset.
 */
export function themeToPreset(
  id: ThemeId,
  tokens: ThemeTokens,
  builtIn: boolean = true,
): ThemePreset {
  const tokenMap: Record<string, string> = {};
  for (const def of TOKEN_DEFINITIONS) {
    const value = (tokens as any)[def.key];
    if (value !== undefined) {
      tokenMap[def.key] = String(value);
    }
  }

  const meta = THEME_META[id];
  const now = new Date().toISOString();

  return {
    id,
    name: meta?.name || id,
    builtIn,
    tokens: tokenMap,
    backdrop: tokens.showMatrixRain ? 'matrix-rain' : 'none',
    backdropOpacity: tokens.showMatrixRain ? 0.38 : 0,
    backdropIntensity: 1.0,
    matrixRainEnabled: tokens.showMatrixRain,
    crtOverlayEnabled: tokens.showCrtOverlay,
    createdAt: now,
    updatedAt: now,
  };
}

/** All built-in presets, derived from the existing theme definitions. */
export function getBuiltInPresets(): ThemePreset[] {
  return THEME_IDS.map(id => themeToPreset(id, THEMES[id], true));
}

/**
 * Apply a token map (key→CSS value) directly to the document root.
 * Used for live preview and custom presets.
 */
export function applyTokenMap(tokenMap: Record<string, string>, presetName?: string): void {
  const root = document.documentElement;
  if (presetName) {
    root.setAttribute('data-theme', presetName);
  }
  for (const def of TOKEN_DEFINITIONS) {
    const value = tokenMap[def.key];
    if (value !== undefined) {
      root.style.setProperty(def.cssVar, value);
    }
  }
}

/**
 * Apply a ThemePreset (full preset object) to the document.
 */
export function applyPreset(preset: ThemePreset): void {
  applyTokenMap(preset.tokens, preset.id);
}
