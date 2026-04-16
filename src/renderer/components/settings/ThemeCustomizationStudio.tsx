/**
 * Theme Customization Studio — Sprint 16 Addendum
 *
 * Full-featured theme editor replacing the fixed theme selector.
 * Features:
 *  - Color pickers + hex inputs for all tokens
 *  - Opacity sliders where applicable
 *  - Live preview
 *  - Save / Reset / Cancel buttons
 *  - Named custom presets (CRUD)
 *  - Backdrop selector with Matrix rain toggle
 *  - Contrast validation warnings
 *  - Safe preview with recovery paths
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTheme } from '../../themes/ThemeContext';
import {
  TOKEN_DEFINITIONS, TOKEN_CATEGORIES, BACKDROP_OPTIONS,
  type TokenCategory, type ThemePreset, type BackdropType,
  checkContrast, validateHex, extractHexFromCss,
} from '../../themes/tokens';
import { applyTokenMap } from '../../themes';

// ─── Component ───

export default function ThemeCustomizationStudio() {
  const {
    presets, activePreset, applyPresetById, savePreset,
    duplicatePreset, deletePreset, cancelPreview,
  } = useTheme();

  // Local editing state (copy of active preset tokens)
  const [editTokens, setEditTokens] = useState<Record<string, string>>({});
  const [editName, setEditName] = useState('');
  const [editBackdrop, setEditBackdrop] = useState<BackdropType>('matrix-rain');
  const [editBackdropOpacity, setEditBackdropOpacity] = useState(0.38);
  const [editBackdropIntensity, setEditBackdropIntensity] = useState(1.0);
  const [editMatrixRain, setEditMatrixRain] = useState(true);
  const [editCrtOverlay, setEditCrtOverlay] = useState(true);

  const [activeCategory, setActiveCategory] = useState<TokenCategory>('background');
  const [dirty, setDirty] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [showPresetManager, setShowPresetManager] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Sync from active preset when it changes
  useEffect(() => {
    if (activePreset) {
      setEditTokens({ ...activePreset.tokens });
      setEditName(activePreset.name);
      setEditBackdrop(activePreset.backdrop);
      setEditBackdropOpacity(activePreset.backdropOpacity);
      setEditBackdropIntensity(activePreset.backdropIntensity);
      setEditMatrixRain(activePreset.matrixRainEnabled);
      setEditCrtOverlay(activePreset.crtOverlayEnabled);
      setDirty(false);
    }
  }, [activePreset?.id]);

  // Live preview: apply tokens as CSS vars when editTokens changes
  useEffect(() => {
    if (dirty) {
      applyTokenMap(editTokens, 'preview');
    }
  }, [editTokens, dirty]);

  // Filtered tokens for active category
  const categoryTokens = useMemo(
    () => TOKEN_DEFINITIONS.filter(t => t.category === activeCategory),
    [activeCategory]
  );

  // Contrast warnings
  const contrastWarnings = useMemo(() => {
    const warnings: { label: string; level: 'warn' | 'fail' }[] = [];
    const checks: [string, string, string][] = [
      ['Primary Text on App BG', 'textPrimary', 'appBg'],
      ['Secondary Text on App BG', 'textSecondary', 'appBg'],
      ['Primary Text on Panel BG', 'textPrimary', 'panelBg'],
      ['Accent on App BG', 'accent', 'appBg'],
      ['Input Text on Input BG', 'inputText', 'inputBg'],
      ['Button Text on Button BG', 'btnText', 'btnBg'],
    ];
    for (const [label, fg, bg] of checks) {
      const fgVal = editTokens[fg];
      const bgVal = editTokens[bg];
      if (fgVal && bgVal) {
        const result = checkContrast(fgVal, bgVal);
        if (result !== 'pass') {
          warnings.push({ label, level: result });
        }
      }
    }
    return warnings;
  }, [editTokens]);

  // ── Handlers ──

  const updateToken = useCallback((key: string, value: string) => {
    setEditTokens(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!activePreset) return;

    if (activePreset.builtIn) {
      // Can't overwrite built-in — prompt save-as
      setShowSaveAs(true);
      setSaveAsName(activePreset.name + ' (Custom)');
      return;
    }

    // Overwrite existing custom preset
    const updated: ThemePreset = {
      ...activePreset,
      tokens: { ...editTokens },
      name: editName,
      backdrop: editBackdrop,
      backdropOpacity: editBackdropOpacity,
      backdropIntensity: editBackdropIntensity,
      matrixRainEnabled: editMatrixRain,
      crtOverlayEnabled: editCrtOverlay,
    };
    savePreset(updated);
    applyPresetById(updated.id);
    setDirty(false);
    showStatus('Theme saved');
  }, [activePreset, editTokens, editName, editBackdrop, editBackdropOpacity, editBackdropIntensity, editMatrixRain, editCrtOverlay, savePreset, applyPresetById]);

  const handleSaveAs = useCallback(() => {
    if (!saveAsName.trim()) return;

    const now = new Date().toISOString();
    const newPreset: ThemePreset = {
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      name: saveAsName.trim(),
      builtIn: false,
      tokens: { ...editTokens },
      backdrop: editBackdrop,
      backdropOpacity: editBackdropOpacity,
      backdropIntensity: editBackdropIntensity,
      matrixRainEnabled: editMatrixRain,
      crtOverlayEnabled: editCrtOverlay,
      createdAt: now,
      updatedAt: now,
    };

    savePreset(newPreset);
    applyPresetById(newPreset.id);
    setShowSaveAs(false);
    setSaveAsName('');
    setDirty(false);
    showStatus(`Saved as "${newPreset.name}"`);
  }, [saveAsName, editTokens, editBackdrop, editBackdropOpacity, editBackdropIntensity, editMatrixRain, editCrtOverlay, savePreset, applyPresetById]);

  const handleResetToCurrent = useCallback(() => {
    if (activePreset) {
      setEditTokens({ ...activePreset.tokens });
      setEditBackdrop(activePreset.backdrop);
      setEditBackdropOpacity(activePreset.backdropOpacity);
      setEditBackdropIntensity(activePreset.backdropIntensity);
      setEditMatrixRain(activePreset.matrixRainEnabled);
      setEditCrtOverlay(activePreset.crtOverlayEnabled);
      applyPresetById(activePreset.id);
      setDirty(false);
      showStatus('Reset to current preset');
    }
  }, [activePreset, applyPresetById]);

  const handleResetToMatrix = useCallback(() => {
    applyPresetById('matrix');
    setDirty(false);
    showStatus('Reset to Matrix default');
  }, [applyPresetById]);

  const handleCancel = useCallback(() => {
    cancelPreview();
    if (activePreset) {
      setEditTokens({ ...activePreset.tokens });
      setEditBackdrop(activePreset.backdrop);
      setEditBackdropOpacity(activePreset.backdropOpacity);
      setEditBackdropIntensity(activePreset.backdropIntensity);
      setEditMatrixRain(activePreset.matrixRainEnabled);
      setEditCrtOverlay(activePreset.crtOverlayEnabled);
    }
    setDirty(false);
  }, [activePreset, cancelPreview]);

  const showStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(''), 3000);
  };

  // ── Render ──
  return (
    <div className="space-y-4">
      {/* ── Preset Selector Row ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
          Active Preset
        </label>
        <select
          value={activePreset?.id || 'matrix'}
          onChange={e => applyPresetById(e.target.value)}
          className="matrix-select flex-1 min-w-[160px]"
        >
          {presets.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} {p.builtIn ? '(built-in)' : ''}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowPresetManager(!showPresetManager)}
          className="matrix-btn text-[10px] px-2 py-1"
          title="Manage presets"
        >
          {showPresetManager ? 'Close' : 'Manage Presets'}
        </button>
      </div>

      {/* ── Preset Manager ── */}
      {showPresetManager && (
        <PresetManager
          presets={presets}
          activePresetId={activePreset?.id || 'matrix'}
          onApply={applyPresetById}
          onDuplicate={(id) => {
            const dup = duplicatePreset(id, (presets.find(p => p.id === id)?.name || 'Theme') + ' Copy');
            if (dup) {
              showStatus(`Duplicated as "${dup.name}"`);
              applyPresetById(dup.id);
            }
          }}
          onDelete={(id) => {
            if (deletePreset(id)) showStatus('Preset deleted');
          }}
        />
      )}

      {/* ── Dirty Indicator + Action Bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {dirty && (
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: 'var(--theme-warning)', border: '1px solid var(--theme-warning)', opacity: 0.8 }}>
            Unsaved changes (live preview active)
          </span>
        )}
        {statusMessage && (
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: 'var(--theme-success)', border: '1px solid var(--theme-success)', opacity: 0.8 }}>
            {statusMessage}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {dirty && (
            <button onClick={handleCancel} className="matrix-btn text-[10px] px-3 py-1">Cancel</button>
          )}
          <button onClick={handleResetToCurrent} className="matrix-btn text-[10px] px-3 py-1">
            Reset to Current Defaults
          </button>
          <button onClick={handleResetToMatrix} className="matrix-btn text-[10px] px-3 py-1">
            Reset to Matrix Default
          </button>
          <button
            onClick={handleSave}
            className="matrix-btn matrix-btn-primary text-[10px] px-3 py-1"
            disabled={!dirty}
          >
            Save Theme Configuration
          </button>
        </div>
      </div>

      {/* ── Save As Dialog ── */}
      {showSaveAs && (
        <div className="glass-panel p-4 space-y-3" style={{ border: '1px solid var(--theme-accent)' }}>
          <h3 className="text-xs font-bold" style={{ color: 'var(--theme-accent)' }}>
            Save as New Preset
          </h3>
          <p className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
            Built-in presets cannot be overwritten. Save as a new custom preset.
          </p>
          <input
            type="text"
            value={saveAsName}
            onChange={e => setSaveAsName(e.target.value)}
            placeholder="Custom preset name..."
            className="matrix-input w-full"
            maxLength={50}
          />
          <div className="flex gap-2">
            <button onClick={handleSaveAs} className="matrix-btn matrix-btn-primary text-[10px] px-3 py-1" disabled={!saveAsName.trim()}>
              Save
            </button>
            <button onClick={() => setShowSaveAs(false)} className="matrix-btn text-[10px] px-3 py-1">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Contrast Warnings ── */}
      {contrastWarnings.length > 0 && (
        <div className="rounded p-3 space-y-1" style={{ background: 'var(--theme-warning)', opacity: 0.12, border: `1px solid var(--theme-warning)` }}>
          <div style={{ opacity: 1 }}>
            <h4 className="text-[10px] font-bold" style={{ color: 'var(--theme-warning)' }}>
              Contrast Warnings
            </h4>
            {contrastWarnings.map((w, i) => (
              <div key={i} className="text-[9px] flex items-center gap-1" style={{ color: w.level === 'fail' ? 'var(--theme-danger)' : 'var(--theme-warning)' }}>
                <span>{w.level === 'fail' ? '!!' : '!'}</span>
                <span>{w.label}: {w.level === 'fail' ? 'fails WCAG AA' : 'borderline (large text only)'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Backdrop System ── */}
      <div className="glass-panel p-4 space-y-3">
        <h3 className="text-xs font-bold flex items-center gap-2" style={{ color: 'var(--theme-accent)' }}>
          <span>🖼</span> Backdrop System
        </h3>

        <div className="grid grid-cols-3 gap-2">
          {BACKDROP_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => { setEditBackdrop(opt.id); setDirty(true); }}
              className={`text-left p-2 rounded border text-[10px] transition-all ${
                editBackdrop === opt.id ? 'ring-1' : ''
              }`}
              style={{
                borderColor: editBackdrop === opt.id ? 'var(--theme-accent)' : 'var(--theme-border)',
                background: editBackdrop === opt.id ? 'var(--theme-accent)' : 'transparent',
                opacity: editBackdrop === opt.id ? 0.15 : 1,
                color: 'var(--theme-text-primary)',
              }}
            >
              <div className="font-bold" style={{ color: 'var(--theme-accent)' }}>{opt.label}</div>
              <div className="text-[9px]" style={{ color: 'var(--theme-text-muted)' }}>{opt.description}</div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] mb-1" style={{ color: 'var(--theme-text-muted)' }}>
              Backdrop Opacity: {editBackdropOpacity.toFixed(2)}
            </label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={editBackdropOpacity}
              onChange={e => { setEditBackdropOpacity(parseFloat(e.target.value)); setDirty(true); }}
              className="w-full accent-current"
              style={{ accentColor: 'var(--theme-accent)' }}
            />
          </div>
          <div>
            <label className="block text-[10px] mb-1" style={{ color: 'var(--theme-text-muted)' }}>
              Backdrop Intensity: {editBackdropIntensity.toFixed(2)}
            </label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={editBackdropIntensity}
              onChange={e => { setEditBackdropIntensity(parseFloat(e.target.value)); setDirty(true); }}
              className="w-full"
              style={{ accentColor: 'var(--theme-accent)' }}
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--theme-text-dim)' }}>
            <input
              type="checkbox"
              checked={editMatrixRain}
              onChange={e => { setEditMatrixRain(e.target.checked); setDirty(true); }}
              style={{ accentColor: 'var(--theme-accent)' }}
            />
            Matrix Rain Overlay
          </label>
          <label className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--theme-text-dim)' }}>
            <input
              type="checkbox"
              checked={editCrtOverlay}
              onChange={e => { setEditCrtOverlay(e.target.checked); setDirty(true); }}
              style={{ accentColor: 'var(--theme-accent)' }}
            />
            CRT Scanline Overlay
          </label>
        </div>
      </div>

      {/* ── Token Editor ── */}
      <div className="glass-panel p-4 space-y-3">
        <h3 className="text-xs font-bold flex items-center gap-2" style={{ color: 'var(--theme-accent)' }}>
          <span>🎨</span> Color Token Editor
        </h3>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-1">
          {TOKEN_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`text-[9px] px-2 py-1 rounded border transition-all ${
                activeCategory === cat.id ? 'font-bold' : ''
              }`}
              style={{
                borderColor: activeCategory === cat.id ? 'var(--theme-accent)' : 'var(--theme-border)',
                background: activeCategory === cat.id ? 'var(--theme-tab-active-bg)' : 'transparent',
                color: activeCategory === cat.id ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Token rows */}
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
          {categoryTokens.map(def => (
            <TokenEditor
              key={def.key}
              definition={def}
              value={editTokens[def.key] || ''}
              onChange={val => updateToken(def.key, val)}
            />
          ))}
          {categoryTokens.length === 0 && (
            <p className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>No tokens in this category.</p>
          )}
        </div>
      </div>

      {/* ── Preset Name Field (for custom presets) ── */}
      {activePreset && !activePreset.builtIn && (
        <div className="glass-panel p-4 space-y-2">
          <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
            Preset Name
          </label>
          <input
            type="text"
            value={editName}
            onChange={e => { setEditName(e.target.value); setDirty(true); }}
            className="matrix-input w-full"
            maxLength={50}
          />
        </div>
      )}
    </div>
  );
}

// ─── Token Editor Row ───

function TokenEditor({ definition, value, onChange }: {
  definition: typeof TOKEN_DEFINITIONS[0];
  value: string;
  onChange: (value: string) => void;
}) {
  const [hexInput, setHexInput] = useState('');
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Sync hex input from value
  useEffect(() => {
    if (definition.type === 'color') {
      setHexInput(extractHexFromCss(value));
    }
  }, [value, definition.type]);

  if (definition.type === 'shadow') {
    return (
      <div className="flex items-center gap-3">
        <div className="w-32 text-[10px] truncate" style={{ color: 'var(--theme-text-dim)' }} title={definition.label}>
          {definition.label}
        </div>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="matrix-input flex-1 text-[10px] font-mono"
          placeholder="none or CSS shadow..."
        />
        <div className="text-[9px] font-mono w-16 truncate" style={{ color: 'var(--theme-text-muted)' }}>
          {definition.cssVar.replace('--theme-', '')}
        </div>
      </div>
    );
  }

  // Color type
  const handleHexChange = (raw: string) => {
    setHexInput(raw);
    const validated = validateHex(raw);
    if (validated) {
      onChange(validated);
    }
  };

  const handleColorPicker = (hex: string) => {
    setHexInput(hex);
    onChange(hex);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-28 text-[10px] truncate" style={{ color: 'var(--theme-text-dim)' }} title={definition.label}>
        {definition.label}
      </div>

      {/* Color swatch / picker */}
      <div
        className="w-6 h-6 rounded border cursor-pointer flex-shrink-0"
        style={{
          background: value || '#000',
          borderColor: 'var(--theme-border-bright)',
        }}
        onClick={() => colorInputRef.current?.click()}
      />
      <input
        ref={colorInputRef}
        type="color"
        value={extractHexFromCss(value)}
        onChange={e => handleColorPicker(e.target.value)}
        className="w-0 h-0 overflow-hidden opacity-0 absolute"
      />

      {/* Hex input */}
      <input
        type="text"
        value={hexInput}
        onChange={e => handleHexChange(e.target.value)}
        className="matrix-input w-24 text-[10px] font-mono"
        placeholder="#ff0069"
      />

      {/* Raw value (for rgba etc.) */}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="matrix-input flex-1 text-[10px] font-mono"
        placeholder="CSS color value..."
      />

      <div className="text-[8px] font-mono w-20 truncate" style={{ color: 'var(--theme-text-muted)' }}>
        {definition.cssVar.replace('--theme-', '')}
      </div>
    </div>
  );
}

// ─── Preset Manager Panel ───

function PresetManager({ presets, activePresetId, onApply, onDuplicate, onDelete }: {
  presets: ThemePreset[];
  activePresetId: string;
  onApply: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="glass-panel p-4 space-y-2">
      <h3 className="text-xs font-bold" style={{ color: 'var(--theme-accent)' }}>
        Preset Manager
      </h3>
      <div className="space-y-1 max-h-[200px] overflow-y-auto">
        {presets.map(p => (
          <div
            key={p.id}
            className={`flex items-center gap-2 p-2 rounded border text-[10px] ${
              p.id === activePresetId ? 'ring-1' : ''
            }`}
            style={{
              borderColor: p.id === activePresetId ? 'var(--theme-accent)' : 'var(--theme-border)',
              background: p.id === activePresetId ? 'var(--theme-tab-active-bg)' : 'transparent',
            }}
          >
            {/* Swatches */}
            <div className="flex gap-0.5 flex-shrink-0">
              <div className="w-3 h-3 rounded-full" style={{ background: p.tokens.appBg || '#000' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: p.tokens.accent || '#0f0' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: p.tokens.textPrimary || '#fff' }} />
            </div>

            <span className="font-bold flex-1" style={{ color: 'var(--theme-text-primary)' }}>
              {p.name}
            </span>

            {p.builtIn && (
              <span className="text-[8px] px-1 rounded" style={{ color: 'var(--theme-text-muted)', border: '1px solid var(--theme-border)' }}>
                built-in
              </span>
            )}

            <span className="text-[8px]" style={{ color: 'var(--theme-text-muted)' }}>
              {new Date(p.updatedAt).toLocaleDateString()}
            </span>

            <div className="flex gap-1 ml-auto">
              {p.id !== activePresetId && (
                <button
                  onClick={() => onApply(p.id)}
                  className="matrix-btn text-[9px] px-2 py-0.5"
                >
                  Apply
                </button>
              )}
              <button
                onClick={() => onDuplicate(p.id)}
                className="matrix-btn text-[9px] px-2 py-0.5"
              >
                Duplicate
              </button>
              {!p.builtIn && (
                <button
                  onClick={() => {
                    if (confirm(`Delete preset "${p.name}"?`)) {
                      onDelete(p.id);
                    }
                  }}
                  className="text-[9px] px-2 py-0.5 rounded border transition-all hover:opacity-80"
                  style={{ color: 'var(--theme-danger)', borderColor: 'var(--theme-danger)' }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
