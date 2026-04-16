import React, { useState, useEffect } from 'react';
import { useTheme } from '../../themes/ThemeContext';
import { THEME_META, THEME_IDS, type ThemeId } from '../../themes';

const api = (window as any).electronAPI;

interface SettingsPanelProps {
  onApiKeySet: (provider: string) => void;
}

export default function SettingsPanel({ onApiKeySet }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('claude');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [saved, setSaved] = useState(false);
  const [existingKey, setExistingKey] = useState('');

  // Theme
  const { themeId, setTheme } = useTheme();

  // Preferences
  const [maxTurns, setMaxTurns] = useState(50);
  const [tokenBudget, setTokenBudget] = useState(500000);
  const [maxRetries, setMaxRetries] = useState(3);
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
        // Validate key with the main process (also stores key + registers provider on success)
        const result = await api.validateApiKey(provider, apiKey);
        if (!result.valid) {
          setError(result.error || 'Invalid API key. Check your key and try again.');
          setValidating(false);
          return;
        }
        // Key is valid; show warning if present (e.g. insufficient credits, rate-limited)
        if (result.error) {
          setWarning(result.error);
        }
      }
      onApiKeySet(provider);
      setSaved(true);
      setExistingKey('••••••••');
      setApiKey(''); // Clear the input after save
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

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-matrix-green glow-text flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            Settings
          </h1>
          <p className="text-xs text-matrix-text-muted/50 mt-1">Configure API keys, preferences, and security settings</p>
        </div>

        {/* API Key Configuration */}
        <div className="glass-panel p-5 space-y-4">
          <h2 className="text-sm font-bold text-matrix-green flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            AI Provider API Key
          </h2>

          {existingKey && (
            <div className="flex items-center gap-2 text-xs text-matrix-green bg-matrix-green/5 border border-matrix-green/20 rounded px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-matrix-green animate-pulseDot" />
              <span>API key configured: {existingKey}</span>
              <button onClick={handleRemoveKey} className="ml-auto text-matrix-danger/70 hover:text-matrix-danger text-[10px]">Remove</button>
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
                <option value="claude">Anthropic Claude</option>
                <option value="openai">OpenAI GPT</option>
                <option value="custom">Custom (OpenAI-compatible)</option>
              </select>
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
              <div className="text-xs text-matrix-danger bg-matrix-danger/5 border border-matrix-danger/20 rounded px-3 py-2">
                {error.split('\n').map((line: string, i: number) => (
                  <React.Fragment key={i}>
                    {line}
                    {i < error.split('\n').length - 1 && <br />}
                  </React.Fragment>
                ))}
              </div>
            )}

            {saved && !warning && (
              <div className="text-xs text-matrix-green bg-matrix-green/5 border border-matrix-green/20 rounded px-3 py-2">
                API key saved and validated successfully. Key is encrypted via OS keychain.
              </div>
            )}

            {saved && warning && (
              <div className="text-xs text-yellow-400 bg-yellow-400/5 border border-yellow-400/20 rounded px-3 py-2">
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
                  Validating with Anthropic API...
                </>
              ) : (
                'Save & Validate Key'
              )}
            </button>
          </div>

          <p className="text-[10px] text-matrix-text-muted/30 mt-2">
            Key is encrypted via Electron safeStorage (OS keychain) and persists across restarts.{' '}
            <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="text-matrix-info/50 hover:text-matrix-info underline">
              Get an API key
            </a>
          </p>
        </div>

        {/* Theme Selector — Sprint 15 */}
        <div className="glass-panel p-5 space-y-4">
          <h2 className="text-sm font-bold text-matrix-green flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20 10 10 0 0 1 0-20"/><path d="M12 2a7 7 0 0 1 0 14 7 7 0 0 1 0-14" fill="currentColor" opacity="0.1"/></svg>
            Theme
          </h2>
          <p className="text-[10px] text-matrix-text-muted/50">
            Choose a visual theme. Matrix is the default with rain effects. Other themes are calmer for extended sessions.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {THEME_IDS.map(id => {
              const meta = THEME_META[id];
              const isActive = themeId === id;
              return (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  className={`relative p-3 rounded-lg border text-left transition-all ${
                    isActive
                      ? 'border-matrix-accent bg-matrix-accent/10 ring-1 ring-matrix-accent/30'
                      : 'border-matrix-border hover:border-matrix-accent/30 hover:bg-matrix-bg-hover'
                  }`}
                >
                  {/* Swatch row */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex gap-1">
                      {meta.swatches.map((color, i) => (
                        <div key={i} className="w-4 h-4 rounded-full border border-white/10" style={{ background: color }} />
                      ))}
                    </div>
                    {isActive && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-matrix-green ml-auto">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </div>
                  <div className="text-xs font-bold text-matrix-green">{meta.name}</div>
                  <div className="text-[9px] text-matrix-text-muted/50 mt-0.5">{meta.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Orchestration Preferences */}
        <div className="glass-panel p-5 space-y-4">
          <h2 className="text-sm font-bold text-matrix-green flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
            Orchestration Preferences
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">Max Turns/Task</label>
              <input type="number" value={maxTurns} onChange={e => setMaxTurns(Number(e.target.value))} className="matrix-input" min={1} max={100} />
            </div>
            <div>
              <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">Token Budget</label>
              <input type="number" value={tokenBudget} onChange={e => setTokenBudget(Number(e.target.value))} className="matrix-input" min={10000} step={10000} />
            </div>
            <div>
              <label className="block text-[10px] text-matrix-text-muted/50 mb-1 uppercase tracking-wider">Max Retries</label>
              <input type="number" value={maxRetries} onChange={e => setMaxRetries(Number(e.target.value))} className="matrix-input" min={0} max={10} />
            </div>
          </div>
        </div>

        {/* Permission Settings */}
        <div className="glass-panel p-5 space-y-4">
          <h2 className="text-sm font-bold text-matrix-green flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Permission Tiers
          </h2>
          <div className="space-y-3">
            <label className="flex items-center gap-3 text-xs">
              <input type="checkbox" checked={autoApproveRead} onChange={e => setAutoApproveRead(e.target.checked)} className="accent-matrix-green" />
              <span className="text-matrix-text-dim">Auto-approve <span className="badge badge-done text-[9px]">read-only</span> tools</span>
            </label>
            <label className="flex items-center gap-3 text-xs">
              <input type="checkbox" checked={autoApproveWrite} onChange={e => setAutoApproveWrite(e.target.checked)} className="accent-matrix-green" />
              <span className="text-matrix-text-dim">Auto-approve <span className="badge badge-planned text-[9px]">write</span> tools in workspace</span>
            </label>
            <div className="text-[10px] text-matrix-text-muted/40 flex items-center gap-1.5">
              <span className="badge badge-blocked text-[9px]">high-risk</span>
              <span>tools always require approval (push, PR, deploy, delete)</span>
            </div>
          </div>
        </div>

        {/* Security Info */}
        <div className="glass-panel p-5 space-y-3">
          <h2 className="text-sm font-bold text-matrix-green flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Security
          </h2>
          <ul className="text-[10px] text-matrix-text-muted/50 space-y-1.5">
            <li className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-matrix-green/50" />
              API keys encrypted via Electron safeStorage (OS keychain)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-matrix-green/50" />
              Keys never leave the main process - renderer only sees masked values
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-matrix-green/50" />
              Settings persisted in electron-store (survives restarts)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-matrix-green/50" />
              SQLite database for tasks, chat history, and activity logs
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-matrix-green/50" />
              MCP trust model with per-tool enable/disable
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-matrix-green/50" />
              Tool approval gating for high-risk operations
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
