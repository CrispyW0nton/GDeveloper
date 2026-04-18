/**
 * DropZoneOverlay — Sprint 25
 *
 * Full-area drop zone overlay that appears when files are dragged over the chat.
 * Supports up to 10 files/message with type/size validation.
 */

import React from 'react';

interface DropZoneOverlayProps {
  active: boolean;
}

export default function DropZoneOverlay({ active }: DropZoneOverlayProps) {
  if (!active) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-matrix-green/5 border-2 border-dashed border-matrix-green/40 rounded-lg animate-pulse" />
      <div className="relative z-10 text-center">
        <div className="text-3xl mb-2 animate-bounce" style={{ animationDuration: '1.5s' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-matrix-green/70">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <p className="text-sm text-matrix-green/80 font-bold">Drop files here</p>
        <p className="text-[10px] text-matrix-text-muted/40 mt-1">
          Images, documents, code files (max 10 files, 50 MB total)
        </p>
      </div>
    </div>
  );
}
