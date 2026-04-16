/**
 * Theme React Context — Sprint 15
 *
 * Provides the current theme ID and a setter to all descendants.
 * Automatically applies CSS variables via applyTheme() on changes.
 * Hydrates saved theme from settings on mount to avoid flash.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ThemeId, THEME_IDS, THEMES, applyTheme } from './index';

interface ThemeContextValue {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  /** Whether the current theme shows Matrix rain */
  showMatrixRain: boolean;
  /** Whether the current theme shows CRT overlay */
  showCrtOverlay: boolean;
}

const ThemeCtx = createContext<ThemeContextValue>({
  themeId: 'matrix',
  setTheme: () => {},
  showMatrixRain: true,
  showCrtOverlay: true,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeCtx);
}

const api = (window as any).electronAPI;

interface ThemeProviderProps {
  initialTheme?: ThemeId;
  children: React.ReactNode;
}

export function ThemeProvider({ initialTheme = 'matrix', children }: ThemeProviderProps) {
  const [themeId, setThemeId] = useState<ThemeId>(initialTheme);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate saved theme from settings on mount (runs once)
  useEffect(() => {
    if (hydrated) return;
    const hydrate = async () => {
      try {
        if (api) {
          const settings = await api.getSettings();
          const saved = settings?.theme;
          if (saved && THEME_IDS.includes(saved as ThemeId)) {
            setThemeId(saved as ThemeId);
            applyTheme(saved as ThemeId);
          }
        }
      } catch {
        // Fallback: keep matrix default
      }
      setHydrated(true);
    };
    hydrate();
  }, [hydrated]);

  // Apply theme CSS whenever themeId changes
  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
    applyTheme(id);
    // Persist via IPC
    if (api) {
      api.updateSettings({ theme: id }).catch(() => {});
    }
  }, []);

  const tokens = THEMES[themeId];

  return (
    <ThemeCtx.Provider value={{
      themeId,
      setTheme,
      showMatrixRain: tokens.showMatrixRain,
      showCrtOverlay: tokens.showCrtOverlay,
    }}>
      {children}
    </ThemeCtx.Provider>
  );
}
