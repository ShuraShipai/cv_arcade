import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The app lives in app/ so the teammates' ScreamLeap files at the repo root stay untouched.
// .env files are read from the repo root.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  return {
    root: 'app',
    envDir: repoRoot,
    resolve: {
      // TensorFlow speech-commands imports Node's `util.promisify` for a file:// branch we
      // never take. The npm `util` polyfill reads `process.env` as it loads and throws
      // "process is not defined" in the browser, so point the import at a local shim.
      alias: [{ find: /^util$/, replacement: resolve(repoRoot, 'app/src/lib/node-util-shim.ts') }],
    },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      // three.js is one ~680 kB chunk, loaded lazily only where it's used.
      chunkSizeWarningLimit: 800,
    },
    // API_PROXY (dev only) forwards /api/* to the RAG backend so the browser sees one origin.
    server: env.API_PROXY ? { proxy: { '/api': { target: env.API_PROXY, changeOrigin: true } } } : {},
  };
});
