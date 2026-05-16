import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('MCP capability-aware tool routing', () => {
  it('scores route candidates by health, failures, reconnects, transport, and latency', () => {
    const mcpSrc = readSrc('main/mcp/index.ts');

    expect(mcpSrc).toContain('export interface MCPToolRouteCandidate');
    expect(mcpSrc).toContain('private toolLatencyMs: Map<string, number>');
    expect(mcpSrc).toContain('getToolRouteCandidates(toolName: string)');
    expect(mcpSrc).toContain('healthPenalty + failurePenalty + reconnectPenalty + latencyScore + transportPenalty');
    expect(mcpSrc).toContain('candidates.sort((a, b) => a.score - b.score');
  });

  it('deduplicates MCP tools into routed tools before exposing them to the agent', () => {
    const mcpSrc = readSrc('main/mcp/index.ts');
    const mainSrc = readSrc('main/index.ts');

    expect(mcpSrc).toContain('getRoutedTools(): MCPRoutedToolInfo[]');
    expect(mcpSrc).toContain('const toolNames = new Set<string>()');
    expect(mainSrc).toContain('for (const t of mcp.getRoutedTools())');
    expect(mainSrc).toContain('selectAllowedMCPToolRoute(t.name, t.serverId)');
  });

  it('routes execution through a permission-aware selected candidate', () => {
    const mainSrc = readSrc('main/index.ts');
    const agentExecIdx = mainSrc.indexOf('executeTool: async (tc)');
    const directExecIdx = mainSrc.indexOf('IPC_CHANNELS.TOOL_EXECUTE');

    expect(mainSrc).toContain('function selectAllowedMCPToolRoute');
    expect(mainSrc.indexOf('selectAllowedMCPToolRoute(tc.name, toolMeta.serverId)', agentExecIdx)).toBeGreaterThan(agentExecIdx);
    expect(mainSrc.indexOf("action: 'route_selected'", agentExecIdx)).toBeGreaterThan(agentExecIdx);
    expect(mainSrc.indexOf('selectAllowedMCPToolRoute(name)', directExecIdx)).toBeGreaterThan(directExecIdx);
  });

  it('exposes routing methods on the MCP manager interface', () => {
    const ifaceSrc = readSrc('main/domain/interfaces/index.ts');

    expect(ifaceSrc).toContain('getRoutedTools()');
    expect(ifaceSrc).toContain('getToolRouteCandidates(toolName: string)');
    expect(ifaceSrc).toContain('routeCandidates');
    expect(ifaceSrc).toContain('lastLatencyMs');
  });
});
