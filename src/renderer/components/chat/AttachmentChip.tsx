/**
 * AttachmentChip — Sprint 25
 *
 * Compact display of an attached file with thumbnail/icon, name, size,
 * remove button, and warning indicators.
 */

import React from 'react';
import type { AttachmentMeta } from '../../store';

interface AttachmentChipProps {
  attachment: AttachmentMeta;
  onRemove: (id: string) => void;
  onPreview: (attachment: AttachmentMeta) => void;
  compact?: boolean;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  image: '\uD83D\uDDBC\uFE0F',
  document: '\uD83D\uDCC4',
  code: '\uD83D\uDCBB',
  unknown: '\uD83D\uDCC1',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentChip({ attachment, onRemove, onPreview, compact }: AttachmentChipProps) {
  const hasWarnings = (attachment.warnings?.length ?? 0) > 0;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded border transition-all cursor-pointer group ${
        hasWarnings
          ? 'border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10'
          : 'border-matrix-border/30 bg-matrix-bg-hover/30 hover:bg-matrix-bg-hover/60'
      } ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'}`}
      onClick={() => onPreview(attachment)}
      title={hasWarnings
        ? `${attachment.originalName} — Warning: ${(attachment.warnings || [])[0] || 'Unknown warning'}`
        : `${attachment.originalName} (${formatSize(attachment.size)})`}
    >
      {/* Thumbnail or icon */}
      {attachment.type === 'image' && attachment.thumbnailUri ? (
        <img
          src={attachment.thumbnailUri}
          alt={attachment.originalName}
          className="w-5 h-5 rounded object-cover flex-shrink-0"
        />
      ) : (
        <span className="text-xs flex-shrink-0">{FILE_TYPE_ICONS[attachment.type] || FILE_TYPE_ICONS.unknown}</span>
      )}

      {/* Filename */}
      <span className={`text-matrix-text-dim truncate max-w-[120px] ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
        {attachment.originalName}
      </span>

      {/* Size */}
      <span className="text-[8px] text-matrix-text-muted/30 flex-shrink-0">
        {formatSize(attachment.size)}
      </span>

      {/* Vision token cost */}
      {attachment.visionTokenEstimate && (
        <span className="text-[8px] text-matrix-text-muted/25 flex-shrink-0" title={`Estimated vision cost: ~${attachment.visionTokenEstimate.toLocaleString()} tokens`}>
          ~{attachment.visionTokenEstimate > 1000 ? `${(attachment.visionTokenEstimate / 1000).toFixed(1)}k` : attachment.visionTokenEstimate}t
        </span>
      )}

      {/* Warning indicator */}
      {hasWarnings && (
        <span className="text-yellow-400 text-[10px] flex-shrink-0" title={(attachment.warnings || []).join('\n')}>
          !
        </span>
      )}

      {/* EXIF stripped badge */}
      {attachment.exifStripped && (
        <span className="text-[7px] text-matrix-green/40 flex-shrink-0" title="EXIF metadata was stripped">
          EXIF
        </span>
      )}

      {/* Remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(attachment.id); }}
        className="text-matrix-text-muted/30 hover:text-red-400 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
        title="Remove attachment"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
