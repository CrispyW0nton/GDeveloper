import type { MCPRemoteAuthConfig, MCPServerConfig } from '../domain/entities';

export interface MCPRemoteTransportOptions {
  requestInit: RequestInit;
  fetch: typeof fetch;
  authPreview: MCPRemoteAuthPreview;
}

export interface MCPRemoteAuthPreview {
  headerNames: string[];
  bearerTokenEnvVar?: string;
  bearerTokenPresent: boolean;
  resourceIndicator?: string;
  scope?: string;
}

const BLOCKED_HEADER_NAMES = new Set([
  'connection',
  'content-length',
  'host',
  'transfer-encoding',
  'upgrade',
]);

const SECRET_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie)$/i;

export function buildMCPRemoteTransportOptions(server: MCPServerConfig): MCPRemoteTransportOptions {
  const auth = normalizeRemoteAuth(server.remoteAuth);
  const headers = buildRemoteHeaders(auth);
  const fetchWithHeaders = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const mergedHeaders = mergeHeaders(headers, init?.headers);
    return fetch(input, { ...init, headers: mergedHeaders });
  }) as typeof fetch;

  return {
    requestInit: { headers },
    fetch: fetchWithHeaders,
    authPreview: previewRemoteAuth(auth, headers),
  };
}

export function normalizeRemoteAuth(auth?: MCPRemoteAuthConfig): MCPRemoteAuthConfig {
  const normalized: MCPRemoteAuthConfig = {};

  if (auth?.headers) {
    normalized.headers = {};
    for (const [rawName, rawValue] of Object.entries(auth.headers)) {
      const name = rawName.trim();
      const value = String(rawValue || '').trim();
      if (!name || !value) continue;
      if (BLOCKED_HEADER_NAMES.has(name.toLowerCase())) continue;
      if (SECRET_HEADER_RE.test(name)) continue;
      normalized.headers[name] = value;
    }
    if (Object.keys(normalized.headers).length === 0) {
      delete normalized.headers;
    }
  }

  const bearerTokenEnvVar = auth?.bearerTokenEnvVar?.trim();
  if (bearerTokenEnvVar) normalized.bearerTokenEnvVar = bearerTokenEnvVar;

  const resourceIndicator = auth?.resourceIndicator?.trim();
  if (resourceIndicator) {
    const parsed = new URL(resourceIndicator);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('MCP OAuth resource indicator must be an http(s) URL');
    }
    normalized.resourceIndicator = parsed.href;
  }

  const scope = auth?.scope?.trim();
  if (scope) normalized.scope = scope;

  return normalized;
}

export function previewRemoteAuth(auth: MCPRemoteAuthConfig, headers = buildRemoteHeaders(auth)): MCPRemoteAuthPreview {
  const bearerTokenEnvVar = auth.bearerTokenEnvVar;
  return {
    headerNames: Object.keys(headers).sort(),
    bearerTokenEnvVar,
    bearerTokenPresent: !!(bearerTokenEnvVar && process.env[bearerTokenEnvVar]),
    resourceIndicator: auth.resourceIndicator,
    scope: auth.scope,
  };
}

function buildRemoteHeaders(auth: MCPRemoteAuthConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    ...(auth.headers || {}),
  };

  if (auth.bearerTokenEnvVar) {
    const token = process.env[auth.bearerTokenEnvVar];
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  return headers;
}

function mergeHeaders(base: Record<string, string>, override?: HeadersInit): Headers {
  const merged = new Headers(base);
  if (!override) return merged;
  new Headers(override).forEach((value, key) => merged.set(key, value));
  return merged;
}
