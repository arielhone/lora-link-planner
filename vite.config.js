import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Relative base so the same build works at https://<user>.github.io/lora-link-planner/
// and when opened from any other sub-path.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        field: resolve(import.meta.dirname, 'field.html'),
      },
    },
  },
});
