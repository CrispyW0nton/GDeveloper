/**
 * BottomPanel — Sprint 12
 * VS Code-style resizable bottom panel for terminal.
 * Stays visible across tab switches.
 * Resizable by dragging top edge; min ~100px, max ~70% of window.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';

interface BottomPanelProps {
  open: boolean;
  height: number;
  onHeightChange: (h: number) => void;
  onClose: () => void;
  children: React.ReactNode;
}

export default function BottomPanel({ open, height, onHeightChange, onClose, children }: BottomPanelProps) {
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    startY.current = e.clientY;
    startHeight.current = height;
  }, [height]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY.current - e.clientY;
      const newHeight = startHeight.current + delta;
      const clamped = Math.max(100, Math.min(newHeight, window.innerHeight * 0.7));
      onHeightChange(clamped);
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, onHeightChange]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="border-t border-matrix-green/20 bg-matrix-bg flex flex-col"
      style={{ height: `${height}px`, minHeight: '100px' }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`h-1 cursor-ns-resize flex-shrink-0 transition-colors ${
          dragging ? 'bg-matrix-green/40' : 'bg-matrix-green/10 hover:bg-matrix-green/30'
        }`}
      />
      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
