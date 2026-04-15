/**
 * Secure Settings & API Key Layer
 * Uses Electron safeStorage for encrypting API keys
 * Uses electron-store for persistent non-sensitive settings
 * Keys survive app restarts and are never exposed to the renderer
 */

import { app, safeStorage } from 'electron';
import ElectronStore from 'electron-store';
import { AppSettings } from '../domain/entities';

const DEFAULT_SETTINGS: AppSettings = {
  apiKeys: {},
  github: {
    connected: false,
    installations: []
  },
  preferences: {
    theme: 'matrix',
    maxTurnsPerTask: 50,
    maxTokenBudget: 500000,
    maxRetries: 3,
    autoApproveReadOnly: true,
    autoApproveWrite: true
  }
};

interface StoreSchema {
  settings: Omit<AppSettings, 'apiKeys'>;
  encryptedKeys: Record<string, string>;  // provider -> base64 encrypted buffer
  githubToken: string;  // encrypted
}

class SecureSettingsManager {
  private store: ElectronStore<StoreSchema>;
  private apiKeyCache: Map<string, string> = new Map(); // runtime cache (decrypted)
  private githubTokenCache: string | null = null;

  constructor() {
    this.store = new ElectronStore<StoreSchema>({
      name: 'gdeveloper-settings',
      defaults: {
        settings: {
          github: DEFAULT_SETTINGS.github,
          preferences: DEFAULT_SETTINGS.preferences
        } as any,
        encryptedKeys: {},
        githubToken: ''
      }
    });

    // Load and decrypt cached keys on startup
    this.loadEncryptedKeys();
  }

  private loadEncryptedKeys(): void {
    const encrypted = this.store.get('encryptedKeys', {});
    for (const [provider, encStr] of Object.entries(encrypted)) {
      if (encStr) {
        try {
          const buf = Buffer.from(encStr, 'base64');
          if (safeStorage.isEncryptionAvailable()) {
            const decrypted = safeStorage.decryptString(buf);
            this.apiKeyCache.set(provider, decrypted);
          }
        } catch (err) {
          console.error(`[SecureSettings] Failed to decrypt key for ${provider}:`, err);
          // Key is corrupted, remove it
          const keys = this.store.get('encryptedKeys', {});
          delete keys[provider];
          this.store.set('encryptedKeys', keys);
        }
      }
    }

    // Load GitHub token
    const ghEncrypted = this.store.get('githubToken', '');
    if (ghEncrypted) {
      try {
        const buf = Buffer.from(ghEncrypted, 'base64');
        if (safeStorage.isEncryptionAvailable()) {
          this.githubTokenCache = safeStorage.decryptString(buf);
        }
      } catch {
        this.store.set('githubToken', '');
      }
    }
  }

  // ─── Settings ──────────────────────────────────────

  getSettings(): AppSettings {
    const stored = this.store.get('settings', {} as any);
    // Build apiKeys with masked indicators (never return raw keys to renderer)
    const apiKeyStatus: Record<string, string> = {};
    for (const provider of this.apiKeyCache.keys()) {
      apiKeyStatus[provider] = '••••••••'; // masked
    }
    return {
      apiKeys: apiKeyStatus,
      github: {
        ...DEFAULT_SETTINGS.github,
        ...stored.github,
        connected: !!this.githubTokenCache
      },
      preferences: {
        ...DEFAULT_SETTINGS.preferences,
        ...stored.preferences
      }
    };
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    const current = this.store.get('settings', {} as any);
    const updated = {
      ...current,
      github: { ...current.github, ...partial.github },
      preferences: { ...current.preferences, ...partial.preferences }
    };
    this.store.set('settings', updated);
    return this.getSettings();
  }

  // ─── API Key Management (encrypted with OS keychain) ──

  setApiKey(provider: string, key: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key);
      const encStr = encrypted.toString('base64');
      const keys = this.store.get('encryptedKeys', {});
      keys[provider] = encStr;
      this.store.set('encryptedKeys', keys);
    }
    this.apiKeyCache.set(provider, key);
  }

  getApiKey(provider: string): string | undefined {
    return this.apiKeyCache.get(provider);
  }

  removeApiKey(provider: string): void {
    this.apiKeyCache.delete(provider);
    const keys = this.store.get('encryptedKeys', {});
    delete keys[provider];
    this.store.set('encryptedKeys', keys);
  }

  hasApiKey(provider: string): boolean {
    return this.apiKeyCache.has(provider);
  }

  getConfiguredProviders(): string[] {
    return Array.from(this.apiKeyCache.keys());
  }

  // ─── GitHub Token ──────────────────────────────────

  setGitHubToken(token: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(token);
      this.store.set('githubToken', encrypted.toString('base64'));
    }
    this.githubTokenCache = token;
    const stored = this.store.get('settings', {} as any);
    stored.github = { ...stored.github, connected: true };
    this.store.set('settings', stored);
  }

  getGitHubToken(): string | null {
    return this.githubTokenCache;
  }

  clearGitHubToken(): void {
    this.githubTokenCache = null;
    this.store.set('githubToken', '');
    const stored = this.store.get('settings', {} as any);
    stored.github = { ...stored.github, connected: false };
    this.store.set('settings', stored);
  }
}

let instance: SecureSettingsManager | null = null;

export function getSecureSettings(): SecureSettingsManager {
  if (!instance) {
    instance = new SecureSettingsManager();
  }
  return instance;
}

export { SecureSettingsManager };
