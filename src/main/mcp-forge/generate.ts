/**
 * MCP Forge — CLI-First MCP Server Generator
 * Sprint 14, Task 2
 *
 * Generates a TypeScript MCP server from CLI help output and capability scan.
 * Uses the official @modelcontextprotocol/sdk template structure.
 */

import { join } from 'path';
import { v4 as uuid } from 'uuid';
import { getDatabase } from '../db';
import type {
  CapabilityReport, GeneratedTool, AdapterProject, RiskLevel,
} from './types';

// ─── CLI Help Parser ───

interface ParsedSubcommand {
  name: string;
  description: string;
  flags: ParsedFlag[];
  positionalArgs: string[];
}

interface ParsedFlag {
  name: string;
  alias?: string;
  description: string;
  takesValue: boolean;
  required: boolean;
  defaultValue?: string;
}

/**
 * Parse --help output into structured subcommands.
 */
export function parseCLIHelp(helpOutput: string): ParsedSubcommand[] {
  if (!helpOutput || helpOutput.length < 10) return [];

  const subcommands: ParsedSubcommand[] = [];
  const lines = helpOutput.split('\n');

  // Strategy 1: Look for subcommand sections
  let inCommandsSection = false;
  const commandLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(commands?|subcommands?|available\s+commands?)/i.test(trimmed) || trimmed.match(/^(COMMANDS?|SUBCOMMANDS?)/)) {
      inCommandsSection = true;
      continue;
    }
    if (inCommandsSection) {
      if (trimmed === '' || /^[A-Z]/.test(trimmed) && !trimmed.match(/^\s/)) {
        inCommandsSection = false;
        continue;
      }
      commandLines.push(trimmed);
    }
  }

  // Parse command lines like: "  init        Initialize a project"
  for (const cl of commandLines) {
    const match = cl.match(/^\s*(\S+)\s{2,}(.+)/);
    if (match) {
      subcommands.push({
        name: match[1],
        description: match[2].trim(),
        flags: [],
        positionalArgs: [],
      });
    }
  }

  // Strategy 2: Parse flags/options
  const flags: ParsedFlag[] = [];
  let inOptionsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(options?|flags?|arguments?)/i.test(trimmed)) {
      inOptionsSection = true;
      continue;
    }
    if (inOptionsSection) {
      if (trimmed === '' && flags.length > 0) {
        inOptionsSection = false;
        continue;
      }
      // Parse: -f, --flag <value>  Description
      const flagMatch = trimmed.match(/^\s*(-\w)?,?\s*(--[\w-]+)(?:\s+[<\[]([\w.-]+)[>\]])?(?:\s{2,}(.+))?/);
      if (flagMatch) {
        flags.push({
          name: flagMatch[2].replace(/^--/, ''),
          alias: flagMatch[1] || undefined,
          description: flagMatch[4]?.trim() || '',
          takesValue: !!flagMatch[3],
          required: false,
        });
      }
    }
  }

  // If no subcommands found, create a "main" tool from the flags
  if (subcommands.length === 0 && flags.length > 0) {
    subcommands.push({
      name: 'run',
      description: 'Execute the CLI tool',
      flags,
      positionalArgs: [],
    });
  }

  // Attach discovered flags to all subcommands if they have none
  for (const cmd of subcommands) {
    if (cmd.flags.length === 0 && flags.length > 0) {
      cmd.flags = [...flags];
    }
  }

  return subcommands;
}

// ─── Risk Classification ───

const DESTRUCTIVE_KEYWORDS = [
  'delete', 'remove', 'drop', 'destroy', 'purge', 'wipe',
  'reset', 'clean', 'force', 'uninstall', 'erase',
];

const CAUTION_KEYWORDS = [
  'write', 'update', 'modify', 'create', 'init', 'install',
  'set', 'change', 'move', 'rename', 'patch', 'push', 'deploy',
];

function classifyRisk(name: string, description: string): RiskLevel {
  const combined = `${name} ${description}`.toLowerCase();
  if (DESTRUCTIVE_KEYWORDS.some(kw => combined.includes(kw))) return 'destructive';
  if (CAUTION_KEYWORDS.some(kw => combined.includes(kw))) return 'caution';
  return 'safe';
}

// ─── Tool Generation ───

function generateToolsFromSubcommands(
  subcommands: ParsedSubcommand[],
  appName: string,
  capReport: CapabilityReport
): GeneratedTool[] {
  return subcommands.map(cmd => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const flag of cmd.flags) {
      const paramName = flag.name.replace(/-/g, '_');
      properties[paramName] = {
        type: flag.takesValue ? 'string' : 'boolean',
        description: flag.description || `Flag: --${flag.name}`,
      };
      if (flag.required) required.push(paramName);
    }

    // Add positional args
    for (const arg of cmd.positionalArgs) {
      properties[arg] = {
        type: 'string',
        description: `Positional argument: ${arg}`,
      };
    }

    const riskLevel = classifyRisk(cmd.name, cmd.description);
    const cliEntry = capReport.capabilities.find(c => c.type === 'cli');
    const cliConfidence = cliEntry?.confidence || 0.5;

    return {
      name: `${appName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${cmd.name}`,
      description: cmd.description || `Execute ${appName} ${cmd.name}`,
      parameterSchema: {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      },
      examples: [`${appName} ${cmd.name}`],
      timeout: 30000,
      riskLevel,
      enabled: riskLevel !== 'destructive', // disable destructive by default
      integrationPattern: 'cli' as const,
      confidence: cliConfidence * 0.8,
      rawCommand: `${cmd.name}`,
    };
  });
}

