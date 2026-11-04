import { defineConfig } from 'vite';
import { live } from './server/live/plugin.ts';

// Bytehoven only ever listens on the loopback interface.
export default defineConfig({
  plugins: [live()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
