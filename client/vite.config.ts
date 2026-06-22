import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4873',
        changeOrigin: true,
      },
      '/npm': {
        target: 'http://localhost:4873',
        changeOrigin: true,
      },
      '/pypi': {
        target: 'http://localhost:4873',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
