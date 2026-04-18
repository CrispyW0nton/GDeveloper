/**
 * Theme React Context — Sprint 15 + Sprint 16 + Sprint 20 (Real-time Theme Editing)
 *
 * Provides the current theme state and methods to all descendants.
 * Sprint 20 additions:
 *  - Real-time token editing: every change instantly updates CSS variables (no Apply button)
 *  - matrixRainHue: dedicated rain character color, persisted per-preset
 *  - Snapshot / restore for cancel/discard
 *  - Safe handling of invalid inputs
 *  - updateTokenRealtime() for single-token live updates
 *  - updateBackdropRealtime() for backdrop setting changes
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ThemeId, THEME_IDS, THEMES, applyTheme, applyPreset, getBuiltInPresets, DEFAULT_MATRIX_RAIN_HUE } from './index';
import { ThemePreset, BackdropType } from './tokens';
import {
  applyTokensRealtime,
  applySingleToken,
  applyMatrixRainHue,
  snapshotCurrentTokens,
  restoreTokenSnapshot,
  type TokenSnapshot,
} from './applyTheme';

const api = (window as any).electronAPI;

// ─── Context Value ───

interface ThemeContextValue {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  /** Whether the current theme shows Matrix rain */
  showMatrixRain: boolean;
  /** Whether the current theme shows CRT overlay */
  showCrtOverlay: boolean;

  // ── Sprint 16: Preset system ──
  /** All available presets (built-in + user-saved) */
  presets: ThemePreset[];
  /** The currently active preset */
  activePreset: ThemePreset | null;
  /** Apply a preset (sets tokens + backdrop flags) */
  applyPresetById: (presetId: string) => void;
  /** Save a preset (create or overwrite). Returns the saved preset. */
  savePreset: (preset: ThemePreset) => ThemePreset;
  /** Duplicate a preset with a new name */
  duplicatePreset: (sourceId: string, newName: string) => ThemePreset | null;
  /** Delete a preset (cannot delete built-in) */
  deletePreset: (presetId: string) => boolean;
  /** Live preview tokens without persisting */
  previewTokens: (tokens: Record<string, string>) => void;
  /** Cancel preview (revert to active preset) */
  cancelPreview: () => void;

  // ── Backdrop state ──
  backdropType: BackdropType;
  backdropOpacity: number;
  backdropIntensity: number;
  matrixRainEnabled: boolean;
  crtOverlayEnabled: boolean;

  // ── Sprint 20: Real-time editing ──
  /** Matrix rain character hue color. Defaults to '#00ff41'. */
  matrixRainHue: string;
  /** Update a single token in real-time (CSS var updates instantly). */
  updateTokenRealtime: (key: string, value: string) => void;
  /** Update the matrix rain hue in real-time. */
  updateMatrixRainHue: (hue: string) => void;
  /** Reset matrix rain hue to default (#00ff41). */
  resetMatrixRainHue: () => void;
  /** Update backdrop settings in real-time. */
  updateBackdropRealtime: (settings: Partial<{
    backdropType: BackdropType;
    backdropOpacity: number;
    backdropIntensity: number;
    matrixRainEnabled: boolean;
    crtOverlayEnabled: boolean;
  }>) => void;
  /** Take a snapshot of current theme state for later restore. */
  takeSnapshot: () => TokenSnapshot;
  /** Restore a previous snapshot (cancel/discard changes). */
  restoreSnapshot: (snapshot: TokenSnapshot) => void;
}

const ThemeCtx = createContext<ThemeContextValue>({
  themeId: 'matrix',
  setTheme: () => {},
  showMatrixRain: true,
  showCrtOverlay: true,
  presets: [],
  activePreset: null,
  applyPresetById: () => {},
  savePreset: (p) => p,
  duplicatePreset: () => null,
  deletePreset: () => false,
  previewTokens: () => {},
  cancelPreview: () => {},
  backdropType: 'matrix-rain',
  backdropOpacity: 0.38,
  backdropIntensity: 1.0,
  matrixRainEnabled: true,
  crtOverlayEnabled: true,
  // Sprint 20
  matrixRainHue: DEFAULT_MATRIX_RAIN_HUE,
  updateTokenRealtime: () => {},
  updateMatrixRainHue: () => {},
  resetMatrixRainHue: () => {},
  updateBackdropRealtime: () => {},
  takeSnapshot: () => ({ tokens: {}, matrixRainHue: DEFAULT_MATRIX_RAIN_HUE, dataTheme: 'matrix', timestamp: 0 }),
  restoreSnapshot: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeCtx);
}

