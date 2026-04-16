import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx,html}'
  ],
  theme: {
    extend: {
      colors: {
        matrix: {
          green: 'var(--matrix-green, #00ff41)',
          'green-dim': 'var(--matrix-green-dim, #00cc33)',
          'green-dark': 'var(--matrix-green-dark, #009926)',
          'green-darker': 'var(--matrix-green-darker, #006b1a)',
          bg: 'var(--matrix-bg, #0a0a0a)',
          'bg-light': 'var(--matrix-bg-light, #0d120d)',
          'bg-card': 'var(--matrix-bg-card, #0a150a)',
          'bg-hover': 'var(--matrix-bg-hover, #0f1f0f)',
          border: 'var(--matrix-border, #003300)',
          'border-bright': 'var(--matrix-border-bright, #00ff41)',
          text: 'var(--matrix-text, #00ff41)',
          'text-dim': 'var(--matrix-text-dim, #00cc33)',
          'text-muted': 'var(--matrix-text-muted, #33cc33)',
          accent: 'var(--matrix-accent, #00ff41)',
          danger: 'var(--matrix-danger, #ff0040)',
          warning: 'var(--matrix-warning, #ccff00)',
          info: 'var(--matrix-info, #00ccff)'
        },
        surface: {
          bg: 'var(--theme-app-bg, #0a0a0a)',
          card: 'var(--theme-card-bg, #0a150a)',
          border: 'var(--theme-border, #003300)',
          hover: 'var(--theme-hover-bg, #0f1f0f)'
        }
      },
      fontFamily: {
        mono: ['"Share Tech Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        matrix: ['"Share Tech Mono"', 'monospace']
      },
      boxShadow: {
        'matrix': '0 0 10px rgba(0, 255, 65, 0.3)',
        'matrix-lg': '0 0 20px rgba(0, 255, 65, 0.4)',
        'matrix-glow': '0 0 30px rgba(0, 255, 65, 0.6), inset 0 0 20px rgba(0, 255, 65, 0.1)'
      },
      animation: {
        'matrix-glow': 'matrixGlow 2s ease-in-out infinite alternate',
        'border-glow': 'borderGlow 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'pulse-dot': 'pulseDot 1.5s ease-in-out infinite',
        'rain-drop': 'rainDrop 4s linear infinite',
        'glitch': 'glitch 0.3s ease-in-out',
        'scanline': 'scanline 8s linear infinite',
        'type-in': 'typeIn 0.5s steps(20) forwards',
        'blink': 'blink 1s step-end infinite'
      },
      keyframes: {
        matrixGlow: {
          '0%': { textShadow: '0 0 5px #00ff41, 0 0 10px #00ff41' },
          '100%': { textShadow: '0 0 10px #00ff41, 0 0 20px #00ff41, 0 0 40px #00cc33' }
        },
        borderGlow: {
          '0%, 100%': { borderColor: 'rgba(0,255,65,0.3)' },
          '50%': { borderColor: 'rgba(0,255,65,0.8)' }
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' }
        },
        rainDrop: {
          '0%': { transform: 'translateY(-100%)', opacity: '1' },
          '70%': { opacity: '0.5' },
          '100%': { transform: 'translateY(100vh)', opacity: '0' }
        },
        glitch: {
          '0%, 100%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(2px, -2px)' },
          '60%': { transform: 'translate(-1px, -1px)' },
          '80%': { transform: 'translate(1px, 1px)' }
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        },
        typeIn: {
          from: { width: '0' },
          to: { width: '100%' }
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' }
        }
      }
    }
  },
  plugins: []
};

export default config;
