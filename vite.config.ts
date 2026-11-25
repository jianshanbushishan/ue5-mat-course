import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          if (id.includes('modules01_02') || id.includes('modules03_04')) return 'lessons-part1';
          if (id.includes('modules05_06') || id.includes('modules07_08')) return 'lessons-part2';
          if (id.includes('module09Perf')) return 'lessons-perf';
          if (id.includes('module09') || id.includes('module10')) return 'lessons-part3';
        },
      },
    },
  },
});
