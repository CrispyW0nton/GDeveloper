/**
 * Compare Module — Sprint 27
 * Public API for the deterministic compare engine.
 */

export * from './types';
export {
  compareFiles,
  merge3Way,
  compareFolders,
  syncPreview,
  applyHunkAction,
  getHunkDetail,
  getFolderEntryDiff,
  getCompactOutput,
  getSession,
  listSessions,
  deleteSession,
  saveMergeResult,
} from './engine';
