import React, { useRef, useEffect, useCallback } from 'react';

interface MatrixRainCanvasProps {
  /** Opacity of the rain layer (0..1). Default 0.12 */
  opacity?: number;
  /** Font size in pixels. Default 14 */
  fontSize?: number;
  /** Character color (CSS). Default '#00ff41' */
  color?: string;
  /** Target interval between frames in ms (~22 fps). Default 45 */
  speed?: number;
}

// Characters used for the rain effect (katakana + latin + digits + symbols)
const CHARS =
  '\u30A0\u30A1\u30A2\u30A3\u30A4\u30A5\u30A6\u30A7\u30A8\u30A9' +
  '\u30AA\u30AB\u30AC\u30AD\u30AE\u30AF\u30B0\u30B1\u30B2\u30B3' +
  '\u30B4\u30B5\u30B6\u30B7\u30B8\u30B9\u30BA\u30BB\u30BC\u30BD' +
  '\u30BE\u30BF\u30C0\u30C1\u30C2\u30C3\u30C4\u30C5\u30C6\u30C7' +
  '\u30C8\u30C9\u30CA\u30CB\u30CC\u30CD\u30CE\u30CF\u30D0\u30D1' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*';

/**
 * Full-screen canvas-based Matrix rain background.
 *
 * Renders falling characters at ~22 fps using requestAnimationFrame
 * with time-based throttling. Canvas sits at z-index: 0 with
 * pointer-events: none so the UI above it stays fully interactive.
 */
export default function MatrixRainCanvas({
  opacity = 0.12,
  fontSize = 14,
  color = '#00ff41',
  speed = 45,
}: MatrixRainCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dropsRef = useRef<number[]>([]);
  const lastFrameRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  // Initialise / resize column drops
  const initDrops = useCallback(
    (cols: number) => {
      const next: number[] = [];
      for (let i = 0; i < cols; i++) {
        // Reuse existing positions where possible so resize doesn't flash
        next.push(dropsRef.current[i] ?? Math.floor(Math.random() * -40));
      }
      dropsRef.current = next;
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- Resize handler -----------------------------------------------
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.ceil(w / fontSize);
      initDrops(cols);
    };
    resize();
    window.addEventListener('resize', resize);

    // --- Draw loop (throttled by `speed`) -----------------------------
    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw);
      if (now - lastFrameRef.current < speed) return;
      lastFrameRef.current = now;

      const w = window.innerWidth;
      const h = window.innerHeight;

      // Fade trail
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, w, h);

      ctx.font = `${fontSize}px "Share Tech Mono", "Fira Code", monospace`;
      ctx.fillStyle = color;

      const drops = dropsRef.current;
      for (let i = 0; i < drops.length; i++) {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        if (y > 0) {
          ctx.fillText(char, x, y);
        }

        // Reset when off-screen (with some randomness to stagger)
        if (y > h && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    rafRef.current = requestAnimationFrame(draw);

    // --- Cleanup on unmount -------------------------------------------
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [fontSize, color, speed, initDrops]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
        opacity,
      }}
    />
  );
}
