import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    // `@/` -> src. Additive: existing relative imports keep working; this just
    // enables the shadcn-style `@/components/ui/...` import convention.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the big, rarely-changing framework libs into their own chunk.
        // The main app chunk shrinks (faster first paint) and these stay cached
        // across deploys, so repeat visits skip re-downloading React/Router.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
