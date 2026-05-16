export type MCPAuditStatus = 'running' | 'success' | 'error';
export type MCPAuditKind = 'server' | 'tool' | 'marketplace' | 'permission';

export interface MCPAuditEvent {
  id: string;
  timestamp: string;
  kind: MCPAuditKind;
  action: string;
  status: MCPAuditStatus;
  serverId?: string;
  serverName?: string;
  toolName?: string;
  transport?: string;
  latencyMs?: number;
  inputPreview?: string;
  outputPreview?: string;
  error?: string;
}

const MAX_AUDIT_EVENTS = 500;
const auditEvents: MCPAuditEvent[] = [];
const SECRET_KEY_RE = /(api[_-]?key|authorization|bearer|token|secret|password)/i;

export function recordMCPAuditEvent(event: Omit<MCPAuditEvent, 'id' | 'timestamp'>): MCPAuditEvent {
  const entry: MCPAuditEvent = {
    ...event,
    id: `mcp-audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  };
  auditEvents.unshift(entry);
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.splice(MAX_AUDIT_EVENTS);
  }
  return entry;
}

export function getMCPAuditEvents(limit = 200): MCPAuditEvent[] {
  return auditEvents.slice(0, Math.max(1, Math.min(limit, MAX_AUDIT_EVENTS)));
}

export function clearMCPAuditEvents(): void {
  auditEvents.splice(0, auditEvents.length);
}

export function previewMCPPayload(value: unknown, maxChars = 800): string {
  try {
    const redacted = redactSecrets(value);
    const text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
  } catch {
    return '[unserializable payload]';
  }
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? '[REDACTED]' : redactSecrets(nested);
    }
    return out;
  }
  if (typeof value === 'string' && SECRET_KEY_RE.test(value)) return '[REDACTED]';
  return value;
}
