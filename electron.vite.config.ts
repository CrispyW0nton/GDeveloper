import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

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
    css: {
      postcss: resolve(__dirname, 'postcss.config.js')
    }
  }
});
