/**
 * Theme React Context — Sprint 15 + Sprint 16 Addendum (Theme Customization Studio)
 *
 * Provides the current theme state and methods to all descendants.
 * Now supports both legacy ThemeId-based switching and custom ThemePreset-based switching.
 * Hydrates saved preset from settings on mount.
 * Manages preset persistence (save/load/delete).
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ThemeId, THEME_IDS, THEMES, applyTheme, applyPreset, getBuiltInPresets } from './index';
import { ThemePreset, BackdropType } from './tokens';

const api = (window as any).electronAPI;

// ─── Context Value ───

interface ThemeContextValue {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  /** Whether the current theme shows Matrix rain */
  showMatrixRain: boolean;
  /** Whether the current theme shows CRT overlay */
  showCrtOverlay: boolean;

  // ── Sprint 16 Addendum: Preset system ──
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
    if (raw) return JSON.parse(raw);
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

        // Map preset ID to legacy themeId for backward compat
        if (THEME_IDS.includes(target.id as ThemeId)) {
          setThemeId(target.id as ThemeId);
        }
      } catch {
        // Fallback: keep matrix default
        applyTheme('matrix');
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
    const updated = { ...preset, updatedAt: now };

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

  // ── Live preview ──
  const previewTokens = useCallback((tokens: Record<string, string>) => {
    const { applyTokenMap } = require('./index');
    applyTokenMap(tokens, 'preview');
  }, []);

  const cancelPreview = useCallback(() => {
    const all = [...builtInPresets, ...userPresets];
    const current = all.find(p => p.id === activePresetId);
    if (current) {
      applyPreset(current);
    } else {
      applyTheme('matrix');
    }
  }, [builtInPresets, userPresets, activePresetId]);

  const tokens = THEMES[themeId] || THEMES.matrix;

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
    }}>
      {children}
    </ThemeCtx.Provider>
  );
}
