import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Discover the lazy worker dependency before a first FIT import or export can trigger a dev-server reload.
  optimizeDeps: { include: ['fit-file-parser', 'fit-file-parser/encoder'] },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});
