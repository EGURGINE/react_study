import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/react_study/' : '/',
  server: { proxy: { '/socket': { target: 'ws://127.0.0.1:3001', ws: true, rewrite: () => '/ws' } } },
  build: { chunkSizeWarningLimit: 800 }
});
