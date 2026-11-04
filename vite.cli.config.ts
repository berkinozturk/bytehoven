import { defineConfig } from 'vite';

/**
 * Builds the `bytehoven` command for npm: cli/cli.js (server + CLI) and, in a
 * second pass, cli/hook.js on its own, so `bytehoven hooks --write` can copy
 * that single file out of the npx cache.
 */
export default defineConfig(({ mode }) => ({
  publicDir: false,
  build: {
    ssr: true,
    outDir: 'cli',
    emptyOutDir: mode !== 'hook',
    target: 'node20',
    minify: false,
    rollupOptions: {
      input: mode === 'hook' ? { hook: 'bin/bytehoven-hook.ts' } : { cli: 'bin/cli.ts' },
      output: { format: 'es', entryFileNames: '[name].js' },
    },
  },
}));
