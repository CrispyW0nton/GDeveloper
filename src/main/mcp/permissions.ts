import { createHash } from 'crypto';
import { getDatabase } from '../db';

export type MCPToolPermissionMode = 'allow' | 'ask' | 'deny';

export interface MCPToolPermissionRule {
  serverId?: string;
  serverName?: string;
  toolName: string;
  mode: MCPToolPermissionMode;
  workspacePath?: string;
  updatedAt: string;
}

export interface MCPToolPermissionInput {
  serverId?: string;
  serverName?: string;
  toolName: string;
  mode: MCPToolPermissionMode;
  workspacePath?: string | null;
}

const SETTINGS_PREFIX = 'mcp.tool_permissions';
const GLOBAL_SCOPE = 'global';
const memoryRules = new Map<string, MCPToolPermissionRule[]>();

export function getMCPPermissionStoreKey(workspacePath?: string | null): string {
  const scope = (workspacePath || GLOBAL_SCOPE).trim() || GLOBAL_SCOPE;
  const digest = createHash('sha1').update(scope.toLowerCase()).digest('hex').slice(0, 16);
  return `${SETTINGS_PREFIX}.${digest}`;
}

export function getMCPToolPermissionRules(workspacePath?: string | null): MCPToolPermissionRule[] {
  return readRules(workspacePath);
}

export function getMCPToolPermission(
  workspacePath: string | null | undefined,
  serverId: string | undefined,
  serverName: string | undefined,
  toolName: string
): MCPToolPermissionMode {
  const rule = findRule(readRules(workspacePath), serverId, serverName, toolName);
  return rule?.mode || 'allow';
}

export function setMCPToolPermissionRule(input: MCPToolPermissionInput): MCPToolPermissionRule {
  if (!['allow', 'ask', 'deny'].includes(input.mode)) {
    throw new Error(`Invalid MCP tool permission mode: ${input.mode}`);
  }
  if (!input.toolName) {
    throw new Error('MCP tool permission requires a tool name');
  }

  const workspacePath = input.workspacePath || undefined;
  const rules = readRules(workspacePath).filter(rule => !sameRule(rule, input.serverId, input.serverName, input.toolName));
  const nextRule: MCPToolPermissionRule = {
    serverId: input.serverId,
    serverName: input.serverName,
    toolName: input.toolName,
    mode: input.mode,
    workspacePath,
    updatedAt: new Date().toISOString(),
  };

  writeRules(workspacePath, [...rules, nextRule]);
  return nextRule;
}

function readRules(workspacePath?: string | null): MCPToolPermissionRule[] {
  const key = getMCPPermissionStoreKey(workspacePath);
  const fallback = memoryRules.get(key) || [];
  try {
    const raw = getDatabase().getSetting(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter(isRule);
  } catch (err) {
    console.warn('[MCP Permissions] Failed to read rules:', err);
    return fallback;
  }
}

function writeRules(workspacePath: string | null | undefined, rules: MCPToolPermissionRule[]): void {
  const key = getMCPPermissionStoreKey(workspacePath);
  memoryRules.set(key, rules);
  try {
    getDatabase().setSetting(key, JSON.stringify(rules));
  } catch (err) {
    console.warn('[MCP Permissions] Failed to persist rules:', err);
  }
}

function findRule(
  rules: MCPToolPermissionRule[],
  serverId: string | undefined,
  serverName: string | undefined,
  toolName: string
): MCPToolPermissionRule | undefined {
  return rules.find(rule => sameRule(rule, serverId, serverName, toolName));
}

function sameRule(
  rule: MCPToolPermissionRule,
  serverId: string | undefined,
  serverName: string | undefined,
  toolName: string
): boolean {
  if (rule.toolName !== toolName) return false;
  if (serverId && rule.serverId === serverId) return true;
  if (serverName && rule.serverName === serverName) return true;
  return false;
}

function isRule(value: unknown): value is MCPToolPermissionRule {
  const rule = value as MCPToolPermissionRule;
  return !!rule
    && typeof rule === 'object'
    && typeof rule.toolName === 'string'
    && ['allow', 'ask', 'deny'].includes(rule.mode);
}
