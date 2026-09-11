import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// GitHub Pages serves project sites from /<repo>/, so the base path must match.
// Override with BASE_PATH=/ for local static previews or a custom domain.
const base = process.env.BASE_PATH ?? '/telegram-sticker-maker/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
