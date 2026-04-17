import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Sprint 25.9: When building with --mode test, keep React in dev mode
// so runtime warnings (setState loops, render-phase setState) are preserved.
// Production builds (default mode) continue to use react.production.min.js.
const isTestMode = process.env.ELECTRON_VITE_MODE === 'test' ||
  process.argv.includes('--mode') && process.argv[process.argv.indexOf('--mode') + 1] === 'test';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // These packages are ESM-only ("type": "module") and cannot be require()'d
        // by Electron's CJS main process. We exclude them from externalization so
        // Vite/Rollup bundles them into the CJS output instead.
        exclude: [
          '@octokit/rest',
          '@octokit/app',
          '@octokit/auth-app',
          '@octokit/core',
          '@octokit/plugin-rest-endpoint-methods',
          '@octokit/plugin-paginate-rest',
          'zod',
        ],
      }),
    ],
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@domain': resolve(__dirname, 'src/main/domain')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'resources'),
    build: {
      outDir: 'dist-renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    },
    plugins: [react()],
    // Sprint 25.9: In test mode, keep React in development mode for dev warnings
    ...(isTestMode ? { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } : {}),
    css: {
      postcss: resolve(__dirname, 'postcss.config.js')
    }
  }
});
