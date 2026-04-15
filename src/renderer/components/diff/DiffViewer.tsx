import React, { useState } from 'react';
import { SelectedRepo } from '../../store';

interface DiffViewerProps {
  repo: SelectedRepo;
}

interface DiffFile {
  path: string;
  status: 'modified' | 'created' | 'deleted';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'del' | 'context';
  lineNumber: number;
  content: string;
}

interface VerificationSummary {
  checkType: string;
  passed: boolean;
  detail: string;
}

const DEMO_DIFFS: DiffFile[] = [
  {
    path: 'src/auth/login.ts',
    status: 'modified',
    additions: 24,
    deletions: 3,
    hunks: [
      {
        header: '@@ -1,8 +1,28 @@',
        lines: [
          { type: 'context', lineNumber: 1, content: "import { Request, Response } from 'express';" },
          { type: 'del', lineNumber: 2, content: "// TODO: implement JWT authentication" },
          { type: 'add', lineNumber: 2, content: "import jwt from 'jsonwebtoken';" },
          { type: 'add', lineNumber: 3, content: "import bcrypt from 'bcrypt';" },
          { type: 'add', lineNumber: 4, content: "import { UserRepository } from '../db/repositories';" },
          { type: 'add', lineNumber: 5, content: "" },
          { type: 'context', lineNumber: 6, content: "export async function login(email: string, password: string) {" },
          { type: 'del', lineNumber: 7, content: "  return { token: 'demo-token', user: { email } };" },
          { type: 'add', lineNumber: 7, content: "  const user = await UserRepository.findByEmail(email);" },
          { type: 'add', lineNumber: 8, content: "  if (!user) throw new Error('User not found');" },
          { type: 'add', lineNumber: 9, content: "" },
          { type: 'add', lineNumber: 10, content: "  const valid = await bcrypt.compare(password, user.passwordHash);" },
          { type: 'add', lineNumber: 11, content: "  if (!valid) throw new Error('Invalid password');" },
          { type: 'add', lineNumber: 12, content: "" },
          { type: 'add', lineNumber: 13, content: "  const token = jwt.sign(" },
          { type: 'add', lineNumber: 14, content: "    { userId: user.id, email: user.email }," },
          { type: 'add', lineNumber: 15, content: "    process.env.JWT_SECRET!," },
          { type: 'add', lineNumber: 16, content: "    { expiresIn: '24h' }" },
          { type: 'add', lineNumber: 17, content: "  );" },
          { type: 'add', lineNumber: 18, content: "" },
          { type: 'add', lineNumber: 19, content: "  return { token, user: { id: user.id, email: user.email } };" },
          { type: 'context', lineNumber: 20, content: "}" },
        ]
      }
    ]
  },
  {
    path: 'src/auth/register.ts',
    status: 'created',
    additions: 18,
    deletions: 0,
    hunks: [
      {
        header: '@@ -0,0 +1,18 @@',
        lines: [
          { type: 'add', lineNumber: 1, content: "import bcrypt from 'bcrypt';" },
          { type: 'add', lineNumber: 2, content: "import { v4 as uuid } from 'uuid';" },
          { type: 'add', lineNumber: 3, content: "import { UserRepository } from '../db/repositories';" },
          { type: 'add', lineNumber: 4, content: "" },
          { type: 'add', lineNumber: 5, content: "export async function register(email: string, password: string) {" },
          { type: 'add', lineNumber: 6, content: "  const existing = await UserRepository.findByEmail(email);" },
          { type: 'add', lineNumber: 7, content: "  if (existing) throw new Error('Email already registered');" },
          { type: 'add', lineNumber: 8, content: "" },
          { type: 'add', lineNumber: 9, content: "  const passwordHash = await bcrypt.hash(password, 12);" },
          { type: 'add', lineNumber: 10, content: "  const user = await UserRepository.create({" },
          { type: 'add', lineNumber: 11, content: "    id: uuid()," },
          { type: 'add', lineNumber: 12, content: "    email," },
          { type: 'add', lineNumber: 13, content: "    passwordHash," },
          { type: 'add', lineNumber: 14, content: "    createdAt: new Date().toISOString()" },
          { type: 'add', lineNumber: 15, content: "  });" },
          { type: 'add', lineNumber: 16, content: "" },
          { type: 'add', lineNumber: 17, content: "  return { success: true, user: { id: user.id, email } };" },
          { type: 'add', lineNumber: 18, content: "}" },
        ]
      }
    ]
  }
];

