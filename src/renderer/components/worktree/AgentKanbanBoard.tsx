import React from 'react';

export interface AgentBoardCard {
  id: string;
  title: string;
  worktreePath: string;
  branchName: string | null;
  sessionId: string;
  lifecycle: 'temporary' | 'permanent';
  status: 'active' | 'completed' | 'abandoned';
  column: 'active' | 'completed' | 'abandoned';
  createdAt: string;
  dirty: boolean;
  missing: boolean;
  head: string | null;
}

export interface AgentBoardColumn {
  id: 'active' | 'completed' | 'abandoned';
  title: string;
  cards: AgentBoardCard[];
}

export interface AgentBoardSnapshot {
  generatedAt: string;
  columns: AgentBoardColumn[];
  totals: Record<'active' | 'completed' | 'abandoned', number>;
}

interface AgentKanbanBoardProps {
  board: AgentBoardSnapshot | null;
  onOpen: (path: string) => void;
  onComplete: (taskId: string) => void;
  onAbandon: (taskId: string) => void;
  onHandoff: (worktreePath: string) => void;
}

const COLUMN_ACCENTS: Record<AgentBoardColumn['id'], string> = {
  active: 'rgba(0,255,65,0.22)',
  completed: 'rgba(80,160,255,0.22)',
  abandoned: 'rgba(255,80,80,0.2)',
};

export default function AgentKanbanBoard({ board, onOpen, onComplete, onAbandon, onHandoff }: AgentKanbanBoardProps) {
  if (!board || board.columns.every(column => column.cards.length === 0)) {
    return (
      <div className="p-4 rounded-lg text-xs" style={{ background: 'rgba(0,255,65,0.025)', border: '1px solid var(--border, #003300)' }}>
        <div className="font-bold mb-1" style={{ color: 'var(--accent, #00ff41)' }}>Agent Board</div>
        <div className="opacity-45">No isolated agent tasks yet. Create one with Isolate Task to get a card here.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold" style={{ color: 'var(--accent, #00ff41)' }}>Agent Board</h3>
        <span className="text-[10px] opacity-35">Updated {new Date(board.generatedAt).toLocaleTimeString()}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {board.columns.map(column => (
          <div key={column.id} className="min-h-32 rounded-lg p-2" style={{ background: 'rgba(0,255,65,0.015)', border: `1px solid ${COLUMN_ACCENTS[column.id]}` }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{column.title}</span>
              <span className="text-[9px] rounded-full px-1.5 py-0.5" style={{ background: COLUMN_ACCENTS[column.id] }}>{column.cards.length}</span>
            </div>
            <div className="space-y-2">
              {column.cards.map(card => (
                <div key={card.id} className="rounded p-2 text-[10px]" style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-bold text-xs line-clamp-2" title={card.title}>{card.title}</div>
                  <div className="mt-1 truncate opacity-45 font-mono" title={card.worktreePath}>{card.worktreePath}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded border border-matrix-border/40 px-1.5 py-0.5 opacity-70">{card.branchName || 'detached'}</span>
                    <span className="rounded border border-matrix-border/40 px-1.5 py-0.5 opacity-70">{card.lifecycle}</span>
                    {card.dirty && <span className="rounded border border-yellow-400/30 px-1.5 py-0.5 text-yellow-400/70">dirty</span>}
                    {card.missing && <span className="rounded border border-red-400/30 px-1.5 py-0.5 text-red-400/70">missing</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {!card.missing && (
                      <button onClick={() => onOpen(card.worktreePath)} className="px-2 py-1 rounded opacity-70 hover:opacity-100" style={{ border: '1px solid var(--border, #003300)' }}>Open</button>
                    )}
                    {card.status === 'active' && (
                      <button onClick={() => onComplete(card.id)} className="px-2 py-1 rounded opacity-70 hover:opacity-100" style={{ border: '1px solid rgba(80,160,255,0.35)' }}>Complete</button>
                    )}
                    {card.status !== 'abandoned' && (
                      <button onClick={() => onHandoff(card.worktreePath)} className="px-2 py-1 rounded opacity-70 hover:opacity-100" style={{ border: '1px solid rgba(0,255,65,0.25)' }}>Handoff</button>
                    )}
                    {card.status === 'active' && (
                      <button onClick={() => onAbandon(card.id)} className="px-2 py-1 rounded text-red-400/70 opacity-70 hover:opacity-100" style={{ border: '1px solid rgba(255,80,80,0.25)' }}>Abandon</button>
                    )}
                  </div>
                </div>
              ))}
              {column.cards.length === 0 && (
                <div className="py-5 text-center text-[10px] opacity-25">No cards</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
