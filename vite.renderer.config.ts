/**
 * Vite config for web preview mode (non-Electron).
 * Allows running the React UI in a browser for development and demo.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@main': resolve(__dirname, 'src/main'),
      '@domain': resolve(__dirname, 'src/main/domain')
    }
  },
  server: {
    port: 3000,
    host: '0.0.0.0'
  },
  build: {
    outDir: resolve(__dirname, 'dist-renderer'),
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html')
    }
  },
  publicDir: resolve(__dirname, 'resources'),
  css: {
    postcss: resolve(__dirname, 'postcss.config.js')
  }
});