const DEMO_VERIFICATION: VerificationSummary[] = [
  { checkType: 'Unit Tests', passed: true, detail: '12 passed, 0 failed' },
  { checkType: 'ESLint', passed: true, detail: '0 errors, 2 warnings' },
  { checkType: 'TypeScript', passed: true, detail: 'No errors' },
  { checkType: 'Build', passed: true, detail: 'Succeeded in 4.2s' }
];

export default function DiffViewer({ repo }: DiffViewerProps) {
  const [diffs] = useState<DiffFile[]>(DEMO_DIFFS);
  const [selectedFile, setSelectedFile] = useState<string>(DEMO_DIFFS[0]?.path || '');
  const [showVerification, setShowVerification] = useState(true);

  const selectedDiff = diffs.find(d => d.path === selectedFile);
  const allPassed = DEMO_VERIFICATION.every(v => v.passed);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between">
        <h2 className="text-sm font-bold text-matrix-green glow-text-dim flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18M3 12h18"/></svg>
          Diff View & Verification
        </h2>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowVerification(!showVerification)} className="matrix-btn text-[10px]">
            {showVerification ? 'Hide Checks' : 'Show Checks'}
          </button>
          <span className={`badge ${allPassed ? 'badge-done' : 'badge-blocked'}`}>
            {allPassed ? 'All Checks Passed' : 'Checks Failed'}
          </span>
        </div>
      </div>

      {/* Verification Summary */}
      {showVerification && (
        <div className="px-4 py-2 border-b border-matrix-border bg-matrix-bg-card/50 flex items-center gap-4">
          {DEMO_VERIFICATION.map((v, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className={`w-3 h-3 rounded-full flex items-center justify-center ${v.passed ? 'bg-matrix-green/20 text-matrix-green' : 'bg-matrix-danger/20 text-matrix-danger'}`}>
                {v.passed ? (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                )}
              </span>
              <span className={v.passed ? 'text-matrix-green/80' : 'text-matrix-danger/80'}>{v.checkType}</span>
              <span className="text-matrix-text-muted/30">{v.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* File List */}
        <div className="w-64 border-r border-matrix-border overflow-y-auto">
          <div className="p-2 text-[10px] text-matrix-text-muted/40 uppercase tracking-wider">
            Changed Files ({diffs.length})
          </div>
          {diffs.map(diff => (
            <button
              key={diff.path}
              onClick={() => setSelectedFile(diff.path)}
              className={`w-full px-3 py-2 text-left text-xs transition-all border-b border-matrix-border/20 ${
                selectedFile === diff.path ? 'bg-matrix-green/5 border-l-2 border-l-matrix-green' : 'hover:bg-matrix-bg-hover'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-matrix-text-dim truncate">{diff.path}</span>
                <span className={`badge text-[8px] ${
                  diff.status === 'modified' ? 'badge-planned' : diff.status === 'created' ? 'badge-done' : 'badge-blocked'
                }`}>{diff.status}</span>
              </div>
              <div className="flex gap-2 text-[10px] text-matrix-text-muted/30 mt-0.5">
                <span className="text-matrix-green">+{diff.additions}</span>
                <span className="text-matrix-danger">-{diff.deletions}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Diff Content */}
        <div className="flex-1 overflow-auto font-mono text-xs">
          {selectedDiff ? (
            <div className="p-1">
              {selectedDiff.hunks.map((hunk, hi) => (
                <div key={hi}>
                  <div className="px-3 py-1 text-matrix-info/50 bg-matrix-info/5 text-[10px]">{hunk.header}</div>
                  {hunk.lines.map((line, li) => (
                    <div key={li} className={`px-3 py-0.5 flex ${
                      line.type === 'add' ? 'diff-add' : line.type === 'del' ? 'diff-del' : 'diff-context'
                    }`}>
                      <span className="w-8 text-right mr-3 text-matrix-text-muted/20 select-none">{line.lineNumber}</span>
                      <span className="flex-1">{line.content}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-matrix-text-muted/30 text-xs">
              Select a file to view diff
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
