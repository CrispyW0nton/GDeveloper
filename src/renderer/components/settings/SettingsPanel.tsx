/**
 * SettingsPanel — Sprint 9 + Sprint 16 + Sprint 18 + Sprint 21 + Sprint 25.9
 * API key configuration, provider selection, model selection,
 * theme customization, orchestration preferences, permission tiers.
 * Sprint 21: Comprehensive Orchestration & Limits section with
 *   - Preset profiles (Safe / Balanced / Aggressive / Custom)
 *   - Tier-aware defaults (Anthropic Tier 1-4)
 *   - Token budget controls
 *   - Retry strategy configuration
 *   - Conversation hygiene helpers
 *   - Reset to Recommended per tier
 * Sprint 25.9: Fixed infinite render loop caused by ping-pong between
 *   prop-sync effect and parent-notify effect. Both now use shallowEqual
 *   guards, and the callback ref is stabilized to break the cycle.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTheme } from '../../themes/ThemeContext';
import { THEME_META, THEME_IDS, type ThemeId } from '../../themes';
import { shallowEqual } from '../../utils/shallowEqual';
import ThemeCustomizationStudio from './ThemeCustomizationStudio';
import type {
  TokenBudgetSettings,
  AnthropicTier,
  PresetProfileId,
  RetryStrategy,
  AttachmentConfig,
} from '../../store';

const api = (window as any).electronAPI;

interface SettingsPanelProps {
  onApiKeySet: (provider: string) => void;
  selectedModel?: string;
  availableModels?: string[];
  onModelChange?: (model: string) => void;
  // Sprint 21
  tokenBudget?: TokenBudgetSettings;
  onTokenBudgetChange?: (budget: Partial<TokenBudgetSettings>) => void;
  // Sprint 25
  attachmentConfig?: AttachmentConfig;
  onAttachmentConfigChange?: (config: AttachmentConfig) => void;
}

// ─── Anthropic Tier Metadata ───

const TIER_META: Record<AnthropicTier, { label: string; description: string; inputLimit: number; outputLimit: number; requestLimit: number }> = {
  tier1: { label: 'Tier 1 — Free / New', description: 'Very tight limits. Best with Safe preset.', inputLimit: 40_000, outputLimit: 8_000, requestLimit: 50 },
  tier2: { label: 'Tier 2 — Build', description: 'Individual developers. Moderate limits.', inputLimit: 80_000, outputLimit: 16_000, requestLimit: 1000 },
  tier3: { label: 'Tier 3 — Scale', description: 'Teams / heavy workloads.', inputLimit: 160_000, outputLimit: 32_000, requestLimit: 2000 },
  tier4: { label: 'Tier 4 — Enterprise', description: 'Highest limits.', inputLimit: 400_000, outputLimit: 80_000, requestLimit: 4000 },
};

// ─── Preset Profile Metadata ───

interface PresetMeta {
  id: PresetProfileId;
  name: string;
  description: string;
  config: Omit<TokenBudgetSettings, 'providerTier' | 'activePresetProfile'>;
}

const PRESET_PROFILES: PresetMeta[] = [
  {
    id: 'safe',
    name: 'Safe',
    description: 'Minimize spend & avoid 429s. Best for Tier 1-2.',
    config: {
      maxOutputTokensPerResponse: 2048,
      maxContextTokensPerRequest: 40_000,
      maxConversationHistoryMessages: 10,
      maxToolResultTokensPerTool: 1500,
      maxToolResultsRetained: 5,
      maxParallelToolCalls: 1,
      softInputTokensPerMinute: 30_000,
      softOutputTokensPerMinute: 6_000,
      softRequestsPerMinute: 20,
      retryStrategy: 'exponential' as RetryStrategy,
      retryMaxRetries: 5,
      retryBaseDelayMs: 2000,
      retryMaxDelayMs: 60000,
    },
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good default. Keeps within typical Tier 3-4 limits.',
    config: {
      maxOutputTokensPerResponse: 4096,
      maxContextTokensPerRequest: 80_000,
      maxConversationHistoryMessages: 20,
      maxToolResultTokensPerTool: 2500,
      maxToolResultsRetained: 10,
      maxParallelToolCalls: 2,
      softInputTokensPerMinute: 400_000,
      softOutputTokensPerMinute: 14_000,
      softRequestsPerMinute: 45,
      retryStrategy: 'exponential' as RetryStrategy,
      retryMaxRetries: 5,
      retryBaseDelayMs: 1500,
      retryMaxDelayMs: 30000,
    },
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'Maximum throughput. Only for Tier 4 / unlimited.',
    config: {
      maxOutputTokensPerResponse: 8192,
      maxContextTokensPerRequest: 150_000,
      maxConversationHistoryMessages: 40,
      maxToolResultTokensPerTool: 5000,
      maxToolResultsRetained: 20,
      maxParallelToolCalls: 4,
      softInputTokensPerMinute: 380_000,
      softOutputTokensPerMinute: 60_000,
      softRequestsPerMinute: 80,
      retryStrategy: 'exponential' as RetryStrategy,
      retryMaxRetries: 3,
      retryBaseDelayMs: 1000,
      retryMaxDelayMs: 15000,
    },
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Fine-tune every setting yourself.',
    config: {
      maxOutputTokensPerResponse: 4096,
      maxContextTokensPerRequest: 80_000,
      maxConversationHistoryMessages: 20,
      maxToolResultTokensPerTool: 2500,
      maxToolResultsRetained: 10,
      maxParallelToolCalls: 2,
      softInputTokensPerMinute: 400_000,
      softOutputTokensPerMinute: 14_000,
      softRequestsPerMinute: 45,
      retryStrategy: 'exponential' as RetryStrategy,
      retryMaxRetries: 5,
      retryBaseDelayMs: 1500,
      retryMaxDelayMs: 30000,
    },
  },
];

function getRecommendedForTier(tier: AnthropicTier): PresetProfileId {
  switch (tier) {
    case 'tier1':
    case 'tier2':
      return 'safe';
    case 'tier3':
      return 'balanced';
    case 'tier4':
    default:
      return 'balanced';
  }
}

export default function SettingsPanel({ onApiKeySet, selectedModel, availableModels, onModelChange, tokenBudget, onTokenBudgetChange, attachmentConfig, onAttachmentConfigChange }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('claude');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [saved, setSaved] = useState(false);
  const [existingKey, setExistingKey] = useState('');

  // Theme
  const { themeId, setTheme } = useTheme();

  // Sprint 21 + Sprint 25.5: Token budget local state (mirrors store, editable)
  // Use useMemo for initial value to avoid recreating on every render
  const defaultBudget = useMemo<TokenBudgetSettings>(() => ({
    maxOutputTokensPerResponse: 4096,
    maxContextTokensPerRequest: 80_000,
    maxConversationHistoryMessages: 20,
    maxToolResultTokensPerTool: 2500,
    maxToolResultsRetained: 10,
    maxParallelToolCalls: 2,
    softInputTokensPerMinute: 400_000,
    softOutputTokensPerMinute: 14_000,
    softRequestsPerMinute: 45,
    retryStrategy: 'exponential',
    retryMaxRetries: 5,
    retryBaseDelayMs: 1500,
    retryMaxDelayMs: 30000,
    providerTier: 'tier4',
    activePresetProfile: 'balanced',
  }), []);

  const [budget, setBudget] = useState<TokenBudgetSettings>(() => tokenBudget ?? defaultBudget);

  // Sprint 25.9: Sync budget FROM parent props only when values actually differ.
  // Uses shallowEqual to prevent reference-change-only updates from triggering
  // the parent-notify effect (which would ping-pong back here → infinite loop).
  useEffect(() => {
    if (tokenBudget && !shallowEqual(tokenBudget, budget)) {
      setBudget(tokenBudget);
    }
  }, [tokenBudget]); // eslint-disable-line react-hooks/exhaustive-deps -- budget intentionally omitted; we only react to prop changes

  // Sprint 25.5: Derive tier warnings with useMemo instead of useEffect + setState
  // This eliminates a potential setState-during-render cascade.
  const computedTierWarnings = useMemo(() => {
    const tier = TIER_META[budget.providerTier];
    const warnings: string[] = [];
    if (budget.softInputTokensPerMinute > tier.inputLimit) {
      warnings.push(`Soft input limit (${budget.softInputTokensPerMinute.toLocaleString()}) exceeds tier hard limit (${tier.inputLimit.toLocaleString()}/min).`);
    }
    if (budget.softOutputTokensPerMinute > tier.outputLimit) {
      warnings.push(`Soft output limit (${budget.softOutputTokensPerMinute.toLocaleString()}) exceeds tier hard limit (${tier.outputLimit.toLocaleString()}/min).`);
    }
    if (budget.softRequestsPerMinute > tier.requestLimit) {
      warnings.push(`Soft request limit (${budget.softRequestsPerMinute}) exceeds tier hard limit (${tier.requestLimit}/min).`);
    }
    return warnings;
  }, [budget.softInputTokensPerMinute, budget.softOutputTokensPerMinute, budget.softRequestsPerMinute, budget.providerTier]);

  // Preferences (legacy)
  const [autoApproveRead, setAutoApproveRead] = useState(true);
  const [autoApproveWrite, setAutoApproveWrite] = useState(true);

  // Load existing key status on mount
  useEffect(() => {
    if (api) {
      api.getApiKey(provider).then((key: string) => {
        setExistingKey(key || '');
      });
    }
  }, [provider]);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setValidating(true);
    setError('');
    setWarning('');
    try {
      if (api) {
        const result = await api.validateApiKey(provider, apiKey);
        if (!result.valid) {
          setError(result.error || 'Invalid API key. Check your key and try again.');
          setValidating(false);
          return;
        }
        if (result.error) {
          setWarning(result.error);
        }
      }
      onApiKeySet(provider);
      setSaved(true);
      setExistingKey('••••••••');
      setApiKey('');
      setTimeout(() => { setSaved(false); setWarning(''); }, 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setValidating(false);
    }
  };

  const handleRemoveKey = async () => {
    if (api) {
      await api.removeApiKey(provider);
    }
    setExistingKey('');
    setApiKey('');
    setSaved(false);
  };

  // Sprint 21 + 25.9: Budget update helpers.
  // IMPORTANT: Do NOT call onTokenBudgetChange inside the setBudget updater —
  // that triggers "Cannot update a component while rendering a different component".
  // Instead, sync to parent via useEffect (below) which runs *after* render.
  const updateBudget = useCallback((partial: Partial<TokenBudgetSettings>) => {
    setBudget(prev => ({ ...prev, ...partial }));
  }, []);

  // Sprint 25.9: Stabilize the parent callback in a ref so it never appears in
  // a dep array (its identity may change every render if the parent doesn't memoize).
  const onTokenBudgetChangeRef = useRef(onTokenBudgetChange);
  useEffect(() => { onTokenBudgetChangeRef.current = onTokenBudgetChange; });

  // Sprint 25.9: Sync budget changes to parent *after* render.
  // Guards:
  //   1. Skip initial mount (budget === prop on first render).
  //   2. shallowEqual check prevents re-firing when only reference changed.
  // Together these break the ping-pong loop between prop-sync and parent-notify.
  const isInitialMount = useRef(true);
  const lastSyncedBudgetRef = useRef(budget);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      lastSyncedBudgetRef.current = budget;
      return;
    }
    if (shallowEqual(lastSyncedBudgetRef.current, budget)) return;
    lastSyncedBudgetRef.current = budget;
    onTokenBudgetChangeRef.current?.(budget);
  }, [budget]); // eslint-disable-line react-hooks/exhaustive-deps -- callback accessed via stable ref; only budget triggers sync

  const applyPreset = useCallback((presetId: PresetProfileId) => {
    const preset = PRESET_PROFILES.find(p => p.id === presetId);
    if (!preset) return;
    updateBudget({ ...preset.config, activePresetProfile: presetId });
  }, [updateBudget]);

  const applyTierRecommended = useCallback(() => {
    const recommended = getRecommendedForTier(budget.providerTier);
    applyPreset(recommended);
  }, [budget.providerTier, applyPreset]);

  const isFirstSetup = !existingKey;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-matrix-green glow-text flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            Settings
          </h1>
          <p className="text-xs text-matrix-text-muted/50 mt-1">
            {isFirstSetup
              ? 'Welcome! Add your API key below to get started. Everything else is optional.'
              : 'Configure your AI provider, preferences, and appearance.'}
          </p>
        </div>

        {/* ━━━ SECTION 1: AI PROVIDER ━━━ */}
        <SectionHeader title="AI Provider" description="Connect your AI model. You need an API key to chat." icon={<KeyIcon />} highlight={isFirstSetup} />

        <div className="glass-panel p-5 space-y-4">
          {existingKey && (
            <div className="flex items-center gap-2 text-xs text-matrix-green bg-matrix-green/5 border border-matrix-green/20 rounded-lg px-3 py-2.5">
              <span className="w-2 h-2 rounded-full bg-matrix-green animate-pulseDot" />
              <span>API key configured: {existingKey}</span>
              <button onClick={handleRemoveKey} className="ml-auto text-red-400/60 hover:text-red-400 text-[10px] transition-colors">Remove</button>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">Provider</label>
              <select
                value={provider}
                onChange={e => setProvider(e.target.value)}
                className="matrix-select"
              >
                <option value="claude">Anthropic Claude (recommended)</option>
                <option value="openai">OpenAI GPT</option>
                <option value="custom">Custom (OpenAI-compatible endpoint)</option>
              </select>
              <p className="text-[9px] text-matrix-text-muted/30 mt-1">
                {provider === 'claude' && 'Claude Sonnet is recommended for coding tasks. Get a key at console.anthropic.com.'}
                {provider === 'openai' && 'GPT-4 works well. Get a key at platform.openai.com.'}
                {provider === 'custom' && 'Any OpenAI-compatible API endpoint (e.g., local models, Azure, etc.).'}
              </p>
            </div>

            <div>
              <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">
                {existingKey ? 'Replace API Key' : 'API Key'}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={provider === 'claude' ? 'sk-ant-api03-...' : 'sk-...'}
                className="matrix-input"
              />
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-400/5 border border-red-400/20 rounded-lg px-3 py-2.5">
                {error.split('\n').map((line: string, i: number) => (
                  <React.Fragment key={i}>
                    {line}
                    {i < error.split('\n').length - 1 && <br />}
                  </React.Fragment>
                ))}
              </div>
            )}

            {saved && !warning && (
              <div className="text-xs text-matrix-green bg-matrix-green/5 border border-matrix-green/20 rounded-lg px-3 py-2.5">
                API key saved and validated. Your key is encrypted via your OS keychain.
              </div>
            )}

            {saved && warning && (
              <div className="text-xs text-yellow-400 bg-yellow-400/5 border border-yellow-400/20 rounded-lg px-3 py-2.5">
                API key saved. {warning}
              </div>
            )}

            <button
              onClick={handleSaveKey}
              disabled={!apiKey.trim() || validating}
              className="matrix-btn matrix-btn-primary w-full justify-center"
            >
              {validating ? (
                <>
                  <span className="w-3 h-3 border border-matrix-green/50 border-t-matrix-green rounded-full animate-spin" />
                  Validating...
                </>
              ) : (
                'Save & Validate Key'
              )}
            </button>
          </div>

          <p className="text-[10px] text-matrix-text-muted/30 mt-2">
            Your key is encrypted via Electron safeStorage (OS keychain) and never leaves this device.{' '}
            <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="text-matrix-info/50 hover:text-matrix-info underline">
              Get a Claude API key
            </a>
          </p>
        </div>

        {/* ━━━ SECTION 2: MODEL SELECTION ━━━ */}
        {availableModels && availableModels.length > 0 && (
          <>
            <SectionHeader title="AI Model" description="Choose which model to use. Larger models are more capable but slower." icon={<LayersIcon />} />

            <div className="glass-panel p-5 space-y-2">
              {availableModels.map(model => {
                const isSelected = model === selectedModel;
                return (
                  <button
                    key={model}
                    onClick={() => onModelChange?.(model)}
                    className={`w-full text-left p-3 rounded-lg border text-xs transition-all ${
                      isSelected
                        ? 'border-matrix-accent bg-matrix-accent/10 ring-1 ring-matrix-accent/30'
                        : 'border-matrix-border hover:border-matrix-accent/30 hover:bg-matrix-bg-hover'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-matrix-green">{model}</span>
                      {isSelected && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-matrix-green">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ━━━ SECTION 3: APPEARANCE ━━━ */}
        <SectionHeader title="Appearance" description="Customize colors, backdrops, and effects. The Matrix theme is the default." icon={<PaletteIcon />} />

        <div className="glass-panel p-5 space-y-4">
          <ThemeCustomizationStudio />
        </div>

        {/* ━━━ SECTION 4: ORCHESTRATION & LIMITS (Sprint 21) ━━━ */}
        <SectionHeader
          title="AI / Models — Orchestration & Limits"
          description="Control token budgets, rate limits, retry strategy, and context management. These settings help prevent 429 rate-limit errors during heavy MCP workflows."
          icon={<GaugeIcon />}
        />

        <div className="glass-panel p-5 space-y-5">

          {/* ── Provider Tier ── */}
          <div>
            <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">Anthropic API Tier</label>
            <select
              data-testid="tier-select"
              value={budget.providerTier}
              onChange={e => updateBudget({ providerTier: e.target.value as AnthropicTier })}
              className="matrix-select"
            >
              {(Object.keys(TIER_META) as AnthropicTier[]).map(tier => (
                <option key={tier} value={tier}>{TIER_META[tier].label}</option>
              ))}
            </select>
            <p className="text-[9px] text-matrix-text-muted/30 mt-1">
              {TIER_META[budget.providerTier].description}{' '}
              Hard limits: {TIER_META[budget.providerTier].inputLimit.toLocaleString()} input tokens/min, {TIER_META[budget.providerTier].outputLimit.toLocaleString()} output tokens/min, {TIER_META[budget.providerTier].requestLimit.toLocaleString()} requests/min.
            </p>
          </div>

          {/* ── Preset Profiles ── */}
          <div>
            <label className="block text-[10px] text-matrix-text-muted/50 mb-2 uppercase tracking-wider">Preset Profile</label>
            <div className="grid grid-cols-4 gap-2">
              {PRESET_PROFILES.map(p => {
                const isActive = budget.activePresetProfile === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    className={`p-2 rounded-lg border text-[10px] text-center transition-all ${
                      isActive
                        ? 'border-matrix-accent bg-matrix-accent/10 text-matrix-green font-bold'
                        : 'border-matrix-border hover:border-matrix-accent/30 text-matrix-text-dim'
                    }`}
                    title={p.description}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
            <p className="text-[9px] text-matrix-text-muted/25 mt-1">
              {PRESET_PROFILES.find(p => p.id === budget.activePresetProfile)?.description || ''}
            </p>
          </div>

          {/* ── Tier Warnings ── */}
          {computedTierWarnings.length > 0 && (
            <div className="text-[10px] text-yellow-400 bg-yellow-400/5 border border-yellow-400/20 rounded-lg px-3 py-2 space-y-1">
              {computedTierWarnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}

          {/* ── Per-Response Limits ── */}
          <fieldset className="space-y-3">
            <legend className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider font-bold">Per-Response Limits</legend>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Max Output Tokens / Response"
                value={budget.maxOutputTokensPerResponse}
                onChange={v => updateBudget({ maxOutputTokensPerResponse: v, activePresetProfile: 'custom' })}
                min={256} max={32768} step={256}
                hint="Tokens the model can generate per response. Default 4096."
              />
              <NumberField
                label="Max Context Tokens / Request"
                value={budget.maxContextTokensPerRequest}
                onChange={v => updateBudget({ maxContextTokensPerRequest: v, activePresetProfile: 'custom' })}
                min={5000} max={200000} step={5000}
                hint="Total input tokens sent per API request. Default 80k."
              />
            </div>
          </fieldset>

          {/* ── Conversation Management ── */}
          <fieldset className="space-y-3">
            <legend className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider font-bold">Conversation Management</legend>
            <NumberField
              label="Max Conversation History Messages"
              value={budget.maxConversationHistoryMessages}
              onChange={v => updateBudget({ maxConversationHistoryMessages: v, activePresetProfile: 'custom' })}
              min={3} max={100} step={1}
              hint="Recent messages kept in context. Older ones are summarised. Default 20."
            />
          </fieldset>

          {/* ── Tool Result Budgets ── */}
          <fieldset className="space-y-3">
            <legend className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider font-bold">Tool Results</legend>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Max Tokens per Tool Result"
                value={budget.maxToolResultTokensPerTool}
                onChange={v => updateBudget({ maxToolResultTokensPerTool: v, activePresetProfile: 'custom' })}
                min={500} max={20000} step={500}
                hint="Each tool result is capped at this. Full result stored locally. Default 2500."
              />
              <NumberField
                label="Max Tool Results Retained"
                value={budget.maxToolResultsRetained}
                onChange={v => updateBudget({ maxToolResultsRetained: v, activePresetProfile: 'custom' })}
                min={1} max={50} step={1}
                hint="Oldest results are evicted when this limit is reached. Default 10."
              />
              <NumberField
                label="Max Parallel Tool Calls"
                value={budget.maxParallelToolCalls}
                onChange={v => updateBudget({ maxParallelToolCalls: v, activePresetProfile: 'custom' })}
                min={1} max={8} step={1}
                hint="Concurrency cap for MCP tool calls. 1 = sequential. Default 2."
              />
            </div>
          </fieldset>

          {/* ── Soft Rate Limits ── */}
          <fieldset className="space-y-3">
            <legend className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider font-bold">Soft Rate Limits (per minute)</legend>
            <div className="grid grid-cols-3 gap-3">
              <NumberField
                label="Input Tokens"
                value={budget.softInputTokensPerMinute}
                onChange={v => updateBudget({ softInputTokensPerMinute: v, activePresetProfile: 'custom' })}
                min={1000} max={500000} step={10000}
                hint={`Tier limit: ${TIER_META[budget.providerTier].inputLimit.toLocaleString()}`}
              />
              <NumberField
                label="Output Tokens"
                value={budget.softOutputTokensPerMinute}
                onChange={v => updateBudget({ softOutputTokensPerMinute: v, activePresetProfile: 'custom' })}
                min={1000} max={100000} step={1000}
                hint={`Tier limit: ${TIER_META[budget.providerTier].outputLimit.toLocaleString()}`}
              />
              <NumberField
                label="Requests"
                value={budget.softRequestsPerMinute}
                onChange={v => updateBudget({ softRequestsPerMinute: v, activePresetProfile: 'custom' })}
                min={1} max={5000} step={5}
                hint={`Tier limit: ${TIER_META[budget.providerTier].requestLimit.toLocaleString()}`}
              />
            </div>
          </fieldset>

          {/* ── Retry Strategy ── */}
          <fieldset className="space-y-3">
            <legend className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider font-bold">Retry Strategy (429 Errors)</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-matrix-text-muted/50 mb-1">Strategy</label>
                <select
                  value={budget.retryStrategy}
                  onChange={e => updateBudget({ retryStrategy: e.target.value as RetryStrategy, activePresetProfile: 'custom' })}
                  className="matrix-select text-xs"
                >
                  <option value="exponential">Exponential backoff (recommended)</option>
                  <option value="linear">Linear backoff</option>
                  <option value="none">No retries</option>
                </select>
              </div>
              <NumberField
                label="Max Retries"
                value={budget.retryMaxRetries}
                onChange={v => updateBudget({ retryMaxRetries: v, activePresetProfile: 'custom' })}
                min={0} max={10} step={1}
                hint="Stop after this many failed retries. Default 5."
              />
              <NumberField
                label="Base Delay (ms)"
                value={budget.retryBaseDelayMs}
                onChange={v => updateBudget({ retryBaseDelayMs: v, activePresetProfile: 'custom' })}
                min={500} max={10000} step={100}
                hint="Initial delay before first retry. Default 1500ms."
              />
              <NumberField
                label="Max Delay (ms)"
                value={budget.retryMaxDelayMs}
                onChange={v => updateBudget({ retryMaxDelayMs: v, activePresetProfile: 'custom' })}
                min={5000} max={120000} step={1000}
                hint="Cap on retry delay. Default 30000ms."
              />
            </div>
          </fieldset>

          {/* ── Reset to Recommended ── */}
          <div className="flex gap-2 pt-2 border-t border-matrix-border/10">
            <button onClick={applyTierRecommended} className="matrix-btn text-[10px] px-3 py-1">
              Reset to Recommended for {TIER_META[budget.providerTier].label.split(' — ')[0]}
            </button>
          </div>
        </div>

        {/* ━━━ SECTION 5: PERMISSIONS ━━━ */}
        <SectionHeader title="Permissions & Safety" description="Control what the AI can do automatically vs. what requires your approval." icon={<ShieldIcon />} />

        <div className="glass-panel p-5 space-y-4">
          <div className="space-y-3">
            <label className="flex items-start gap-3 text-xs cursor-pointer">
              <input type="checkbox" checked={autoApproveRead} onChange={e => setAutoApproveRead(e.target.checked)} className="accent-matrix-green mt-0.5" />
              <div>
                <span className="text-matrix-text-dim font-bold">Auto-approve read-only tools</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-matrix-green/20 text-matrix-green/50 bg-matrix-green/5 ml-2">safe</span>
                <p className="text-[9px] text-matrix-text-muted/30 mt-0.5">Reading files, searching, listing directories. No changes made.</p>
              </div>
            </label>
            <label className="flex items-start gap-3 text-xs cursor-pointer">
              <input type="checkbox" checked={autoApproveWrite} onChange={e => setAutoApproveWrite(e.target.checked)} className="accent-matrix-green mt-0.5" />
              <div>
                <span className="text-matrix-text-dim font-bold">Auto-approve write tools in workspace</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-yellow-400/20 text-yellow-400/50 bg-yellow-400/5 ml-2">mutating</span>
                <p className="text-[9px] text-matrix-text-muted/30 mt-0.5">Writing files, editing code, running commands within your project.</p>
              </div>
            </label>
            <div className="text-[10px] text-matrix-text-muted/40 flex items-start gap-2 pl-6">
              <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-red-400/20 text-red-400/50 bg-red-400/5">destructive</span>
              <span>Push, PR, deploy, and delete always require manual approval.</span>
            </div>
          </div>
        </div>

        {/* ━━━ SECTION 6: WORKSPACE UI ━━━ */}
        <SectionHeader title="Workspace UI" description="File tree, live code view, and panel layout." icon={<GridIcon />} />

        <div className="glass-panel p-5 space-y-4">
          <div>
            <label className="text-xs text-matrix-text-dim block mb-1">File Tree Panel</label>
            <p className="text-[9px] text-matrix-text-muted/30">VS Code-style file browser on the right side. Toggle with <kbd className="px-1 py-0.5 rounded bg-matrix-bg-hover text-matrix-text-muted/40 font-mono text-[8px]">Ctrl+B</kbd>.</p>
          </div>
          <div>
            <label className="text-xs text-matrix-text-dim block mb-1">Live Code View</label>
            <p className="text-[9px] text-matrix-text-muted/30">When the AI edits a file, a read-only code viewer shows changes in real time. Toggle between live and diff views.</p>
          </div>
        </div>

        {/* ━━━ SECTION 7: CHAT BEHAVIOR ━━━ */}
        <SectionHeader title="Chat Behavior" description="Agent loop, conversation hygiene, and interaction preferences." icon={<ChatIcon />} />

        <div className="glass-panel p-5 space-y-4">
          <div>
            <label className="text-xs text-matrix-text-dim block mb-1">Agent Loop (Sprint 27.5)</label>
            <p className="text-[9px] text-matrix-text-muted/30 mb-2">The AI uses a canonical stop_reason-driven loop. It continues calling tools until the model signals end_turn. Max 25 turns per request. No manual timers or nudges.</p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider font-bold">Agent Loop Settings</legend>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Max Turns per Request"
                value={25}
                onChange={() => {}}
                min={1} max={50} step={1}
                hint="Safety cap on agent loop iterations. Default 25."
              />
              <NumberField
                label="Tool Timeout (seconds)"
                value={60}
                onChange={() => {}}
                min={5} max={300} step={5}
                hint="Default timeout for tool execution. Default 60s."
              />
            </div>
          </fieldset>

          <div className="border-t border-matrix-border/10 pt-3">
            <label className="text-xs text-matrix-text-dim block mb-1">Conversation Hygiene</label>
            <p className="text-[9px] text-matrix-text-muted/30 mb-2">
              After many tool-heavy messages, GDeveloper will suggest compacting history to save tokens.
              You can also use these actions from the chat input area.
            </p>
            <div className="flex gap-2 flex-wrap">
              <span className="text-[9px] px-2 py-0.5 rounded border border-matrix-border/30 text-matrix-text-muted/50">Start Fresh Conversation</span>
              <span className="text-[9px] px-2 py-0.5 rounded border border-matrix-border/30 text-matrix-text-muted/50">Summarize Conversation</span>
              <span className="text-[9px] px-2 py-0.5 rounded border border-matrix-border/30 text-matrix-text-muted/50">Compact History</span>
            </div>
          </div>
        </div>

        {/* ━━━ SECTION 8: ATTACHMENTS (Sprint 25) ━━━ */}
        <SectionHeader title="Attachments & Vision" description="Drag-drop files, clipboard paste, image analysis settings." icon={<PaperclipIcon />} />

        <div className="glass-panel p-5">
          <div className="space-y-4">
            {/* Enable/Disable toggles */}
            <div className="grid grid-cols-3 gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attachmentConfig?.enableDragDrop !== false}
                  onChange={(e) => {
                    if (attachmentConfig && onAttachmentConfigChange) {
                      onAttachmentConfigChange({ ...attachmentConfig, enableDragDrop: e.target.checked });
                    }
                  }}
                  className="accent-matrix-green"
                />
                <span className="text-[10px] text-matrix-text-dim">Drag & Drop</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attachmentConfig?.enableClipboardPaste !== false}
                  onChange={(e) => {
                    if (attachmentConfig && onAttachmentConfigChange) {
                      onAttachmentConfigChange({ ...attachmentConfig, enableClipboardPaste: e.target.checked });
                    }
                  }}
                  className="accent-matrix-green"
                />
                <span className="text-[10px] text-matrix-text-dim">Clipboard Paste</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attachmentConfig?.enableVision !== false}
                  onChange={(e) => {
                    if (attachmentConfig && onAttachmentConfigChange) {
                      onAttachmentConfigChange({ ...attachmentConfig, enableVision: e.target.checked });
                    }
                  }}
                  className="accent-matrix-green"
                />
                <span className="text-[10px] text-matrix-text-dim">Vision (Images)</span>
              </label>
            </div>

            {/* Size limits */}
            <div className="grid grid-cols-3 gap-3">
              <NumberField
                label="Max Image Size (MB)"
                value={attachmentConfig?.maxImageSizeMB || 20}
                onChange={(v) => {
                  if (attachmentConfig && onAttachmentConfigChange) {
                    onAttachmentConfigChange({ ...attachmentConfig, maxImageSizeMB: v });
                  }
                }}
                min={1}
                max={50}
                step={1}
                hint="Per-file image limit"
              />
              <NumberField
                label="Max Doc Size (MB)"
                value={attachmentConfig?.maxDocSizeMB || 10}
                onChange={(v) => {
                  if (attachmentConfig && onAttachmentConfigChange) {
                    onAttachmentConfigChange({ ...attachmentConfig, maxDocSizeMB: v });
                  }
                }}
                min={1}
                max={50}
                step={1}
                hint="Per-file doc limit"
              />
              <NumberField
                label="Max Total (MB)"
                value={attachmentConfig?.maxTotalSizeMB || 50}
                onChange={(v) => {
                  if (attachmentConfig && onAttachmentConfigChange) {
                    onAttachmentConfigChange({ ...attachmentConfig, maxTotalSizeMB: v });
                  }
                }}
                min={5}
                max={100}
                step={5}
                hint="Total per message"
              />
            </div>

            {/* Other settings */}
            <div className="grid grid-cols-3 gap-3">
              <NumberField
                label="Max Files/Message"
                value={attachmentConfig?.maxFilesPerMessage || 10}
                onChange={(v) => {
                  if (attachmentConfig && onAttachmentConfigChange) {
                    onAttachmentConfigChange({ ...attachmentConfig, maxFilesPerMessage: v });
                  }
                }}
                min={1}
                max={20}
                step={1}
              />
              <NumberField
                label="Auto-downscale (px)"
                value={attachmentConfig?.autoDownscaleMaxPx || 2048}
                onChange={(v) => {
                  if (attachmentConfig && onAttachmentConfigChange) {
                    onAttachmentConfigChange({ ...attachmentConfig, autoDownscaleMaxPx: v });
                  }
                }}
                min={512}
                max={4096}
                step={256}
                hint="Max dimension before resize"
              />
              <NumberField
                label="Max Text Chars"
                value={attachmentConfig?.maxTextChars || 100000}
                onChange={(v) => {
                  if (attachmentConfig && onAttachmentConfigChange) {
                    onAttachmentConfigChange({ ...attachmentConfig, maxTextChars: v });
                  }
                }}
                min={10000}
                max={500000}
                step={10000}
                hint="Doc extraction limit"
              />
            </div>

            {/* Security toggles */}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attachmentConfig?.stripExif !== false}
                  onChange={(e) => {
                    if (attachmentConfig && onAttachmentConfigChange) {
                      onAttachmentConfigChange({ ...attachmentConfig, stripExif: e.target.checked });
                    }
                  }}
                  className="accent-matrix-green"
                />
                <span className="text-[10px] text-matrix-text-dim">Strip EXIF metadata from images</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attachmentConfig?.warnOnSensitiveFiles !== false}
                  onChange={(e) => {
                    if (attachmentConfig && onAttachmentConfigChange) {
                      onAttachmentConfigChange({ ...attachmentConfig, warnOnSensitiveFiles: e.target.checked });
                    }
                  }}
                  className="accent-matrix-green"
                />
                <span className="text-[10px] text-matrix-text-dim">Warn on sensitive files (.env, keys)</span>
              </label>
            </div>
          </div>
        </div>

        {/* ━━━ SECTION 9: SECURITY ━━━ */}
        <SectionHeader title="Security & Storage" description="How your data is stored and protected." icon={<LockIcon />} />

        <div className="glass-panel p-5">
          <ul className="text-[10px] text-matrix-text-muted/50 space-y-2">
            <SecurityItem text="API keys encrypted via Electron safeStorage (your OS keychain)" />
            <SecurityItem text="Keys never leave the main process — the UI only sees masked values" />
            <SecurityItem text="Settings persisted in electron-store (survives app restarts)" />
            <SecurityItem text="SQLite database for chat history, tasks, activity logs, and diffs" />
            <SecurityItem text="MCP servers use a trust model with per-tool enable/disable controls" />
            <SecurityItem text="High-risk operations (push, PR, deploy) always require confirmation" />
            <SecurityItem text="Token budgets and rate-limit settings stored per-provider (Sprint 21)" />
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ───

function SectionHeader({ title, description, icon, highlight }: { title: string; description: string; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`flex items-start gap-3 pt-4 ${highlight ? '' : ''}`}>
      <div className={`mt-0.5 ${highlight ? 'text-matrix-green' : 'text-matrix-text-muted/40'}`}>
        {icon}
      </div>
      <div>
        <h2 className={`text-sm font-bold ${highlight ? 'text-matrix-green' : 'text-matrix-green/80'}`}>{title}</h2>
        <p className="text-[10px] text-matrix-text-muted/40 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function SecurityItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-matrix-green/30 mt-1 shrink-0" />
      <span>{text}</span>
    </li>
  );
}

function NumberField({ label, value, onChange, min, max, step, hint }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-matrix-text-muted/50 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => {
          const v = Number(e.target.value);
          if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        min={min}
        max={max}
        step={step}
        className="matrix-input text-xs w-full"
      />
      {hint && <p className="text-[9px] text-matrix-text-muted/25 mt-0.5">{hint}</p>}
    </div>
  );
}

// ─── Icon Components (inline SVG) ───

function KeyIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>;
}

function LayersIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>;
}

function PaletteIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20 10 10 0 0 1 0-20"/><path d="M12 2a7 7 0 0 1 0 14 7 7 0 0 1 0-14" fill="currentColor" opacity="0.1"/></svg>;
}

function GaugeIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>;
}

function ShieldIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
}

function GridIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>;
}

function ChatIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
}

function LockIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
}

function PaperclipIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>;
}
