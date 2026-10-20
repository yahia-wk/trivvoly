import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development, Vite serves the app and forwards /api (including WebSockets) to the Python server.
// In production, the Python server serves the built app from dist/ itself.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', ws: true } },
    fs: { allow: ['..'] } // shared/flags.json lives next to the backend
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false }
});