// ─── Persistence Helpers ───

const PRESETS_KEY = 'gdeveloper_theme_presets';
const ACTIVE_PRESET_KEY = 'gdeveloper_active_preset';

function loadPresetsFromStorage(): ThemePreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ThemePreset[];
      // Sprint 20: Ensure legacy presets have matrixRainHue
      return parsed.map(p => ({
        ...p,
        matrixRainHue: p.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE,
      }));
    }
  } catch {}
  return [];
}

function savePresetsToStorage(presets: ThemePreset[]): void {
  try {
    // Only save non-built-in presets to localStorage
    const userPresets = presets.filter(p => !p.builtIn);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(userPresets));
  } catch {}
}

function loadActivePresetId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PRESET_KEY);
  } catch {}
  return null;
}

function saveActivePresetId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PRESET_KEY, id);
  } catch {}
}

// ─── Provider ───

interface ThemeProviderProps {
  initialTheme?: ThemeId;
  children: React.ReactNode;
}

export function ThemeProvider({ initialTheme = 'matrix', children }: ThemeProviderProps) {
  const [themeId, setThemeId] = useState<ThemeId>(initialTheme);
  const [hydrated, setHydrated] = useState(false);

  // Preset state
  const builtInPresets = useRef(getBuiltInPresets()).current;
  const [userPresets, setUserPresets] = useState<ThemePreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>('matrix');

  // Backdrop state
  const [backdropType, setBackdropType] = useState<BackdropType>('matrix-rain');
  const [backdropOpacity, setBackdropOpacity] = useState(0.38);
  const [backdropIntensity, setBackdropIntensity] = useState(1.0);
  const [matrixRainEnabled, setMatrixRainEnabled] = useState(true);
  const [crtOverlayEnabled, setCrtOverlayEnabled] = useState(true);

  // Sprint 20: Matrix rain hue
  const [matrixRainHue, setMatrixRainHueState] = useState<string>(DEFAULT_MATRIX_RAIN_HUE);

  // All presets combined
  const allPresets = [...builtInPresets, ...userPresets];

  const activePreset = allPresets.find(p => p.id === activePresetId) || builtInPresets[0];

  // Hydrate on mount
  useEffect(() => {
    if (hydrated) return;
    const hydrate = async () => {
      try {
        // Load user presets from localStorage
        const savedUserPresets = loadPresetsFromStorage();
        setUserPresets(savedUserPresets);

        // Load active preset ID
        let savedActiveId = loadActivePresetId();

        // Also check electron settings for legacy theme
        if (api) {
          const settings = await api.getSettings();
          const legacyTheme = settings?.theme;

          // If no saved preset but legacy theme exists, use it
          if (!savedActiveId && legacyTheme && THEME_IDS.includes(legacyTheme as ThemeId)) {
            savedActiveId = legacyTheme;
          }
        }

        // Find and apply the preset
        const allAvailable = [...builtInPresets, ...savedUserPresets];
        const target = allAvailable.find(p => p.id === savedActiveId) || builtInPresets[0];

        applyPreset(target);
        setActivePresetId(target.id);
        setBackdropType(target.backdrop);
        setBackdropOpacity(target.backdropOpacity);
        setBackdropIntensity(target.backdropIntensity);
        setMatrixRainEnabled(target.matrixRainEnabled);
        setCrtOverlayEnabled(target.crtOverlayEnabled);

        // Sprint 20: Hydrate rain hue
        const hue = target.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE;
        setMatrixRainHueState(hue);
        applyMatrixRainHue(hue);

        // Map preset ID to legacy themeId for backward compat
        if (THEME_IDS.includes(target.id as ThemeId)) {
          setThemeId(target.id as ThemeId);
        }
      } catch {
        // Fallback: keep matrix default
        applyTheme('matrix');
        applyMatrixRainHue(DEFAULT_MATRIX_RAIN_HUE);
      }
      setHydrated(true);
    };
    hydrate();
  }, [hydrated, builtInPresets]);

  // Apply theme CSS whenever themeId changes (backward compat)
  useEffect(() => {
    if (!hydrated) return;
    applyTheme(themeId);
  }, [themeId, hydrated]);

  // ── Legacy setTheme (backward compat) ──
  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
    applyTheme(id);
    // Also apply as preset
    const preset = builtInPresets.find(p => p.id === id);
    if (preset) {
      setActivePresetId(id);
      setBackdropType(preset.backdrop);
      setBackdropOpacity(preset.backdropOpacity);
      setBackdropIntensity(preset.backdropIntensity);
      setMatrixRainEnabled(preset.matrixRainEnabled);
      setCrtOverlayEnabled(preset.crtOverlayEnabled);
      // Sprint 20
      const hue = preset.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE;
      setMatrixRainHueState(hue);
      applyMatrixRainHue(hue);
      saveActivePresetId(id);
    }
    // Persist via IPC
    if (api) {
      api.updateSettings({ theme: id }).catch(() => {});
    }
  }, [builtInPresets]);

  // ── Apply preset by ID ──
  const applyPresetById = useCallback((presetId: string) => {
    const all = [...builtInPresets, ...userPresets];
    const preset = all.find(p => p.id === presetId);
    if (!preset) return;

    applyPreset(preset);
    setActivePresetId(presetId);
    setBackdropType(preset.backdrop);
    setBackdropOpacity(preset.backdropOpacity);
    setBackdropIntensity(preset.backdropIntensity);
    setMatrixRainEnabled(preset.matrixRainEnabled);
    setCrtOverlayEnabled(preset.crtOverlayEnabled);
    // Sprint 20
    const hue = preset.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE;
    setMatrixRainHueState(hue);
    applyMatrixRainHue(hue);
    saveActivePresetId(presetId);

    // Update legacy themeId for compat
    if (THEME_IDS.includes(presetId as ThemeId)) {
      setThemeId(presetId as ThemeId);
      if (api) api.updateSettings({ theme: presetId }).catch(() => {});
    }
  }, [builtInPresets, userPresets]);

  // ── Save preset ──
  const savePresetFn = useCallback((preset: ThemePreset): ThemePreset => {
    const now = new Date().toISOString();
    // Sprint 20: Ensure matrixRainHue is included
    const updated: ThemePreset = {
      ...preset,
      matrixRainHue: preset.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE,
      updatedAt: now,
    };

    setUserPresets(prev => {
      const existing = prev.findIndex(p => p.id === updated.id);
      let next: ThemePreset[];
      if (existing >= 0) {
        next = [...prev];
        next[existing] = updated;
      } else {
        next = [...prev, updated];
      }
      savePresetsToStorage(next);
      return next;
    });

    return updated;
  }, []);

  // ── Duplicate preset ──
  const duplicatePreset = useCallback((sourceId: string, newName: string): ThemePreset | null => {
    const all = [...builtInPresets, ...userPresets];
    const source = all.find(p => p.id === sourceId);
    if (!source) return null;

    const now = new Date().toISOString();
    const dup: ThemePreset = {
      ...source,
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      name: newName,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
      tokens: { ...source.tokens },
      matrixRainHue: source.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE,
    };

    setUserPresets(prev => {
      const next = [...prev, dup];
      savePresetsToStorage(next);
      return next;
    });

    return dup;
  }, [builtInPresets, userPresets]);

  // ── Delete preset ──
  const deletePresetFn = useCallback((presetId: string): boolean => {
    const target = userPresets.find(p => p.id === presetId);
    if (!target || target.builtIn) return false;

    setUserPresets(prev => {
      const next = prev.filter(p => p.id !== presetId);
      savePresetsToStorage(next);
      return next;
    });

    // If deleting the active preset, switch to Matrix
    if (activePresetId === presetId) {
      applyPresetById('matrix');
    }

    return true;
  }, [userPresets, activePresetId, applyPresetById]);

  // ── Live preview (legacy) ──
  const previewTokens = useCallback((tokens: Record<string, string>) => {
    applyTokensRealtime(tokens, 'preview');
  }, []);

  const cancelPreview = useCallback(() => {
    const all = [...builtInPresets, ...userPresets];
    const current = all.find(p => p.id === activePresetId);
    if (current) {
      applyPreset(current);
    } else {
      applyTheme('matrix');
      applyMatrixRainHue(DEFAULT_MATRIX_RAIN_HUE);
    }
  }, [builtInPresets, userPresets, activePresetId]);

  // ── Sprint 20: Real-time single-token update ──
  const updateTokenRealtime = useCallback((key: string, value: string) => {
    applySingleToken(key, value);
  }, []);

  // ── Sprint 20: Matrix rain hue ──
  const updateMatrixRainHueCb = useCallback((hue: string) => {
    setMatrixRainHueState(hue);
    applyMatrixRainHue(hue);
  }, []);

  const resetMatrixRainHue = useCallback(() => {
    setMatrixRainHueState(DEFAULT_MATRIX_RAIN_HUE);
    applyMatrixRainHue(DEFAULT_MATRIX_RAIN_HUE);
  }, []);

  // ── Sprint 20: Real-time backdrop updates ──
  const updateBackdropRealtime = useCallback((settings: Partial<{
    backdropType: BackdropType;
    backdropOpacity: number;
    backdropIntensity: number;
    matrixRainEnabled: boolean;
    crtOverlayEnabled: boolean;
  }>) => {
    if (settings.backdropType !== undefined) setBackdropType(settings.backdropType);
    if (settings.backdropOpacity !== undefined) setBackdropOpacity(settings.backdropOpacity);
    if (settings.backdropIntensity !== undefined) setBackdropIntensity(settings.backdropIntensity);
    if (settings.matrixRainEnabled !== undefined) setMatrixRainEnabled(settings.matrixRainEnabled);
    if (settings.crtOverlayEnabled !== undefined) setCrtOverlayEnabled(settings.crtOverlayEnabled);
  }, []);

  // ── Sprint 20: Snapshot / restore ──
  const takeSnapshot = useCallback((): TokenSnapshot => {
    return snapshotCurrentTokens();
  }, []);

  const restoreSnapshotCb = useCallback((snapshot: TokenSnapshot) => {
    restoreTokenSnapshot(snapshot);
    // Also restore React state from the active preset
    const all = [...builtInPresets, ...userPresets];
    const current = all.find(p => p.id === activePresetId);
    if (current) {
      setBackdropType(current.backdrop);
      setBackdropOpacity(current.backdropOpacity);
      setBackdropIntensity(current.backdropIntensity);
      setMatrixRainEnabled(current.matrixRainEnabled);
      setCrtOverlayEnabled(current.crtOverlayEnabled);
      setMatrixRainHueState(current.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE);
    }
  }, [builtInPresets, userPresets, activePresetId]);

  return (
    <ThemeCtx.Provider value={{
      themeId,
      setTheme,
      showMatrixRain: matrixRainEnabled,
      showCrtOverlay: crtOverlayEnabled,
      presets: allPresets,
      activePreset,
      applyPresetById,
      savePreset: savePresetFn,
      duplicatePreset,
      deletePreset: deletePresetFn,
      previewTokens,
      cancelPreview,
      backdropType,
      backdropOpacity,
      backdropIntensity,
      matrixRainEnabled,
      crtOverlayEnabled,
      // Sprint 20
      matrixRainHue,
      updateTokenRealtime,
      updateMatrixRainHue: updateMatrixRainHueCb,
      resetMatrixRainHue,
      updateBackdropRealtime,
      takeSnapshot,
      restoreSnapshot: restoreSnapshotCb,
    }}>
      {children}
    </ThemeCtx.Provider>
  );
}
