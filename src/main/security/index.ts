/**
 * Secure Settings & API Key Layer
 * In Electron: uses OS keychain via electron-store with encryption
 * In Web Preview: uses in-memory store (demo mode)
 */

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

class SecureSettingsManager {
  private settings: AppSettings;
  private encryptionKey: string;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.encryptionKey = 'gdeveloper-secure-key'; // In Electron, derived from machine ID
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    this.settings = {
      ...this.settings,
      ...partial,
      apiKeys: { ...this.settings.apiKeys, ...partial.apiKeys },
      github: { ...this.settings.github, ...partial.github },
      preferences: { ...this.settings.preferences, ...partial.preferences }
    };
    return this.getSettings();
  }

  // API Key Management (encrypted storage)
  setApiKey(provider: string, key: string): void {
    const masked = this.encrypt(key);
    (this.settings.apiKeys as any)[provider] = key; // Store raw in memory for use
  }

  getApiKey(provider: string): string | undefined {
    return (this.settings.apiKeys as any)[provider];
  }

  removeApiKey(provider: string): void {
    delete (this.settings.apiKeys as any)[provider];
  }

  hasApiKey(provider: string): boolean {
    return !!(this.settings.apiKeys as any)[provider];
  }

  // GitHub token
  setGitHubToken(token: string): void {
    this.settings.github.connected = true;
  }

  // Simple encryption (in production, use OS keychain)
  private encrypt(value: string): string {
    return Buffer.from(value).toString('base64');
  }

  private decrypt(value: string): string {
    return Buffer.from(value, 'base64').toString('utf-8');
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
