/**
 * Backdrop Renderer — Sprint 16 Addendum
 *
 * Renders the selected backdrop type behind the entire app.
 * Supports: matrix-rain, puddles, animated-gradient, static-noise, none.
 * Each backdrop respects opacity, intensity, and can be toggled on/off.
 * Graceful degradation: if canvas fails, falls back to none.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { BackdropType } from '../../themes/tokens';

interface BackdropRendererProps {
  type: BackdropType;
  opacity: number;       // 0..1
  intensity: number;     // 0..1
  enabled: boolean;
  /** Override color for the rain/gradient effect */
  accentColor?: string;
}

export default function BackdropRenderer({ type, opacity, intensity, enabled, accentColor }: BackdropRendererProps) {
  if (!enabled || type === 'none' || opacity <= 0) return null;

  switch (type) {
    case 'matrix-rain':
      return <MatrixRainBackdrop opacity={opacity} intensity={intensity} color={accentColor || '#00ff41'} />;
    case 'puddles':
      return <PuddlesBackdrop opacity={opacity} intensity={intensity} color={accentColor || '#00ff41'} />;
    case 'animated-gradient':
      return <AnimatedGradientBackdrop opacity={opacity} intensity={intensity} color={accentColor} />;
    case 'static-noise':
      return <StaticNoiseBackdrop opacity={opacity} intensity={intensity} />;
    default:
      return null;
  }
}

// ─── Matrix Rain Backdrop ───
// Refactored from MatrixRainCanvas to support the backdrop system

const CHARS =
  '\u30A0\u30A1\u30A2\u30A3\u30A4\u30A5\u30A6\u30A7\u30A8\u30A9' +
  '\u30AA\u30AB\u30AC\u30AD\u30AE\u30AF\u30B0\u30B1\u30B2\u30B3' +
  '\u30B4\u30B5\u30B6\u30B7\u30B8\u30B9\u30BA\u30BB\u30BC\u30BD' +
  '\u30BE\u30BF\u30C0\u30C1\u30C2\u30C3\u30C4\u30C5\u30C6\u30C7' +
  '\u30C8\u30C9\u30CA\u30CB\u30CC\u30CD\u30CE\u30CF\u30D0\u30D1' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*';

function MatrixRainBackdrop({ opacity, intensity, color }: { opacity: number; intensity: number; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dropsRef = useRef<number[]>([]);
  const lastFrameRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const fontSize = 14;
  const speed = Math.max(20, 60 - intensity * 40); // Higher intensity = faster

  const initDrops = useCallback((cols: number) => {
    const next: number[] = [];
    for (let i = 0; i < cols; i++) {
      next.push(dropsRef.current[i] ?? Math.floor(Math.random() * -40));
    }
    dropsRef.current = next;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initDrops(Math.ceil(w / fontSize));
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw);
      if (now - lastFrameRef.current < speed) return;
      lastFrameRef.current = now;

      const w = window.innerWidth;
      const h = window.innerHeight;

      ctx.fillStyle = 'rgba(0, 4, 1, 0.04)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${fontSize}px "Share Tech Mono", "Fira Code", monospace`;

      const drops = dropsRef.current;
      for (let i = 0; i < drops.length; i++) {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        if (y > 0) {
          if (drops[i] < 3) {
            ctx.shadowBlur = 18;
            ctx.shadowColor = '#ffffff';
            ctx.fillStyle = '#ffffff';
          } else if (Math.random() > 0.95) {
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#88ffaa';
            ctx.fillStyle = '#aaffcc';
          } else {
            ctx.shadowBlur = 6;
            ctx.shadowColor = color;
            ctx.fillStyle = color;
          }
          ctx.fillText(char, x, y);
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';
        }

        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    };

    rafRef.current = requestAnimationFrame(draw);
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
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        zIndex: 0, pointerEvents: 'none', opacity,
        filter: 'brightness(1.3) contrast(1.1)',
      }}
    />
  );
}

// ─── Puddles Backdrop ───

function PuddlesBackdrop({ opacity, intensity, color }: { opacity: number; intensity: number; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const ripples: { x: number; y: number; r: number; maxR: number; alpha: number }[] = [];
    let lastSpawn = 0;

    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Spawn ripples based on intensity
      const spawnRate = 200 - intensity * 150;
      if (now - lastSpawn > spawnRate && ripples.length < 20) {
        ripples.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0,
          maxR: 40 + Math.random() * 80,
          alpha: 0.4 + Math.random() * 0.3,
        });
        lastSpawn = now;
      }

      // Draw and update ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rip = ripples[i];
        rip.r += 0.5 + intensity * 0.5;
        rip.alpha -= 0.003;

        if (rip.alpha <= 0 || rip.r > rip.maxR) {
          ripples.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
        ctx.strokeStyle = color.replace(')', `, ${rip.alpha})`).replace('rgb(', 'rgba(');
        if (!ctx.strokeStyle.includes('rgba')) {
          ctx.strokeStyle = `${color}${Math.round(rip.alpha * 255).toString(16).padStart(2, '0')}`;
        }
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Inner ring
        if (rip.r > 10) {
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, rip.r * 0.6, 0, Math.PI * 2);
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [intensity, color]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        zIndex: 0, pointerEvents: 'none', opacity,
      }}
    />
  );
}

// ─── Animated Gradient Backdrop ───

function AnimatedGradientBackdrop({ opacity, intensity, color }: { opacity: number; intensity: number; color?: string }) {
  const [phase, setPhase] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const speed = 0.001 + intensity * 0.002;
    let start: number | null = null;

    const animate = (ts: number) => {
      if (!start) start = ts;
      setPhase(((ts - start) * speed) % (Math.PI * 2));
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [intensity]);

  const c1 = color || '#00ff41';
  const hueShift1 = Math.sin(phase) * 30;
  const hueShift2 = Math.cos(phase) * 30;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        zIndex: 0, pointerEvents: 'none', opacity: opacity * 0.5,
        background: `linear-gradient(${135 + hueShift1}deg, ${c1}10 0%, transparent 40%, ${c1}08 70%, transparent 100%)`,
        transition: 'background 0.5s ease',
        filter: `hue-rotate(${hueShift2}deg)`,
      }}
    />
  );
}

// ─── Static Noise Backdrop ───

function StaticNoiseBackdrop({ opacity, intensity }: { opacity: number; intensity: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use a small canvas and stretch it for performance
    const size = 256;
    canvas.width = size;
    canvas.height = size;

    let lastFrame = 0;
    const frameInterval = 100 - intensity * 70; // Higher intensity = faster noise

    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw);
      if (now - lastFrame < frameInterval) return;
      lastFrame = now;

      const imageData = ctx.createImageData(size, size);
      const data = imageData.data;
      const noiseLevel = 20 + intensity * 40;

      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * noiseLevel;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }

      ctx.putImageData(imageData, 0, 0);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        zIndex: 0, pointerEvents: 'none', opacity: opacity * 0.3,
        imageRendering: 'pixelated',
      }}
    />
  );
}
