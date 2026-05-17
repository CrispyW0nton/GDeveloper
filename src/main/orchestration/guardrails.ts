import { getDatabase } from '../db';

export type GuardrailDirection = 'input' | 'output';
export type GuardrailSeverity = 'low' | 'medium' | 'high' | 'critical';
export type GuardrailCategory = 'secret' | 'pii' | 'prompt_injection' | 'unsafe_instruction';

export interface GuardrailFinding {
  id: string;
  category: GuardrailCategory;
  severity: GuardrailSeverity;
  title: string;
  detail: string;
  start: number;
  end: number;
  excerpt: string;
  recommendation: string;
  blocksSend: boolean;
}

export interface GuardrailConfig {
  enabled: boolean;
  blockSecrets: boolean;
  warnOnPii: boolean;
  warnOnPromptInjection: boolean;
}

export interface GuardrailScanResult {
  direction: GuardrailDirection;
  enabled: boolean;
  blocked: boolean;
  sanitizedText: string;
  findings: GuardrailFinding[];
  summary: string;
}

interface GuardrailStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

const SETTINGS_KEY = 'guardrails.config.v1';

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  enabled: true,
  blockSecrets: true,
  warnOnPii: true,
  warnOnPromptInjection: true,
};

const SECRET_PATTERNS: Array<Omit<GuardrailFinding, 'id' | 'start' | 'end' | 'excerpt' | 'blocksSend'> & { regex: RegExp }> = [
  {
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    category: 'secret',
    severity: 'critical',
    title: 'Private key material detected',
    detail: 'A private key appears in the message.',
    recommendation: 'Remove the key, rotate it if it was exposed, and reference a secure secret manager instead.',
  },
  {
    regex: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
    category: 'secret',
    severity: 'critical',
    title: 'Provider API key detected',
    detail: 'The text looks like an LLM provider API key.',
    recommendation: 'Do not send API keys to the model. Store them in Settings or an environment variable.',
  },
  {
    regex: /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/g,
    category: 'secret',
    severity: 'critical',
    title: 'GitHub token detected',
    detail: 'The text looks like a GitHub access token.',
    recommendation: 'Remove the token and rotate it if it was exposed.',
  },
  {
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    category: 'secret',
    severity: 'high',
    title: 'AWS access key id detected',
    detail: 'The text looks like an AWS access key id.',
    recommendation: 'Avoid sending cloud credentials to the model and rotate exposed credentials.',
  },
];

const PII_PATTERNS: Array<Omit<GuardrailFinding, 'id' | 'start' | 'end' | 'excerpt' | 'blocksSend'> & { regex: RegExp }> = [
  {
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    category: 'pii',
    severity: 'medium',
    title: 'Email address detected',
    detail: 'The message includes a likely email address.',
    recommendation: 'Confirm this personal data is necessary, or replace it with a placeholder.',
  },
  {
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    category: 'pii',
    severity: 'high',
    title: 'US SSN-like value detected',
    detail: 'The message includes a value shaped like a US Social Security number.',
    recommendation: 'Remove sensitive personal identifiers before sending.',
  },
  {
    regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    category: 'pii',
    severity: 'medium',
    title: 'Phone number detected',
    detail: 'The message includes a likely phone number.',
    recommendation: 'Confirm this personal data is necessary, or replace it with a placeholder.',
  },
];

