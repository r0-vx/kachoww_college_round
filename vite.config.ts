import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: resolve(fileURLToPath(new URL('.', import.meta.url)), 'dashboard.html'),
        sidepanel: resolve(fileURLToPath(new URL('.', import.meta.url)), 'sidepanel.html'),
        demo: resolve(fileURLToPath(new URL('.', import.meta.url)), 'demo.html'),
        background: resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/extension/background.ts'),
        content: resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/extension/content.ts')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
