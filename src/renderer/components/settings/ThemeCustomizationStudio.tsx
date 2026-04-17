/**
 * Theme Customization Studio — Sprint 16 + Sprint 20 + Sprint 22 (Contrast Warning Addendum)
 *
 * Sprint 22 enhancements:
 *  - Enhanced WCAG contrast warnings as "helpful coach" — token pairs, ratios, severity badges
 *  - One-click fixes (readable variant, lighten/darken, reset token, apply recommended)
 *  - Acknowledge/snooze per warning, persisted with preset
 *  - "Auto-improve readability" button with live preview, confirmation, undo
 *  - Collapsible advanced details; default shows simple readability status
 *  - Matrix preset refined for AA compliance while preserving neon-green aesthetic
 *  - Constructive wording, calm colors (blue/teal, amber, red only for true fails)
 *
 * Sprint 20 enhancements preserved:
 *  - Every token change instantly updates the entire app UI (no "Apply" button)
 *  - Matrix rain hue control, cancel/discard restores prior snapshot
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTheme } from '../../themes/ThemeContext';
import {
  TOKEN_DEFINITIONS, TOKEN_CATEGORIES, BACKDROP_OPTIONS,
  type TokenCategory, type ThemePreset, type BackdropType,
  checkContrast, validateHex, extractHexFromCss, contrastRatio,
} from '../../themes/tokens';
import { applyTokenMap, DEFAULT_MATRIX_RAIN_HUE } from '../../themes';
import {
  applySingleToken,
  applyMatrixRainHue,
  snapshotCurrentTokens,
  restoreTokenSnapshot,
  isValidColor,
  type TokenSnapshot,
} from '../../themes/applyTheme';
import {
  analyzeContrast,
  autoImproveContrast,
  loadAcknowledgments,
  saveAcknowledgments,
  acknowledgeWarning,
  unacknowledgeWarning,
  clearAllAcknowledgments,
  severityColor,
  severityLabel,
  severityBgColor,
  MATRIX_AA_REFINEMENTS,
  type ContrastWarning,
  type ContrastFix,
  type AcknowledgmentState,
  type AutoImproveResult,
} from '../../themes/contrastHelpers';

// ─── Component ───

export default function ThemeCustomizationStudio() {
  const {
    presets, activePreset, applyPresetById, savePreset,
    duplicatePreset, deletePreset, cancelPreview,
    matrixRainHue, updateMatrixRainHue, resetMatrixRainHue,
    updateTokenRealtime, updateBackdropRealtime,
    takeSnapshot, restoreSnapshot,
  } = useTheme();

  // Local editing state (copy of active preset tokens)
  const [editTokens, setEditTokens] = useState<Record<string, string>>({});
  const [editName, setEditName] = useState('');
  const [editBackdrop, setEditBackdrop] = useState<BackdropType>('matrix-rain');
  const [editBackdropOpacity, setEditBackdropOpacity] = useState(0.38);
  const [editBackdropIntensity, setEditBackdropIntensity] = useState(1.0);
  const [editMatrixRain, setEditMatrixRain] = useState(true);
  const [editCrtOverlay, setEditCrtOverlay] = useState(true);
  const [editRainHue, setEditRainHue] = useState(DEFAULT_MATRIX_RAIN_HUE);

  const [activeCategory, setActiveCategory] = useState<TokenCategory>('background');
  const [dirty, setDirty] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [showPresetManager, setShowPresetManager] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Sprint 22: Contrast warning state
  const [ackState, setAckState] = useState<AcknowledgmentState>(loadAcknowledgments);
  const [showAdvancedWarnings, setShowAdvancedWarnings] = useState(false);
  const [autoImprovePreview, setAutoImprovePreview] = useState<AutoImproveResult | null>(null);
  const [preAutoImproveTokens, setPreAutoImproveTokens] = useState<Record<string, string> | null>(null);

  // Sprint 20: Snapshot for cancel/discard
  const snapshotRef = useRef<TokenSnapshot | null>(null);

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
      setEditRainHue(activePreset.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE);
      setDirty(false);
      setAutoImprovePreview(null);
      setPreAutoImproveTokens(null);
      // Take snapshot for cancel
      snapshotRef.current = takeSnapshot();
    }
  }, [activePreset?.id]);

  // Sprint 20: Real-time live preview — apply tokens as CSS vars immediately when editTokens changes
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

  // Sprint 22: Enhanced contrast analysis
  const contrastWarnings = useMemo(() => {
    return analyzeContrast(editTokens, ackState);
  }, [editTokens, ackState]);

  const unacknowledgedWarnings = useMemo(
    () => contrastWarnings.filter(w => !w.acknowledged),
    [contrastWarnings]
  );

  const failingWarnings = useMemo(
    () => contrastWarnings.filter(w => w.severity === 'fails-aa'),
    [contrastWarnings]
  );

  const borderlineWarnings = useMemo(
    () => contrastWarnings.filter(w => w.severity === 'borderline'),
    [contrastWarnings]
  );

  // Overall readability status
  const readabilityStatus = useMemo(() => {
    if (failingWarnings.length > 0) return { label: 'Some text may be hard to read', color: 'var(--theme-warning, #facc15)', icon: '!' };
    if (borderlineWarnings.length > 0) return { label: 'Readability is good, minor improvements possible', color: 'var(--theme-info, #60a5fa)', icon: 'i' };
    return { label: 'Readability looks great', color: 'var(--theme-success, #4ade80)', icon: '\u2713' };
  }, [failingWarnings, borderlineWarnings]);

  // ── Handlers ──

  // Sprint 20: Real-time token update — updates CSS variable immediately
  const updateToken = useCallback((key: string, value: string) => {
    setEditTokens(prev => ({ ...prev, [key]: value }));
    // Instant CSS update (no batch delay for direct user input)
    updateTokenRealtime(key, value);
    setDirty(true);
  }, [updateTokenRealtime]);

  // Sprint 20: Real-time backdrop updates
  const handleBackdropChange = useCallback((type: BackdropType) => {
    setEditBackdrop(type);
    updateBackdropRealtime({ backdropType: type });
    setDirty(true);
  }, [updateBackdropRealtime]);

  const handleBackdropOpacityChange = useCallback((val: number) => {
    setEditBackdropOpacity(val);
    updateBackdropRealtime({ backdropOpacity: val });
    setDirty(true);
  }, [updateBackdropRealtime]);

  const handleBackdropIntensityChange = useCallback((val: number) => {
    setEditBackdropIntensity(val);
    updateBackdropRealtime({ backdropIntensity: val });
    setDirty(true);
  }, [updateBackdropRealtime]);

  const handleMatrixRainToggle = useCallback((checked: boolean) => {
    setEditMatrixRain(checked);
    updateBackdropRealtime({ matrixRainEnabled: checked });
    setDirty(true);
  }, [updateBackdropRealtime]);

  const handleCrtOverlayToggle = useCallback((checked: boolean) => {
    setEditCrtOverlay(checked);
    updateBackdropRealtime({ crtOverlayEnabled: checked });
    setDirty(true);
  }, [updateBackdropRealtime]);

  // Sprint 20: Matrix rain hue — real-time update
  const handleRainHueChange = useCallback((hue: string) => {
    setEditRainHue(hue);
    if (isValidColor(hue)) {
      updateMatrixRainHue(hue);
    }
    setDirty(true);
  }, [updateMatrixRainHue]);

  const handleRainHueReset = useCallback(() => {
    setEditRainHue(DEFAULT_MATRIX_RAIN_HUE);
    resetMatrixRainHue();
    setDirty(true);
  }, [resetMatrixRainHue]);

  // Sprint 22: Contrast fix handlers
  const handleApplyFix = useCallback((fix: ContrastFix) => {
    updateToken(fix.tokenKey, fix.suggestedValue);
    showStatus(`Applied fix: ${fix.label}`);
  }, [updateToken]);

  const handleAcknowledge = useCallback((fgToken: string, bgToken: string) => {
    setAckState(prev => {
      const next = acknowledgeWarning(prev, fgToken, bgToken);
      saveAcknowledgments(next);
      return next;
    });
  }, []);

  const handleUnacknowledge = useCallback((fgToken: string, bgToken: string) => {
    setAckState(prev => {
      const next = unacknowledgeWarning(prev, fgToken, bgToken);
      saveAcknowledgments(next);
      return next;
    });
  }, []);

  // Sprint 22: Auto-improve readability
  const handleAutoImprove = useCallback(() => {
    const result = autoImproveContrast(editTokens, contrastWarnings);
    if (Object.keys(result.changes).length === 0) {
      showStatus('No automatic fixes available. Try adjusting colors manually.');
      return;
    }
    // Store current tokens for undo
    setPreAutoImproveTokens({ ...editTokens });
    setAutoImprovePreview(result);
    // Apply preview
    const newTokens = { ...editTokens, ...result.changes };
    setEditTokens(newTokens);
    applyTokenMap(newTokens, 'preview');
    setDirty(true);
    showStatus(`Preview: ${result.summary.length} fix(es) applied. Confirm or undo below.`);
  }, [editTokens, contrastWarnings]);

  const handleConfirmAutoImprove = useCallback(() => {
    setAutoImprovePreview(null);
    setPreAutoImproveTokens(null);
    showStatus('Readability improvements confirmed.');
  }, []);

  const handleUndoAutoImprove = useCallback(() => {
    if (preAutoImproveTokens) {
      setEditTokens(preAutoImproveTokens);
      applyTokenMap(preAutoImproveTokens, 'preview');
    }
    setAutoImprovePreview(null);
    setPreAutoImproveTokens(null);
    showStatus('Readability changes undone.');
  }, [preAutoImproveTokens]);

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
      matrixRainHue: editRainHue,
    };
    savePreset(updated);
    applyPresetById(updated.id);
    setDirty(false);
    snapshotRef.current = takeSnapshot();
    showStatus('Theme saved');
  }, [activePreset, editTokens, editName, editBackdrop, editBackdropOpacity, editBackdropIntensity, editMatrixRain, editCrtOverlay, editRainHue, savePreset, applyPresetById, takeSnapshot]);

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
      matrixRainHue: editRainHue,
      createdAt: now,
      updatedAt: now,
    };

    savePreset(newPreset);
    applyPresetById(newPreset.id);
    setShowSaveAs(false);
    setSaveAsName('');
    setDirty(false);
    snapshotRef.current = takeSnapshot();
    showStatus(`Saved as "${newPreset.name}"`);
  }, [saveAsName, editTokens, editBackdrop, editBackdropOpacity, editBackdropIntensity, editMatrixRain, editCrtOverlay, editRainHue, savePreset, applyPresetById, takeSnapshot]);

  const handleResetToCurrent = useCallback(() => {
    if (activePreset) {
      setEditTokens({ ...activePreset.tokens });
      setEditBackdrop(activePreset.backdrop);
      setEditBackdropOpacity(activePreset.backdropOpacity);
      setEditBackdropIntensity(activePreset.backdropIntensity);
      setEditMatrixRain(activePreset.matrixRainEnabled);
      setEditCrtOverlay(activePreset.crtOverlayEnabled);
      setEditRainHue(activePreset.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE);
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

  // Sprint 20: Cancel/Discard — restore snapshot
  const handleCancel = useCallback(() => {
    if (snapshotRef.current) {
      restoreSnapshot(snapshotRef.current);
    } else {
      cancelPreview();
    }
    if (activePreset) {
      setEditTokens({ ...activePreset.tokens });
      setEditBackdrop(activePreset.backdrop);
      setEditBackdropOpacity(activePreset.backdropOpacity);
      setEditBackdropIntensity(activePreset.backdropIntensity);
      setEditMatrixRain(activePreset.matrixRainEnabled);
      setEditCrtOverlay(activePreset.crtOverlayEnabled);
      setEditRainHue(activePreset.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE);
    }
    setDirty(false);
    setAutoImprovePreview(null);
    setPreAutoImproveTokens(null);
    showStatus('Changes discarded');
  }, [activePreset, cancelPreview, restoreSnapshot]);

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
          <span className="text-[10px] px-2 py-0.5 rounded animate-pulse" style={{ color: 'var(--theme-warning)', border: '1px solid var(--theme-warning)', opacity: 0.9 }}>
            Live preview active — changes shown in real-time
          </span>
        )}
        {statusMessage && (
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: 'var(--theme-success)', border: '1px solid var(--theme-success)', opacity: 0.8 }}>
            {statusMessage}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {dirty && (
            <button onClick={handleCancel} className="matrix-btn text-[10px] px-3 py-1" title="Discard all unsaved changes and restore previous state">
              Discard Changes
            </button>
          )}
          <button onClick={handleResetToCurrent} className="matrix-btn text-[10px] px-3 py-1">
            Reset to Saved
          </button>
          <button onClick={handleResetToMatrix} className="matrix-btn text-[10px] px-3 py-1">
            Reset to Matrix Default
          </button>
          <button
            onClick={handleSave}
            className="matrix-btn matrix-btn-primary text-[10px] px-3 py-1"
            disabled={!dirty}
          >
            Save Theme
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

      {/* ── Sprint 22: Enhanced Contrast Warnings ── */}
      <ReadabilityPanel
        readabilityStatus={readabilityStatus}
        warnings={contrastWarnings}
        unacknowledgedWarnings={unacknowledgedWarnings}
        showAdvanced={showAdvancedWarnings}
        onToggleAdvanced={() => setShowAdvancedWarnings(!showAdvancedWarnings)}
        onApplyFix={handleApplyFix}
        onAcknowledge={handleAcknowledge}
        onUnacknowledge={handleUnacknowledge}
        onAutoImprove={handleAutoImprove}
        autoImprovePreview={autoImprovePreview}
        onConfirmAutoImprove={handleConfirmAutoImprove}
        onUndoAutoImprove={handleUndoAutoImprove}
      />

      {/* ── Sprint 20: Matrix Rain Hue Control ── */}
      <div className="glass-panel p-4 space-y-3">
        <h3 className="text-xs font-bold flex items-center gap-2" style={{ color: 'var(--theme-accent)' }}>
          <span style={{ fontSize: '14px' }}>&#x2602;</span> Matrix Rain Color
        </h3>
        <p className="text-[9px]" style={{ color: 'var(--theme-text-muted)' }}>
          Set the character color for the Matrix rain effect. Changes apply instantly.
        </p>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Color Picker */}
          <div className="flex items-center gap-2">
            <label className="text-[10px]" style={{ color: 'var(--theme-text-dim)' }}>Color</label>
            <input
              type="color"
              value={extractHexFromCss(editRainHue)}
              onChange={e => handleRainHueChange(e.target.value)}
              className="w-10 h-8 rounded border cursor-pointer"
              style={{ borderColor: 'var(--theme-border-bright)' }}
              title="Pick rain character color"
            />
          </div>

          {/* Hex Input */}
          <div className="flex items-center gap-2">
            <label className="text-[10px]" style={{ color: 'var(--theme-text-dim)' }}>Hex</label>
            <input
              type="text"
              value={editRainHue}
              onChange={e => {
                const raw = e.target.value;
                setEditRainHue(raw);
                const validated = validateHex(raw);
                if (validated) {
                  handleRainHueChange(validated);
                }
              }}
              className="matrix-input w-24 text-[10px] font-mono"
              placeholder="#00ff41"
              maxLength={9}
            />
          </div>

          {/* Preview Swatch */}
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: 'var(--theme-text-dim)' }}>Preview</span>
            <div
              className="w-16 h-8 rounded border flex items-center justify-center font-mono text-[11px] font-bold"
              style={{
                background: '#0a0a0a',
                borderColor: editRainHue,
                color: editRainHue,
                textShadow: `0 0 6px ${editRainHue}, 0 0 12px ${editRainHue}`,
              }}
            >
              A1
            </div>
          </div>

          {/* Hue Slider */}
          <div className="flex items-center gap-2 flex-1 min-w-[160px]">
            <label className="text-[10px]" style={{ color: 'var(--theme-text-dim)' }}>Hue</label>
            <input
              type="range"
              min="0" max="360" step="1"
              value={hexToHue(editRainHue)}
              onChange={e => {
                const hue = parseInt(e.target.value);
                const hex = hueToHex(hue);
                handleRainHueChange(hex);
              }}
              className="flex-1"
              style={{
                accentColor: editRainHue,
                background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
                height: '6px',
                borderRadius: '3px',
              }}
              title={`Hue: ${hexToHue(editRainHue)}deg`}
            />
          </div>

          {/* Reset Button */}
          <button
            onClick={handleRainHueReset}
            className="matrix-btn text-[9px] px-2 py-1"
            title="Reset to default Matrix green (#00ff41)"
            disabled={editRainHue === DEFAULT_MATRIX_RAIN_HUE}
          >
            Reset to Default
          </button>
        </div>

        {editRainHue !== DEFAULT_MATRIX_RAIN_HUE && (
          <p className="text-[9px]" style={{ color: 'var(--theme-text-muted)' }}>
            Custom hue: {editRainHue} (default: {DEFAULT_MATRIX_RAIN_HUE})
          </p>
        )}
      </div>

      {/* ── Backdrop System ── */}
      <div className="glass-panel p-4 space-y-3">
        <h3 className="text-xs font-bold flex items-center gap-2" style={{ color: 'var(--theme-accent)' }}>
          <span style={{ fontSize: '14px' }}>&#x1F5BC;</span> Backdrop System
        </h3>

        <div className="grid grid-cols-3 gap-2">
          {BACKDROP_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => handleBackdropChange(opt.id)}
              className={`text-left p-2 rounded border text-[10px] transition-all ${
                editBackdrop === opt.id ? 'ring-1' : ''
              }`}
              style={{
                borderColor: editBackdrop === opt.id ? 'var(--theme-accent)' : 'var(--theme-border)',
                background: editBackdrop === opt.id ? 'var(--theme-tab-active-bg)' : 'transparent',
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
              onChange={e => handleBackdropOpacityChange(parseFloat(e.target.value))}
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
              onChange={e => handleBackdropIntensityChange(parseFloat(e.target.value))}
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
              onChange={e => handleMatrixRainToggle(e.target.checked)}
              style={{ accentColor: 'var(--theme-accent)' }}
            />
            Matrix Rain Overlay
          </label>
          <label className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--theme-text-dim)' }}>
            <input
              type="checkbox"
              checked={editCrtOverlay}
              onChange={e => handleCrtOverlayToggle(e.target.checked)}
              style={{ accentColor: 'var(--theme-accent)' }}
            />
            CRT Scanline Overlay
          </label>
        </div>
      </div>

      {/* ── Token Editor ── */}
      <div className="glass-panel p-4 space-y-3">
        <h3 className="text-xs font-bold flex items-center gap-2" style={{ color: 'var(--theme-accent)' }}>
          <span style={{ fontSize: '14px' }}>&#x1F3A8;</span> Color Token Editor
          <span className="text-[9px] font-normal" style={{ color: 'var(--theme-text-muted)' }}>
            (changes apply instantly)
          </span>
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

// ─── Sprint 22: Readability Panel ───

function ReadabilityPanel({
  readabilityStatus,
  warnings,
  unacknowledgedWarnings,
  showAdvanced,
  onToggleAdvanced,
  onApplyFix,
  onAcknowledge,
  onUnacknowledge,
  onAutoImprove,
  autoImprovePreview,
  onConfirmAutoImprove,
  onUndoAutoImprove,
}: {
  readabilityStatus: { label: string; color: string; icon: string };
  warnings: ContrastWarning[];
  unacknowledgedWarnings: ContrastWarning[];
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onApplyFix: (fix: ContrastFix) => void;
  onAcknowledge: (fgToken: string, bgToken: string) => void;
  onUnacknowledge: (fgToken: string, bgToken: string) => void;
  onAutoImprove: () => void;
  autoImprovePreview: AutoImproveResult | null;
  onConfirmAutoImprove: () => void;
  onUndoAutoImprove: () => void;
}) {
  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold flex items-center gap-2" style={{ color: 'var(--theme-accent)' }}>
          <span style={{ fontSize: '14px' }}>&#x1F441;</span> Readability
        </h3>
        <div className="flex items-center gap-2">
          {/* Simple status indicator */}
          <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded" style={{
            color: readabilityStatus.color,
            border: `1px solid ${readabilityStatus.color}`,
            opacity: 0.8,
          }}>
            <span className="w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold" style={{
              background: readabilityStatus.color,
              color: 'var(--theme-app-bg, #0a0a0a)',
            }}>
              {readabilityStatus.icon}
            </span>
            {readabilityStatus.label}
          </span>
        </div>
      </div>

      {/* Quick summary */}
      {warnings.length === 0 ? (
        <p className="text-[9px]" style={{ color: 'var(--theme-text-muted)' }}>
          All checked text/background pairs meet WCAG AA standards. Nice work!
        </p>
      ) : (
        <p className="text-[9px]" style={{ color: 'var(--theme-text-muted)' }}>
          {unacknowledgedWarnings.length} readability suggestion{unacknowledgedWarnings.length !== 1 ? 's' : ''} found.
          {warnings.length > unacknowledgedWarnings.length && ` (${warnings.length - unacknowledgedWarnings.length} acknowledged)`}
          {' '}These won&apos;t block saving — they&apos;re here to help.
        </p>
      )}

      {/* Auto-improve button */}
      {unacknowledgedWarnings.length > 0 && !autoImprovePreview && (
        <button
          onClick={onAutoImprove}
          className="matrix-btn text-[10px] px-3 py-1.5 flex items-center gap-1.5"
          style={{ borderColor: 'var(--theme-info)', color: 'var(--theme-info)' }}
          title="Automatically adjust colors to improve readability. Preview before confirming."
        >
          <span style={{ fontSize: '12px' }}>&#x2728;</span>
          Auto-improve readability
        </button>
      )}

      {/* Auto-improve preview confirmation */}
      {autoImprovePreview && (
        <div className="rounded p-3 space-y-2" style={{ background: 'rgba(96, 165, 250, 0.06)', border: '1px solid var(--theme-info)' }}>
          <p className="text-[10px] font-bold" style={{ color: 'var(--theme-info)' }}>
            Preview: {autoImprovePreview.summary.length} change{autoImprovePreview.summary.length !== 1 ? 's' : ''} applied
          </p>
          <ul className="text-[9px] space-y-0.5" style={{ color: 'var(--theme-text-dim)' }}>
            {autoImprovePreview.summary.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
          {autoImprovePreview.unfixed.length > 0 && (
            <p className="text-[9px]" style={{ color: 'var(--theme-warning)' }}>
              Could not auto-fix: {autoImprovePreview.unfixed.join(', ')}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={onConfirmAutoImprove} className="matrix-btn matrix-btn-primary text-[10px] px-3 py-1">
              Confirm Changes
            </button>
            <button onClick={onUndoAutoImprove} className="matrix-btn text-[10px] px-3 py-1">
              Undo
            </button>
          </div>
        </div>
      )}

      {/* Collapsible advanced warnings */}
      {warnings.length > 0 && (
        <button
          onClick={onToggleAdvanced}
          className="text-[9px] flex items-center gap-1 transition-colors"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <span style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>&#x25B6;</span>
          {showAdvanced ? 'Hide' : 'Show'} detailed warnings ({warnings.length})
        </button>
      )}

      {showAdvanced && warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <ContrastWarningCard
              key={`${w.fgToken}-${w.bgToken}`}
              warning={w}
              onApplyFix={onApplyFix}
              onAcknowledge={() => onAcknowledge(w.fgToken, w.bgToken)}
              onUnacknowledge={() => onUnacknowledge(w.fgToken, w.bgToken)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Contrast Warning Card ───

function ContrastWarningCard({
  warning,
  onApplyFix,
  onAcknowledge,
  onUnacknowledge,
}: {
  warning: ContrastWarning;
  onApplyFix: (fix: ContrastFix) => void;
  onAcknowledge: () => void;
  onUnacknowledge: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const severityClr = severityColor(warning.severity);
  const severityBg = severityBgColor(warning.severity);
  const severityLbl = severityLabel(warning.severity);

  return (
    <div
      className={`rounded p-3 space-y-2 transition-opacity ${warning.acknowledged ? 'opacity-50' : ''}`}
      style={{ background: severityBg, border: `1px solid ${severityClr}40` }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0" style={{
            color: severityClr,
            border: `1px solid ${severityClr}60`,
            background: `${severityClr}15`,
          }}>
            {severityLbl}
          </span>
          <span className="text-[10px] font-bold truncate" style={{ color: 'var(--theme-text-dim)' }}>
            {warning.label}
          </span>
          <span className="text-[9px] font-mono flex-shrink-0" style={{ color: severityClr }}>
            {warning.ratio !== null ? `${warning.ratio.toFixed(2)}:1` : '?'}
          </span>
          <span className="text-[9px] flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
            (target: {warning.targetRatio}:1)
          </span>
        </button>

        {/* Acknowledge/snooze */}
        {warning.acknowledged ? (
          <button
            onClick={onUnacknowledge}
            className="text-[8px] px-1.5 py-0.5 rounded border flex-shrink-0"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}
            title="Remove acknowledgment"
          >
            Un-snooze
          </button>
        ) : (
          <button
            onClick={onAcknowledge}
            className="text-[8px] px-1.5 py-0.5 rounded border flex-shrink-0"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}
            title="Acknowledge this warning — it will be dimmed but not hidden"
          >
            Snooze
          </button>
        )}
      </div>

      {/* Token pair display */}
      <div className="flex items-center gap-2 text-[9px] font-mono" style={{ color: 'var(--theme-text-muted)' }}>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm border flex-shrink-0" style={{ background: warning.fgValue, borderColor: 'var(--theme-border)' }} />
          {warning.fgCssVar}
        </span>
        <span>vs</span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm border flex-shrink-0" style={{ background: warning.bgValue, borderColor: 'var(--theme-border)' }} />
          {warning.bgCssVar}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="space-y-2 pt-1">
          {/* Explanation */}
          <p className="text-[9px] leading-relaxed" style={{ color: 'var(--theme-text-dim)' }}>
            {warning.explanation}
          </p>

          {/* Preview: how the text looks */}
          <div className="flex gap-2">
            <div className="rounded px-3 py-2 text-[11px] font-bold" style={{ background: warning.bgValue, color: warning.fgValue }}>
              Sample text Abc 123
            </div>
          </div>

          {/* Fixes */}
          {warning.fixes.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold" style={{ color: 'var(--theme-text-muted)' }}>
                Quick fixes:
              </p>
              {warning.fixes.map(fix => (
                <button
                  key={fix.id}
                  onClick={() => onApplyFix(fix)}
                  className="flex items-center gap-2 w-full text-left text-[9px] px-2 py-1 rounded border transition-all hover:opacity-80"
                  style={{ borderColor: `${severityClr}30`, color: 'var(--theme-text-dim)' }}
                  title={fix.description}
                >
                  <span className="w-3 h-3 rounded-sm border flex-shrink-0" style={{ background: fix.suggestedValue, borderColor: 'var(--theme-border)' }} />
                  <span className="font-bold" style={{ color: severityClr }}>{fix.label}</span>
                  <span className="text-[8px]" style={{ color: 'var(--theme-text-muted)' }}>{fix.description}</span>
                </button>
              ))}
            </div>
          )}
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

  if (definition.type === 'opacity') {
    return (
      <div className="flex items-center gap-3">
        <div className="w-32 text-[10px] truncate" style={{ color: 'var(--theme-text-dim)' }} title={definition.label}>
          {definition.label}
        </div>
        <input
          type="range" min="0" max="1" step="0.01"
          value={parseFloat(value) || 0}
          onChange={e => onChange(e.target.value)}
          className="flex-1"
          style={{ accentColor: 'var(--theme-accent)' }}
        />
        <span className="text-[9px] font-mono w-10" style={{ color: 'var(--theme-text-muted)' }}>
          {parseFloat(value)?.toFixed(2) || '0.00'}
        </span>
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
    // Don't update if invalid — prevents flash-of-invisible UI
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
              {/* Sprint 20: Rain hue swatch */}
              {p.matrixRainEnabled && (
                <div
                  className="w-3 h-3 rounded-full border"
                  style={{
                    background: p.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE,
                    borderColor: 'var(--theme-border)',
                  }}
                  title={`Rain hue: ${p.matrixRainHue || DEFAULT_MATRIX_RAIN_HUE}`}
                />
              )}
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

// ─── Color Utility Helpers ───

function hexToHue(hex: string): number {
  try {
    const cleaned = hex.replace(/^#/, '');
    if (cleaned.length < 6) return 120;
    const r = parseInt(cleaned.slice(0, 2), 16) / 255;
    const g = parseInt(cleaned.slice(2, 4), 16) / 255;
    const b = parseInt(cleaned.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h: number;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return Math.round(h * 360);
  } catch {
    return 120;
  }
}

function hueToHex(hue: number): string {
  const h = hue / 60;
  const c = 1;
  const x = 1 - Math.abs(h % 2 - 1);
  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 1) { r = c; g = x; }
  else if (h >= 1 && h < 2) { r = x; g = c; }
  else if (h >= 2 && h < 3) { g = c; b = x; }
  else if (h >= 3 && h < 4) { g = x; b = c; }
  else if (h >= 4 && h < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