const PROMPT_INJECTION_PATTERNS: Array<Omit<GuardrailFinding, 'id' | 'start' | 'end' | 'excerpt' | 'blocksSend'> & { regex: RegExp }> = [
  {
    regex: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|system|developer)\s+(instructions?|messages?|prompts?)\b/gi,
    category: 'prompt_injection',
    severity: 'medium',
    title: 'Prompt injection phrase detected',
    detail: 'The text asks the model to ignore higher-priority instructions.',
    recommendation: 'Treat this as untrusted content unless you intentionally want to test guardrails.',
  },
  {
    regex: /\b(reveal|print|show|dump)\s+(the\s+)?(system|developer)\s+(prompt|message|instructions?)\b/gi,
    category: 'prompt_injection',
    severity: 'medium',
    title: 'System prompt extraction request detected',
    detail: 'The text appears to request hidden system or developer instructions.',
    recommendation: 'Keep hidden prompts and policy text private; summarize behavior instead.',
  },
  {
    regex: /\bjailbreak\b|\bDAN mode\b|\bdo anything now\b/gi,
    category: 'prompt_injection',
    severity: 'medium',
    title: 'Jailbreak language detected',
    detail: 'The text contains common jailbreak phrasing.',
    recommendation: 'Treat this as adversarial input and avoid executing embedded instructions.',
  },
];

export function getGuardrailConfig(store: GuardrailStore = getDatabase()): GuardrailConfig {
  const raw = store.getSetting(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_GUARDRAIL_CONFIG };
  try {
    return { ...DEFAULT_GUARDRAIL_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_GUARDRAIL_CONFIG };
  }
}

export function setGuardrailConfig(config: Partial<GuardrailConfig>, store: GuardrailStore = getDatabase()): GuardrailConfig {
  const next = { ...getGuardrailConfig(store), ...config };
  store.setSetting(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function scanGuardrails(text: string, direction: GuardrailDirection = 'input', config: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG): GuardrailScanResult {
  if (!config.enabled) {
    return {
      direction,
      enabled: false,
      blocked: false,
      sanitizedText: text,
      findings: [],
      summary: 'Guardrails disabled.',
    };
  }

  const findings = [
    ...scanPatterns(text, SECRET_PATTERNS, config.blockSecrets),
    ...(config.warnOnPii ? scanPatterns(text, PII_PATTERNS, false) : []),
    ...(config.warnOnPromptInjection ? scanPatterns(text, PROMPT_INJECTION_PATTERNS, false) : []),
  ].sort((a, b) => a.start - b.start);
  const blocked = findings.some(finding => finding.blocksSend);

  return {
    direction,
    enabled: true,
    blocked,
    sanitizedText: redactGuardrailFindings(text, findings),
    findings,
    summary: summarizeGuardrailFindings(findings, blocked),
  };
}

export function redactGuardrailFindings(text: string, findings: GuardrailFinding[]): string {
  const secretFindings = findings.filter(finding => finding.category === 'secret');
  if (secretFindings.length === 0) return text;
  let next = text;
  for (const finding of [...secretFindings].sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, finding.start)}[REDACTED:${finding.category}]${next.slice(finding.end)}`;
  }
  return next;
}

export function formatGuardrailReport(result: GuardrailScanResult): string {
  if (result.findings.length === 0) {
    return `**Guardrails:** ${result.summary}`;
  }
  return [
    `**Guardrails:** ${result.summary}`,
    '',
    ...result.findings.map(finding => `- ${finding.severity.toUpperCase()} ${finding.category}: ${finding.title} - ${finding.recommendation}`),
  ].join('\n');
}

function scanPatterns(
  text: string,
  patterns: Array<Omit<GuardrailFinding, 'id' | 'start' | 'end' | 'excerpt' | 'blocksSend'> & { regex: RegExp }>,
  blocksSend: boolean
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      findings.push({
        id: `${pattern.category}-${findings.length + 1}-${match.index}`,
        category: pattern.category,
        severity: pattern.severity,
        title: pattern.title,
        detail: pattern.detail,
        start: match.index,
        end: match.index + match[0].length,
        excerpt: text.slice(match.index, match.index + match[0].length).slice(0, 80),
        recommendation: pattern.recommendation,
        blocksSend,
      });
    }
  }
  return findings;
}

function summarizeGuardrailFindings(findings: GuardrailFinding[], blocked: boolean): string {
  if (findings.length === 0) return 'No issues detected.';
  const counts = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.category] = (acc[finding.category] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts).map(([category, count]) => `${count} ${category}`).join(', ');
  return `${blocked ? 'Blocked' : 'Warning'}: ${summary}.`;
}
