import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'charts', test: /node_modules[\/](recharts|d3-|victory-vendor|decimal\.js|es-toolkit|@reduxjs|immer|reselect|react-redux)/ },
            { name: 'react', test: /node_modules[\/](react|react-dom|react-router|scheduler)[\/]/ },
          ],
        },
      },
    },
  },
});