// ─── MCP Server Code Generation ───

function generateMCPServerCode(
  adapterName: string,
  appPath: string,
  tools: GeneratedTool[]
): string {
  const enabledTools = tools.filter(t => t.enabled);

  const toolRegistrations = enabledTools.map(t => {
    const params = t.parameterSchema as any;
    const props = params?.properties || {};
    const propEntries = Object.entries(props);

    const argBuilder = propEntries.map(([key, schema]: [string, any]) => {
      if (schema.type === 'boolean') {
        return `      if (args.${key}) cmdArgs.push('--${key.replace(/_/g, '-')}');`;
      }
      return `      if (args.${key} !== undefined) cmdArgs.push('--${key.replace(/_/g, '-')}', String(args.${key}));`;
    }).join('\n');

    return `
  server.tool(
    '${t.name}',
    '${t.description.replace(/'/g, "\\'")}',
    ${JSON.stringify(params, null, 4)},
    async (args: any) => {
      const cmdArgs: string[] = ['${t.rawCommand || ''}'];
${argBuilder}
      const result = await runCommand(APP_PATH, cmdArgs);
      return { content: [{ type: 'text', text: result }] };
    }
  );`;
  }).join('\n');

  return `#!/usr/bin/env node
/**
 * MCP Server: ${adapterName}
 * Generated by GDeveloper MCP Forge — Sprint 14
 *
 * App: ${appPath}
 * Tools: ${enabledTools.length}
 * Generated: ${new Date().toISOString()}
 *
 * This server wraps a CLI application and exposes its commands as MCP tools.
 * It uses the official @modelcontextprotocol/sdk.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { execFile } from 'child_process';

const APP_PATH = ${JSON.stringify(appPath)};

/**
 * Execute a CLI command and return stdout.
 */
function runCommand(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      shell: true,
    }, (error, stdout, stderr) => {
      if (error && !stdout && !stderr) {
        reject(new Error(\`Command failed: \${error.message}\`));
        return;
      }
      resolve(stdout || stderr || '(no output)');
    });
  });
}

async function main() {
  const server = new McpServer({
    name: '${adapterName}',
    version: '1.0.0',
  });
${toolRegistrations}

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[${adapterName}] MCP server running on stdio');
}

main().catch(err => {
  console.error('[${adapterName}] Fatal error:', err);
  process.exit(1);
});
`;
}

// ─── Main Generation Entry Point ───

/**
 * Generate a draft MCP server adapter for a CLI-capable app.
 */
export function generateCLIAdapter(
  capReport: CapabilityReport,
  adapterDir: string
): AdapterProject {
  const db = getDatabase();
  const id = uuid();
  const appName = capReport.appName;
  const adapterName = `${appName}-mcp-server`;

  // Parse CLI help to discover subcommands
  const subcommands = parseCLIHelp(capReport.cliHelpOutput);

  // Generate tools
  let tools: GeneratedTool[];
  if (subcommands.length > 0) {
    tools = generateToolsFromSubcommands(subcommands, appName, capReport);
  } else {
    // Fallback: create a generic "run" tool
    tools = [{
      name: `${appName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_run`,
      description: `Execute ${appName} with custom arguments`,
      parameterSchema: {
        type: 'object',
        properties: {
          args: {
            type: 'string',
            description: 'Command-line arguments to pass',
          },
        },
      },
      examples: [`${appName} --version`],
      timeout: 30000,
      riskLevel: 'caution',
      enabled: true,
      integrationPattern: 'cli',
      confidence: 0.3,
    }];
  }

  // Generate server code
  const generatedCode = generateMCPServerCode(adapterName, capReport.appPath, tools);

  // Build adapter project
  const adapterPath = join(adapterDir, adapterName);
  const project: AdapterProject = {
    id,
    name: adapterName,
    appName,
    appPath: capReport.appPath,
    adapterPath,
    status: 'draft',
    capabilities: capReport,
    tools,
    generatedCode,
    researchSummary: '',
    mcpServerId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastTestResult: null,
  };

  db.logActivity('system', 'forge_generate', `Generated adapter: ${adapterName}`,
    `${tools.length} tools, strategy: ${capReport.recommendedStrategy}`, {
      adapterId: id, appName, appPath: capReport.appPath, toolCount: tools.length,
    });

  return project;
}
