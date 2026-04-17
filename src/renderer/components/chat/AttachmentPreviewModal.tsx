/**
 * AttachmentPreviewModal — Sprint 25
 *
 * Full-size preview for attached files.
 * Images: zoom, rotate, full-size display.
 * Documents: syntax-highlighted text preview.
 * Keyboard: Escape to close, arrow keys for navigation.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { AttachmentMeta } from '../../store';

interface AttachmentPreviewModalProps {
  attachment: AttachmentMeta | null;
  attachments: AttachmentMeta[];
  onClose: () => void;
  onRemove: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentPreviewModal({ attachment, attachments, onClose, onRemove }: AttachmentPreviewModalProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const modalRef = useRef<HTMLDivElement>(null);

  // Sync index when attachment changes
  useEffect(() => {
    if (attachment) {
      const idx = attachments.findIndex(a => a.id === attachment.id);
      if (idx >= 0) setCurrentIndex(idx);
    }
    setZoom(1);
    setRotation(0);
  }, [attachment?.id, attachments]);

  const currentAtt = attachments[currentIndex] || attachment;

  // Keyboard navigation
  useEffect(() => {
    if (!attachment) return;

    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setCurrentIndex(prev => Math.max(0, prev - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setCurrentIndex(prev => Math.min(attachments.length - 1, prev + 1));
          break;
        case '+':
        case '=':
          setZoom(prev => Math.min(3, prev + 0.25));
          break;
        case '-':
          setZoom(prev => Math.max(0.25, prev - 0.25));
          break;
        case 'r':
          setRotation(prev => (prev + 90) % 360);
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [attachment, attachments.length, onClose]);

  if (!attachment || !currentAtt) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col glass-panel border-matrix-border/30">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-matrix-border/20">
          <div className="flex items-center gap-2">
            <span className="text-xs text-matrix-green font-bold truncate max-w-[300px]">
              {currentAtt.originalName}
            </span>
            <span className="text-[9px] text-matrix-text-muted/30">
              {formatSize(currentAtt.size)}
              {currentAtt.width && currentAtt.height && ` \u2022 ${currentAtt.width}x${currentAtt.height}`}
              {currentAtt.downscaled && ' (downscaled)'}
              {currentAtt.exifStripped && ' \u2022 EXIF stripped'}
            </span>
            {attachments.length > 1 && (
              <span className="text-[9px] text-matrix-text-muted/20">
                {currentIndex + 1} / {attachments.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {currentAtt.type === 'image' && (
              <>
                <button onClick={() => setZoom(prev => Math.max(0.25, prev - 0.25))} className="text-[10px] px-1.5 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/50 hover:text-matrix-green" title="Zoom out (-)">-</button>
                <span className="text-[9px] text-matrix-text-muted/30 min-w-[3ch] text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(prev => Math.min(3, prev + 0.25))} className="text-[10px] px-1.5 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/50 hover:text-matrix-green" title="Zoom in (+)">+</button>
                <button onClick={() => setRotation(prev => (prev + 90) % 360)} className="text-[10px] px-1.5 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/50 hover:text-matrix-green" title="Rotate (R)">Rotate</button>
              </>
            )}
            <button
              onClick={() => { onRemove(currentAtt.id); if (attachments.length <= 1) onClose(); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/20 text-red-400/50 hover:text-red-400 hover:bg-red-500/10"
              title="Remove attachment"
            >
              Remove
            </button>
            <button onClick={onClose} className="text-matrix-text-muted/40 hover:text-matrix-green ml-1" title="Close (Esc)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Warnings */}
        {(currentAtt.warnings?.length ?? 0) > 0 && (
          <div className="px-4 py-1.5 bg-yellow-500/5 border-b border-yellow-500/10">
            {(currentAtt.warnings || []).map((w, i) => (
              <p key={i} className="text-[10px] text-yellow-400/80 flex items-center gap-1">
                <span>!</span> {w}
              </p>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 min-h-[200px] max-h-[70vh]">
          {currentAtt.type === 'image' && currentAtt.dataUri ? (
            <div className="flex items-center justify-center min-h-full">
              <img
                src={currentAtt.dataUri}
                alt={currentAtt.originalName}
                className="transition-transform duration-200"
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  maxWidth: zoom <= 1 ? '100%' : 'none',
                  maxHeight: zoom <= 1 ? '60vh' : 'none',
                }}
              />
            </div>
          ) : currentAtt.extractedText ? (
            <div className="font-mono text-[11px] text-matrix-text-dim whitespace-pre-wrap leading-relaxed bg-matrix-bg/50 rounded p-3 max-h-[60vh] overflow-y-auto">
              {currentAtt.extractedText.substring(0, 10000)}
              {currentAtt.extractedText.length > 10000 && (
                <p className="text-matrix-text-muted/30 mt-2">
                  ... [{(currentAtt.extractedText.length - 10000).toLocaleString()} more characters]
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center text-matrix-text-muted/30 text-sm min-h-[200px]">
              No preview available for this file type
            </div>
          )}
        </div>

        {/* Navigation arrows for multiple attachments */}
        {attachments.length > 1 && (
          <>
            {currentIndex > 0 && (
              <button
                onClick={() => setCurrentIndex(prev => prev - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-matrix-bg/80 border border-matrix-border/20 flex items-center justify-center text-matrix-text-muted/50 hover:text-matrix-green"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            )}
            {currentIndex < attachments.length - 1 && (
              <button
                onClick={() => setCurrentIndex(prev => prev + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-matrix-bg/80 border border-matrix-border/20 flex items-center justify-center text-matrix-text-muted/50 hover:text-matrix-green"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
