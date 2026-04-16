/**
 * MCP Forge — App Adapter Studio Panel
 * Sprint 14: Scan, Generate, Build, Test, Register workflow.
 */

import React, { useState, useEffect } from 'react';

const api = (window as any).electronAPI;

// ─── Types mirrored from backend ───

type CapabilityType = 'cli' | 'powershell' | 'com' | 'plugin' | 'file-project' | 'gui-only';
type RiskLevel = 'safe' | 'caution' | 'destructive';
type AdapterStatus = 'draft' | 'testing' | 'tested' | 'approved' | 'registered' | 'error';

interface CapabilityEntry { type: CapabilityType; confidence: number; evidence: string[]; details: Record<string, string>; }
interface CapabilityReport {
  appName: string; appPath: string; scanTimestamp: string;
  capabilities: CapabilityEntry[]; recommendedStrategy: CapabilityType | null;
  overallConfidence: number; discoveredArtifacts: string[];
  cliHelpOutput: string; warnings: string[];
}
interface GeneratedTool {
  name: string; description: string; parameterSchema: any;
  examples: string[]; timeout: number; riskLevel: RiskLevel;
  enabled: boolean; integrationPattern: CapabilityType;
  confidence: number; rawCommand?: string;
}
interface TestResult {
  adapterId: string; timestamp: string; serverStarted: boolean;
  toolsDiscovered: string[]; toolTests: any[]; stdout: string;
  stderr: string; passed: boolean; error: string | null;
}
interface AdapterProject {
  id: string; name: string; appName: string; appPath: string;
  adapterPath: string; status: AdapterStatus; capabilities: CapabilityReport;
  tools: GeneratedTool[]; generatedCode: string; researchSummary: string;
  mcpServerId: string | null; createdAt: string; updatedAt: string;
  lastTestResult: TestResult | null;
}

// ─── Sub-tabs ───
type ForgeTab = 'scan' | 'builder' | 'adapters' | 'research';

