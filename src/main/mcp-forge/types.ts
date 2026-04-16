/**
 * MCP Forge — Types & Interfaces
 * Sprint 14: App Adapter Studio
 */

// ─── Capability Classification ───

export type CapabilityType =
  | 'cli'
  | 'powershell'
  | 'com'
  | 'plugin'
  | 'file-project'
  | 'gui-only';

export interface CapabilityReport {
  appName: string;
  appPath: string;
  scanTimestamp: string;
  capabilities: CapabilityEntry[];
  /** Best integration strategy based on scan */
  recommendedStrategy: CapabilityType | null;
  /** Overall confidence 0–1 */
  overallConfidence: number;
  /** Discovered files/manifests */
  discoveredArtifacts: string[];
  /** CLI help output if captured */
  cliHelpOutput: string;
  /** Errors during scan */
  warnings: string[];
}

export interface CapabilityEntry {
  type: CapabilityType;
  confidence: number; // 0–1
  evidence: string[];
  details: Record<string, string>;
}

// ─── Generated Tool Definitions ───

export type RiskLevel = 'safe' | 'caution' | 'destructive';

export interface GeneratedTool {
  name: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  examples: string[];
  timeout: number;       // ms
  riskLevel: RiskLevel;
  enabled: boolean;
  /** Where the tool came from */
  integrationPattern: CapabilityType;
  /** Confidence that this tool definition is correct */
  confidence: number;
  /** The raw CLI subcommand / invocation */
  rawCommand?: string;
}

// ─── Adapter Project ───

export type AdapterStatus =
  | 'draft'
  | 'testing'
  | 'tested'
  | 'approved'
  | 'registered'
  | 'error';

export interface AdapterProject {
  id: string;
  name: string;
  appName: string;
  appPath: string;
  adapterPath: string;       // local filesystem path to generated code
  status: AdapterStatus;
  capabilities: CapabilityReport;
  tools: GeneratedTool[];
  generatedCode: string;     // the TypeScript MCP server source
  /** Research notes (Task 6) */
  researchSummary: string;
  /** Connected MCP server ID after registration */
  mcpServerId: string | null;
  createdAt: string;
  updatedAt: string;
  lastTestResult: TestResult | null;
}

// ─── Test Harness ───

export interface TestResult {
  adapterId: string;
  timestamp: string;
  serverStarted: boolean;
  toolsDiscovered: string[];
  toolTests: ToolTestResult[];
  stdout: string;
  stderr: string;
  passed: boolean;
  error: string | null;
}

export interface ToolTestResult {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
  durationMs: number;
  error: string | null;
}

// ─── App Registry (Task 8) ───

export interface AppRecord {
  id: string;
  appName: string;
  appPath: string;
  capabilityTypes: CapabilityType[];
  adapterProjectId: string | null;
  adapterPath: string | null;
  generatedAt: string | null;
  lastTestResult: string | null;  // 'passed' | 'failed' | null
  lastConnectionState: string | null;
  usageCount: number;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}
