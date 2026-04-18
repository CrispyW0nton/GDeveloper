/**
 * ModelPickerInline — Sprint 23
 * Compact inline model selector that lives in the chat composer area.
 * Shows current model as a subtle chip; opens a dropdown with:
 *   - Model name, provider badge, tool-calling support icon
 *   - Context window size, default-star indicator
 *   - "Set as default" option that persists via settings
 *   - Warning for incompatible models, disabled state if no API key
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

const api = (window as any).electronAPI;

export interface ModelMeta {
  id: string;
  name: string;
  provider: 'claude' | 'openai' | 'custom';
  supportsTools: boolean;
  supportsStreaming: boolean;
  contextWindow?: number;
  maxOutput?: number;
}

interface ModelPickerInlineProps {
  selectedModel: string;
  availableModels: ModelMeta[];
  defaultModel: string;
  apiKeyConfigured: boolean;
  onModelChange: (modelId: string) => void;
  onSetDefault: (modelId: string) => void;
  onRefreshModels?: () => void;           // Sprint 25.5: refresh model list
  isRefreshingModels?: boolean;            // Sprint 25.5: loading state
}

/** Format a large number compactly (e.g., 200000 → "200k") */
function formatTokenCount(n?: number): string {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** Provider badge color */
function providerColor(p: string): string {
  switch (p) {
    case 'claude': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
    case 'openai': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
    default: return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
  }
}

function providerLabel(p: string): string {
  switch (p) {
    case 'claude': return 'Anthropic';
    case 'openai': return 'OpenAI';
    default: return 'Custom';
  }
}

export default function ModelPickerInline({
  selectedModel,
  availableModels,
  defaultModel,
  apiKeyConfigured,
  onModelChange,
  onSetDefault,
  onRefreshModels,
  isRefreshingModels,
}: ModelPickerInlineProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  const currentModel = availableModels.find(m => m.id === selectedModel);
  const displayName = currentModel?.name || selectedModel || 'No model';

  const handleSelect = useCallback((modelId: string) => {
    onModelChange(modelId);
    setOpen(false);
  }, [onModelChange]);

  const handleSetDefault = useCallback((e: React.MouseEvent, modelId: string) => {
    e.stopPropagation();
    onSetDefault(modelId);
  }, [onSetDefault]);

  // Disabled state: no API key
  if (!apiKeyConfigured) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-matrix-border/20 text-[10px] text-matrix-text-muted/40 cursor-not-allowed opacity-60"
           title="Configure an API provider in Settings to select a model">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-40">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>No provider</span>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); /* Navigate to settings handled by parent */ }}
          className="text-matrix-accent/60 hover:text-matrix-accent underline ml-0.5"
        >
          Configure
        </a>
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Chip — shows current model */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-all duration-150 text-[10px] cursor-pointer ${
          open
            ? 'border-matrix-green/40 bg-matrix-green/5 text-matrix-green'
            : 'border-matrix-border/20 text-matrix-text-dim hover:border-matrix-green/30 hover:bg-matrix-green/5'
        }`}
        title={`Current model: ${displayName}. Click to switch.`}
      >
        {/* Provider dot */}
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          currentModel?.provider === 'claude' ? 'bg-orange-400' :
          currentModel?.provider === 'openai' ? 'bg-emerald-400' : 'bg-blue-400'
        }`} />
        <span className="truncate max-w-[100px]">{displayName}</span>
        {/* Tool support icon */}
        {currentModel && !currentModel.supportsTools && (
          <span title="This model does not support tool calling">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 className="text-yellow-400 flex-shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
        )}
        {/* Chevron */}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
             className={`transition-transform duration-150 flex-shrink-0 ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-72 z-50 glass-panel border border-matrix-border/30 rounded-lg shadow-xl overflow-hidden animate-fadeIn"
             style={{ maxHeight: '320px' }}>
          {/* Header — Sprint 25.5: added Refresh button */}
          <div className="px-3 py-2 border-b border-matrix-border/20 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider font-bold text-matrix-text-muted/50">Select Model</span>
            {onRefreshModels && (
              <button
                onClick={(e) => { e.stopPropagation(); onRefreshModels(); }}
                disabled={isRefreshingModels}
                className="text-[9px] text-matrix-text-muted/40 hover:text-matrix-green transition-colors px-1.5 py-0.5 rounded hover:bg-matrix-green/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                title="Refresh model list from Anthropic API"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     className={isRefreshingModels ? 'animate-spin' : ''}>
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
                {isRefreshingModels ? 'Refreshing...' : 'Refresh'}
              </button>
            )}
          </div>

          {/* Model list */}
          <div className="overflow-y-auto scrollbar-thin" style={{ maxHeight: '260px' }}>
            {availableModels.length === 0 ? (
              <div className="px-3 py-4 text-center text-[10px] text-matrix-text-muted/40">
                No models available. Check your API key.
              </div>
            ) : (
              availableModels.map(model => {
                const isSelected = model.id === selectedModel;
                const isDefault = model.id === defaultModel;
                return (
                  <div
                    key={model.id}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => handleSelect(model.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(model.id); } }}
                    className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors border-b border-matrix-border/10 last:border-b-0 cursor-pointer ${
                      isSelected
                        ? 'bg-matrix-green/8 border-l-2 border-l-matrix-green'
                        : 'hover:bg-matrix-bg-hover/40'
                    }`}
                  >
                    {/* Left: model info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {/* Model name */}
                        <span className={`text-[11px] font-medium truncate ${isSelected ? 'text-matrix-green' : 'text-matrix-text-dim'}`}>
                          {model.name}
                        </span>
                        {/* Default star */}
                        {isDefault && (
                          <span className="text-yellow-400 text-[10px]" title="Default model">★</span>
                        )}
                        {/* Selected check */}
                        {isSelected && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                               className="text-matrix-green flex-shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Provider badge */}
                        <span className={`text-[8px] px-1.5 py-0 rounded border font-medium ${providerColor(model.provider)}`}>
                          {providerLabel(model.provider)}
                        </span>
                        {/* Context window */}
                        {model.contextWindow && (
                          <span className="text-[8px] text-matrix-text-muted/40" title={`Context window: ${model.contextWindow.toLocaleString()} tokens`}>
                            ctx {formatTokenCount(model.contextWindow)}
                          </span>
                        )}
                        {/* Max output */}
                        {model.maxOutput && (
                          <span className="text-[8px] text-matrix-text-muted/40" title={`Max output: ${model.maxOutput.toLocaleString()} tokens`}>
                            out {formatTokenCount(model.maxOutput)}
                          </span>
                        )}
                        {/* Tool support */}
                        {model.supportsTools ? (
                          <span className="text-[8px] text-matrix-green/50" title="Supports tool calling">
                            🔧 tools
                          </span>
                        ) : (
                          <span className="text-[8px] text-yellow-400/60" title="No tool-calling support — some features may not work">
                            ⚠ no tools
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: set-as-default — Sprint 25.5: use <span> instead of <button> to avoid nesting */}
                    {!isDefault && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleSetDefault(e as any, model.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onSetDefault(model.id); } }}
                        className="text-[8px] text-matrix-text-muted/30 hover:text-yellow-400 transition-colors px-1 py-0.5 rounded hover:bg-yellow-400/10 flex-shrink-0 mt-0.5 cursor-pointer"
                        title="Set as default model"
                      >
                        ☆ default
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