export default function McpForgePanel() {
  const [tab, setTab] = useState<ForgeTab>('scan');

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between">
        <h2 className="text-sm font-bold text-matrix-green glow-text-dim flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
          MCP Forge — App Adapter Studio
        </h2>
        <div className="flex gap-1">
          {(['scan', 'builder', 'adapters', 'research'] as ForgeTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-[10px] rounded transition-all ${
                tab === t ? 'bg-matrix-green/20 text-matrix-green border border-matrix-green/40' : 'text-matrix-text-muted/50 hover:text-matrix-green/70 border border-transparent'
              }`}>
              {t === 'scan' ? 'Scan App' : t === 'builder' ? 'Tool Builder' : t === 'adapters' ? 'Adapters' : 'Research'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'scan' && <ScanTab />}
        {tab === 'builder' && <ToolBuilderTab />}
        {tab === 'adapters' && <AdaptersTab />}
        {tab === 'research' && <ResearchTab />}
      </div>
    </div>
  );
}

// ─── Scan Tab ───

function ScanTab() {
  const [appPath, setAppPath] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<CapabilityReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<AdapterProject | null>(null);
  const [error, setError] = useState('');

  const handleScan = async () => {
    if (!appPath.trim() || !api) return;
    setScanning(true); setError(''); setScanResult(null); setGenResult(null);
    try {
      const res = await api.forgeScan(appPath.trim());
      if (res.success) setScanResult(res.report);
      else setError(res.error || 'Scan failed');
    } catch (err: any) { setError(err.message || 'Scan failed'); }
    setScanning(false);
  };

  const handleGenerate = async () => {
    if (!scanResult || !api) return;
    setGenerating(true); setError('');
    try {
      const res = await api.forgeGenerate(scanResult);
      if (res.success) setGenResult(res.project);
      else setError(res.error || 'Generation failed');
    } catch (err: any) { setError(err.message || 'Generation failed'); }
    setGenerating(false);
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="glass-panel p-4">
        <h3 className="text-xs font-bold text-matrix-green mb-3 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          Scan Application
        </h3>
        <p className="text-[10px] text-matrix-text-muted/40 mb-3">
          Browse to an executable, install folder, or app root directory. GDeveloper will detect how to best integrate with it.
        </p>
        <div className="flex gap-2">
          <input value={appPath} onChange={e => setAppPath(e.target.value)}
            className="matrix-input flex-1" placeholder="/path/to/executable or /path/to/app-root"
            onKeyDown={e => e.key === 'Enter' && handleScan()} />
          <button onClick={handleScan} disabled={scanning || !appPath.trim()} className="matrix-btn matrix-btn-primary text-xs whitespace-nowrap">
            {scanning ? <><span className="w-3 h-3 border border-matrix-green/50 border-t-matrix-green rounded-full animate-spin inline-block" /> Scanning...</> : 'Scan'}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-matrix-danger bg-matrix-danger/5 border border-matrix-danger/20 rounded px-3 py-2">{error}</div>}

      {/* Scan Results */}
      {scanResult && (
        <div className="glass-panel p-4 space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-matrix-green">{scanResult.appName}</h3>
            <span className="text-[9px] text-matrix-text-muted/40">{scanResult.appPath}</span>
          </div>

          {/* Capabilities */}
          <div className="space-y-2">
            <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider">Detected Capabilities</h4>
            {scanResult.capabilities.map((cap, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-matrix-bg-hover/30 rounded">
                <CapBadge type={cap.type} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-matrix-green font-bold">{cap.type}</span>
                    <ConfidenceBar confidence={cap.confidence} />
                  </div>
                  <div className="text-[9px] text-matrix-text-muted/40 mt-0.5">
                    {cap.evidence.slice(0, 3).join(' · ')}
                  </div>
                </div>
                {scanResult.recommendedStrategy === cap.type && (
                  <span className="badge badge-connected text-[8px]">RECOMMENDED</span>
                )}
              </div>
            ))}
          </div>

          {/* Warnings */}
          {scanResult.warnings.length > 0 && (
            <div className="text-[10px] text-matrix-warning bg-matrix-warning/5 border border-matrix-warning/20 rounded p-2">
              {scanResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}

          {/* CLI Help Preview */}
          {scanResult.cliHelpOutput && (
            <details className="text-[10px]">
              <summary className="text-matrix-text-muted/50 cursor-pointer hover:text-matrix-green">CLI Help Output ({scanResult.cliHelpOutput.length} chars)</summary>
              <pre className="mt-1 p-2 bg-black/40 rounded text-matrix-text-dim overflow-x-auto max-h-40 text-[9px]">
                {scanResult.cliHelpOutput.substring(0, 3000)}
              </pre>
            </details>
          )}

          {/* Generate Button */}
          {scanResult.recommendedStrategy === 'cli' && (
            <button onClick={handleGenerate} disabled={generating} className="matrix-btn matrix-btn-primary text-xs w-full">
              {generating ? <><span className="w-3 h-3 border border-matrix-green/50 border-t-matrix-green rounded-full animate-spin inline-block" /> Generating Adapter...</> : 'Generate CLI MCP Server'}
            </button>
          )}
          {scanResult.recommendedStrategy && scanResult.recommendedStrategy !== 'cli' && scanResult.recommendedStrategy !== 'gui-only' && (
            <div className="text-[10px] text-matrix-info/60 bg-matrix-info/5 border border-matrix-info/20 rounded p-2">
              {scanResult.recommendedStrategy} adapter generation is planned for a future sprint. Currently only CLI adapters are supported.
            </div>
          )}
          {scanResult.recommendedStrategy === 'gui-only' && (
            <div className="text-[10px] text-matrix-warning bg-matrix-warning/5 border border-matrix-warning/20 rounded p-2">
              This application appears to be GUI-only. MCP adapter generation requires a CLI or programmatic interface.
            </div>
          )}
        </div>
      )}

      {/* Generation Result */}
      {genResult && (
        <div className="glass-panel p-4 space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-matrix-green flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              Adapter Generated
            </h3>
            <span className="badge badge-planned text-[8px]">{genResult.status}</span>
          </div>
          <div className="text-[10px] text-matrix-text-muted/40">
            <div>{genResult.tools.length} tools generated · Saved to: {genResult.adapterPath}</div>
          </div>
          <div className="text-[10px] text-matrix-green/60">
            Switch to the <strong>Tool Builder</strong> tab to review and edit tools, then <strong>Test</strong> and <strong>Register</strong>.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool Builder Tab ───

function ToolBuilderTab() {
  const [adapters, setAdapters] = useState<AdapterProject[]>([]);
  const [selected, setSelected] = useState<AdapterProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTool, setEditingTool] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAdapters = async () => {
    if (!api) { setLoading(false); return; }
    try {
      const list = await api.forgeListAdapters();
      setAdapters(list || []);
      if (list.length > 0 && !selected) setSelected(list[0]);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadAdapters(); }, []);

  const updateTool = (toolName: string, updates: Partial<GeneratedTool>) => {
    if (!selected) return;
    const updatedTools = selected.tools.map(t =>
      t.name === toolName ? { ...t, ...updates } : t
    );
    setSelected({ ...selected, tools: updatedTools });
  };

  const handleSave = async () => {
    if (!selected || !api) return;
    setSaving(true);
    try {
      await api.forgeUpdateAdapter(selected.id, { tools: selected.tools });
      await loadAdapters();
    } catch { /* ignore */ }
    setSaving(false);
  };

  if (loading) return <div className="p-4 text-center"><span className="w-4 h-4 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin inline-block" /></div>;

  return (
    <div className="flex gap-4 h-full">
      {/* Adapter List */}
      <div className="w-56 space-y-1 flex-shrink-0">
        <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-2">Adapter Projects</h4>
        {adapters.length === 0 ? (
          <p className="text-[10px] text-matrix-text-muted/30">No adapters yet. Scan an app first.</p>
        ) : adapters.map(a => (
          <button key={a.id} onClick={() => setSelected(a)}
            className={`w-full text-left p-2 rounded text-xs transition-all ${
              selected?.id === a.id ? 'bg-matrix-green/10 border border-matrix-green/30 text-matrix-green' : 'hover:bg-matrix-bg-hover text-matrix-text-muted/60 border border-transparent'
            }`}>
            <div className="font-bold truncate">{a.appName}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <StatusBadge status={a.status} />
              <span className="text-[9px] text-matrix-text-muted/40">{a.tools.length} tools</span>
            </div>
          </button>
        ))}
      </div>

      {/* Tool Builder Detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-matrix-green">{selected.name}</h3>
                <div className="text-[10px] text-matrix-text-muted/40">{selected.appPath}</div>
              </div>
              <button onClick={handleSave} disabled={saving} className="matrix-btn matrix-btn-primary text-xs">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

            <div className="space-y-2">
              <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider">
                Tools ({selected.tools.length}) — click to expand
              </h4>
              {selected.tools.map(tool => (
                <div key={tool.name} className="glass-panel p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 cursor-pointer"
                      onClick={() => setEditingTool(editingTool === tool.name ? null : tool.name)}>
                      <RiskBadge level={tool.riskLevel} />
                      <span className="text-xs text-matrix-green font-bold">{tool.name}</span>
                      <ConfidenceBar confidence={tool.confidence} />
                      <span className="text-[9px] text-matrix-text-muted/30">{tool.integrationPattern}</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer ml-2">
                      <input type="checkbox" checked={tool.enabled}
                        onChange={() => updateTool(tool.name, { enabled: !tool.enabled })}
                        className="sr-only peer" />
                      <div className="w-8 h-4 bg-matrix-border rounded-full peer-checked:bg-matrix-green/30 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-matrix-text-muted/40 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4 peer-checked:after:bg-matrix-green" />
                    </label>
                  </div>
                  <div className="text-[10px] text-matrix-text-muted/40 mt-1">{tool.description}</div>

                  {editingTool === tool.name && (
                    <div className="mt-2 pt-2 border-t border-matrix-border/30 space-y-2 animate-fadeIn">
                      <div>
                        <label className="block text-[9px] text-matrix-text-muted/40 mb-0.5">Description</label>
                        <input value={tool.description} onChange={e => updateTool(tool.name, { description: e.target.value })}
                          className="matrix-input text-[10px]" />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[9px] text-matrix-text-muted/40 mb-0.5">Timeout (ms)</label>
                          <input type="number" value={tool.timeout}
                            onChange={e => updateTool(tool.name, { timeout: parseInt(e.target.value) || 30000 })}
                            className="matrix-input text-[10px]" />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[9px] text-matrix-text-muted/40 mb-0.5">Risk Level</label>
                          <select value={tool.riskLevel}
                            onChange={e => updateTool(tool.name, { riskLevel: e.target.value as RiskLevel })}
                            className="matrix-select text-[10px]">
                            <option value="safe">Safe</option>
                            <option value="caution">Caution</option>
                            <option value="destructive">Destructive</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[9px] text-matrix-text-muted/40 mb-0.5">Parameters</label>
                        <pre className="p-2 bg-black/40 rounded text-[9px] text-matrix-text-dim overflow-x-auto max-h-24">
                          {JSON.stringify(tool.parameterSchema, null, 2)}
                        </pre>
                      </div>
                      {tool.rawCommand && (
                        <div className="text-[9px] text-matrix-text-muted/30">Raw command: <code className="text-matrix-info/60">{tool.rawCommand}</code></div>
                      )}
                    </div>
                  )}

                  {tool.riskLevel === 'destructive' && tool.enabled && (
                    <div className="text-[9px] text-matrix-danger mt-1">
                      Warning: This tool is marked as destructive. User confirmation will be required at runtime.
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Generated Code Preview */}
            <details className="text-[10px]">
              <summary className="text-matrix-text-muted/50 cursor-pointer hover:text-matrix-green">View Generated Server Code</summary>
              <pre className="mt-1 p-3 bg-black/40 rounded text-matrix-text-dim overflow-x-auto max-h-80 text-[9px]">
                {selected.generatedCode}
              </pre>
            </details>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-matrix-text-muted/30">
            Select an adapter project to edit tools
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Adapters Tab (Test, Register, Manage) ───

function AdaptersTab() {
  const [adapters, setAdapters] = useState<AdapterProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    if (!api) { setLoading(false); return; }
    try { setAdapters(await api.forgeListAdapters()); } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleTest = async (id: string) => {
    setTesting(id); setError(''); setTestResult(null);
    try {
      const res = await api.forgeTest(id);
      if (res.success) setTestResult(res.result);
      else setError(res.error || 'Test failed');
      await load();
    } catch (err: any) { setError(err.message); }
    setTesting(null);
  };

  const handleRegister = async (id: string) => {
    setRegistering(id); setError('');
    try {
      const res = await api.forgeRegister(id);
      if (!res.success) setError(res.error || 'Registration failed');
      await load();
    } catch (err: any) { setError(err.message); }
    setRegistering(null);
  };

  const handleUnregister = async (id: string) => {
    try { await api.forgeUnregister(id); await load(); }
    catch (err: any) { setError(err.message); }
  };

  const handleRemove = async (id: string) => {
    try { await api.forgeRemoveAdapter(id); await load(); }
    catch (err: any) { setError(err.message); }
  };

  if (loading) return <div className="p-4 text-center"><span className="w-4 h-4 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin inline-block" /></div>;

  return (
    <div className="space-y-3 max-w-3xl">
      <h3 className="text-xs font-bold text-matrix-green">Generated Adapters</h3>
      {error && <div className="text-xs text-matrix-danger bg-matrix-danger/5 border border-matrix-danger/20 rounded px-3 py-2">{error}</div>}

      {adapters.length === 0 ? (
        <p className="text-[10px] text-matrix-text-muted/30">No adapters generated yet. Use the Scan App tab to get started.</p>
      ) : adapters.map(a => (
        <div key={a.id} className="glass-panel p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-matrix-green">{a.appName}</span>
                <StatusBadge status={a.status} />
                {a.mcpServerId && <span className="text-[8px] text-matrix-info/60 badge badge-connected">CONNECTED</span>}
              </div>
              <div className="text-[9px] text-matrix-text-muted/40 mt-0.5">
                {a.tools.filter(t => t.enabled).length}/{a.tools.length} tools enabled · {a.adapterPath}
              </div>
            </div>
            <div className="flex gap-1">
              {a.status !== 'registered' && (
                <button onClick={() => handleTest(a.id)} disabled={testing === a.id}
                  className="matrix-btn text-[10px] px-2 py-1">
                  {testing === a.id ? 'Testing...' : 'Test'}
                </button>
              )}
              {(a.status === 'tested' || a.status === 'approved' || a.status === 'draft') && !a.mcpServerId && (
                <button onClick={() => handleRegister(a.id)} disabled={registering === a.id}
                  className="matrix-btn matrix-btn-primary text-[10px] px-2 py-1">
                  {registering === a.id ? 'Registering...' : 'Register & Connect'}
                </button>
              )}
              {a.mcpServerId && (
                <button onClick={() => handleUnregister(a.id)}
                  className="matrix-btn text-[10px] px-2 py-1">Disconnect</button>
              )}
              <button onClick={() => handleRemove(a.id)}
                className="matrix-btn matrix-btn-danger text-[10px] px-2 py-1">Remove</button>
            </div>
          </div>

          {/* Test Result */}
          {testResult && testResult.adapterId === a.id && (
            <div className={`text-[10px] p-2 rounded border animate-fadeIn ${
              testResult.passed ? 'bg-matrix-green/5 border-matrix-green/20 text-matrix-green' : 'bg-matrix-danger/5 border-matrix-danger/20 text-matrix-danger'
            }`}>
              <div className="font-bold">{testResult.passed ? 'Test Passed' : 'Test Failed'}</div>
              <div className="mt-1 space-y-0.5">
                <div>Server started: {testResult.serverStarted ? 'Yes' : 'No'}</div>
                <div>Tools discovered: {testResult.toolsDiscovered.length} ({testResult.toolsDiscovered.join(', ')})</div>
                {testResult.error && <div className="text-matrix-danger">Error: {testResult.error}</div>}
                {testResult.stderr && (
                  <details><summary className="cursor-pointer">stderr</summary>
                    <pre className="mt-1 p-1 bg-black/30 rounded text-[9px] max-h-20 overflow-auto">{testResult.stderr}</pre>
                  </details>
                )}
              </div>
            </div>
          )}

          {/* Last test result from persisted data */}
          {a.lastTestResult && (!testResult || testResult.adapterId !== a.id) && (
            <div className="text-[9px] text-matrix-text-muted/40">
              Last test: {a.lastTestResult.passed ? 'Passed' : 'Failed'} ({new Date(a.lastTestResult.timestamp).toLocaleString()})
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Research Tab ───

function ResearchTab() {
  const [appName, setAppName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [researching, setResearching] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [researchResult, setResearchResult] = useState('');
  const [analysisRepos, setAnalysisRepos] = useState<any[]>([]);
  const [error, setError] = useState('');

  const loadAnalysisRepos = async () => {
    if (!api) return;
    try { setAnalysisRepos(await api.forgeAnalysisList()); } catch {}
  };

  useEffect(() => { loadAnalysisRepos(); }, []);

  const handleForgeResearch = async () => {
    if (!appName.trim() || !api) return;
    setResearching(true); setError(''); setResearchResult('');
    try {
      const fakeCap = { appName: appName.trim(), appPath: '', scanTimestamp: '', capabilities: [], recommendedStrategy: null, overallConfidence: 0, discoveredArtifacts: [], cliHelpOutput: '', warnings: [] };
      const res = await api.forgeResearch(appName.trim(), fakeCap, `forge-research-${Date.now()}`);
      if (res.success) setResearchResult(res.summary);
      else setError(res.error || 'Research failed');
    } catch (err: any) { setError(err.message); }
    setResearching(false);
  };

  const handleClone = async () => {
    if (!repoUrl.trim() || !api) return;
    setCloning(true); setError('');
    try {
      const res = await api.forgeAnalysisClone(repoUrl.trim());
      if (res.success) await loadAnalysisRepos();
      else setError(res.error || 'Clone failed');
    } catch (err: any) { setError(err.message); }
    setCloning(false);
  };

  const handleRemoveRepo = async (localPath: string) => {
    if (!api) return;
    await api.forgeAnalysisRemove(localPath);
    await loadAnalysisRepos();
  };

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Deep Research notice — relocated to Chat */}
      <div className="glass-panel p-4 border-matrix-info/20">
        <h3 className="text-xs font-bold text-matrix-info mb-2 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          Deep Research moved to Chat
        </h3>
        <p className="text-[10px] text-matrix-text-muted/50 leading-relaxed">
          General-purpose deep research is now available directly in Chat via slash commands:
        </p>
        <div className="mt-2 space-y-1 text-[10px] text-matrix-text-dim">
          <div><code className="text-matrix-green/70">/research &lt;question&gt;</code> — multi-step deep research with streaming results</div>
          <div><code className="text-matrix-green/70">/research-continue &lt;follow-up&gt;</code> — refine a previous research query</div>
          <div><code className="text-matrix-green/70">/compare-repos &lt;path1&gt; &lt;path2&gt;</code> — side-by-side repository comparison</div>
        </div>
      </div>

      {/* Forge-specific: App Integration Research */}
      <div className="glass-panel p-4">
        <h3 className="text-xs font-bold text-matrix-green mb-2">Adapter Research</h3>
        <p className="text-[10px] text-matrix-text-muted/40 mb-2">
          Research an application's integration surface — docs, SDKs, existing wrappers, and automation strategies for adapter generation.
        </p>
        <div className="flex gap-2 mb-2">
          <input value={appName} onChange={e => setAppName(e.target.value)}
            className="matrix-input flex-1" placeholder="Application name (e.g., ffmpeg, docker, git)"
            onKeyDown={e => e.key === 'Enter' && handleForgeResearch()} />
          <button onClick={handleForgeResearch} disabled={researching || !appName.trim()} className="matrix-btn matrix-btn-primary text-xs">
            {researching ? 'Researching...' : 'Research for Adapter'}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-matrix-danger bg-matrix-danger/5 border border-matrix-danger/20 rounded px-3 py-2">{error}</div>}

      {researchResult && (
        <div className="glass-panel p-4 animate-fadeIn">
          <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-2">Adapter Research Results</h4>
          <div className="prose-matrix text-[10px] text-matrix-text-dim whitespace-pre-wrap max-h-96 overflow-y-auto">
            {researchResult}
          </div>
        </div>
      )}

      {/* External Analysis Repos */}
      <div className="glass-panel p-4">
        <h3 className="text-xs font-bold text-matrix-green mb-2">External Repo Analysis</h3>
        <p className="text-[10px] text-matrix-text-muted/40 mb-2">
          Clone public repos for read-only analysis. Downloaded code is never auto-executed.
        </p>
        <div className="flex gap-2 mb-3">
          <input value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
            className="matrix-input flex-1" placeholder="https://github.com/owner/repo"
            onKeyDown={e => e.key === 'Enter' && handleClone()} />
          <button onClick={handleClone} disabled={cloning || !repoUrl.trim()} className="matrix-btn text-xs">
            {cloning ? 'Cloning...' : 'Clone for Analysis'}
          </button>
        </div>

        {analysisRepos.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider">Analysis Repos</h4>
            {analysisRepos.map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 bg-matrix-bg-hover/30 rounded text-[10px]">
                <div>
                  <span className="text-matrix-green font-bold">{r.name}</span>
                  <span className="text-matrix-text-muted/30 ml-2">{r.sourceUrl}</span>
                </div>
                <div className="flex gap-1">
                  <span className="text-[8px] badge badge-planned">READ-ONLY</span>
                  <button onClick={() => handleRemoveRepo(r.localPath)} className="text-matrix-danger/50 hover:text-matrix-danger">Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared Components ───

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 70 ? 'bg-matrix-green' : pct >= 40 ? 'bg-matrix-warning' : 'bg-matrix-danger';
  return (
    <div className="flex items-center gap-1">
      <div className="w-12 h-1.5 bg-matrix-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[8px] text-matrix-text-muted/40">{pct}%</span>
    </div>
  );
}

function CapBadge({ type }: { type: CapabilityType }) {
  const icons: Record<CapabilityType, string> = {
    cli: '>_',
    powershell: 'PS',
    com: 'COM',
    plugin: 'PLG',
    'file-project': 'PRJ',
    'gui-only': 'GUI',
  };
  return (
    <span className="w-7 h-7 rounded bg-matrix-green/10 border border-matrix-green/30 flex items-center justify-center text-[8px] font-bold text-matrix-green">
      {icons[type] || '?'}
    </span>
  );
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const colors: Record<RiskLevel, string> = {
    safe: 'bg-matrix-green/10 text-matrix-green border-matrix-green/30',
    caution: 'bg-matrix-warning/10 text-matrix-warning border-matrix-warning/30',
    destructive: 'bg-matrix-danger/10 text-matrix-danger border-matrix-danger/30',
  };
  return (
    <span className={`text-[7px] px-1 py-0.5 rounded border ${colors[level]}`}>
      {level.toUpperCase()}
    </span>
  );
}

function StatusBadge({ status }: { status: AdapterStatus }) {
  const colors: Record<AdapterStatus, string> = {
    draft: 'badge-planned',
    testing: 'badge-planned',
    tested: 'badge-connected',
    approved: 'badge-connected',
    registered: 'badge-connected',
    error: 'badge-error',
  };
  return <span className={`badge ${colors[status]} text-[8px]`}>{status}</span>;
}
