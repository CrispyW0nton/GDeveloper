import React, { useEffect, useMemo, useState } from 'react';

const api = (window as any).electronAPI;

interface SpecTask {
  id: string;
  title: string;
  status: string;
}

interface SpecRecord {
  id: string;
  title: string;
  summary: string;
  status: string;
  relativePath: string;
  acceptanceCriteria: string[];
  tasks: SpecTask[];
  updatedAt: string;
}

interface SpecsPanelProps {
  sessionId?: string;
}

const DEFAULT_SPEC = [
  '# Feature Name',
  '',
  'One paragraph describing the user-visible outcome.',
  '',
  '## Acceptance Criteria',
  '',
  '- The main success path is observable',
  '- The failure path has a clear recovery',
  '',
  '## Tasks',
  '',
  '- Define the data contract',
  '- Build the smallest end-to-end slice',
  '- Add focused verification',
].join('\n');

export default function SpecsPanel({ sessionId = 'system' }: SpecsPanelProps) {
  const [specs, setSpecs] = useState<SpecRecord[]>([]);
  const [activeSpec, setActiveSpec] = useState<SpecRecord | null>(null);
  const [draft, setDraft] = useState(DEFAULT_SPEC);
  const [runPrompt, setRunPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedSpec = useMemo(() => activeSpec || specs[0] || null, [activeSpec, specs]);

  const loadSpecs = async () => {
    if (!api?.listSpecs) { setLoading(false); return; }
    setError('');
    try {
      const [list, active] = await Promise.all([
        api.listSpecs(),
        api.getActiveSpec ? api.getActiveSpec() : Promise.resolve(null),
      ]);
      setSpecs(Array.isArray(list) ? list : []);
      setActiveSpec(active || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load specs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSpecs();
  }, []);

  const handleCreate = async () => {
    if (!api?.createSpec || !draft.trim()) return;
    setError('');
    const result = await api.createSpec(draft, sessionId);
    if (result?.success) {
      setActiveSpec(result.spec);
      setDraft(DEFAULT_SPEC);
      await loadSpecs();
    } else {
      setError(result?.error || 'Failed to create spec');
    }
  };

  const handleActivate = async (specId: string) => {
    if (!api?.setActiveSpec) return;
    const result = await api.setActiveSpec(specId);
    if (result?.success) {
      setActiveSpec(result.spec);
      await loadSpecs();
    } else {
      setError(result?.error || 'Failed to activate spec');
    }
  };

  const handleRunPrompt = async () => {
    if (!api?.getSpecRunPrompt) return;
    const result = await api.getSpecRunPrompt();
    if (result?.success) {
      setRunPrompt(result.prompt || '');
    } else {
      setError(result?.error || 'No active spec');
    }
  };

  return (
    <div className="h-full flex bg-matrix-bg/40">
      <div className="w-80 border-r border-matrix-border flex flex-col">
        <div className="px-4 py-3 border-b border-matrix-border">
          <h2 className="text-sm font-bold text-matrix-green glow-text-dim flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
            Specs
          </h2>
          <p className="text-[9px] text-matrix-text-muted/30 mt-0.5">
            {specs.length > 0 ? `${specs.length} spec(s) available` : 'No specs created yet'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center">
              <span className="w-4 h-4 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin inline-block" />
              <p className="text-[10px] text-matrix-text-muted/40 mt-2">Loading specs...</p>
            </div>
          ) : specs.length === 0 ? (
            <div className="p-6 text-center text-[10px] text-matrix-text-muted/35">
              Create a spec to pin acceptance criteria and task order into the agent prompt.
            </div>
          ) : specs.map(spec => (
            <button
              key={spec.id}
              onClick={() => handleActivate(spec.id)}
              className={`w-full px-4 py-3 text-left border-b border-matrix-border/30 transition-all ${
                activeSpec?.id === spec.id ? 'bg-matrix-green/5 border-l-2 border-l-matrix-green' : 'hover:bg-matrix-bg-hover'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-matrix-green font-bold truncate">{spec.title}</span>
                <span className="text-[8px] px-1.5 py-0.5 rounded border border-matrix-border/40 text-matrix-text-muted/50">{spec.status}</span>
              </div>
              <p className="text-[10px] text-matrix-text-muted/40 truncate mt-1">{spec.relativePath}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-5 border-b border-matrix-border">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-matrix-green truncate">{selectedSpec?.title || 'Create Spec'}</h3>
              <p className="text-[10px] text-matrix-text-muted/40 truncate">{selectedSpec?.relativePath || 'Specs are saved under .gd/specs'}</p>
            </div>
            <button
              onClick={handleRunPrompt}
              disabled={!activeSpec}
              className="px-3 py-1.5 text-xs rounded border border-matrix-green/30 text-matrix-green hover:bg-matrix-green/10 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Prepare the active spec run prompt"
            >
              Run Spec
            </button>
          </div>
          {error && <div className="mt-3 text-[10px] text-matrix-danger">{error}</div>}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-0 min-h-[calc(100%-72px)]">
          <div className="p-5 border-r border-matrix-border/40">
            <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-3">New Spec</h4>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-full min-h-[360px] bg-matrix-bg-elevated border border-matrix-border rounded p-3 text-xs text-matrix-text font-mono resize-y focus:outline-none focus:border-matrix-green/50"
              spellCheck={false}
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={handleCreate}
                className="px-3 py-1.5 text-xs rounded border border-matrix-green/30 text-matrix-green hover:bg-matrix-green/10"
              >
                Create Spec
              </button>
            </div>
          </div>

          <div className="p-5 space-y-5">
            <section>
              <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-2">Acceptance Criteria</h4>
              <div className="space-y-1.5">
                {(selectedSpec?.acceptanceCriteria || []).map((item, index) => (
                  <div key={index} className="text-xs text-matrix-text-dim flex gap-2">
                    <span className="text-matrix-green">-</span>
                    <span>{item}</span>
                  </div>
                ))}
                {!selectedSpec?.acceptanceCriteria?.length && <p className="text-xs text-matrix-text-muted/35">No active acceptance criteria.</p>}
              </div>
            </section>

            <section>
              <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-2">Task Tree</h4>
              <div className="space-y-2">
                {(selectedSpec?.tasks || []).map(task => (
                  <div key={task.id} className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full ${task.status === 'in_progress' ? 'bg-matrix-green' : 'bg-matrix-border'}`} />
                    <span className="text-matrix-text-dim">{task.title}</span>
                  </div>
                ))}
                {!selectedSpec?.tasks?.length && <p className="text-xs text-matrix-text-muted/35">No task tree yet.</p>}
              </div>
            </section>

            {runPrompt && (
              <section>
                <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-2">Run Prompt</h4>
                <pre className="text-[10px] whitespace-pre-wrap bg-matrix-bg-elevated border border-matrix-border rounded p-3 text-matrix-text-muted/70 max-h-64 overflow-y-auto">{runPrompt}</pre>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
