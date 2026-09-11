import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// GitHub Pages serves project sites from /<repo>/, so the base path must match.
// Override with BASE_PATH=/ for local static previews or a custom domain.
const base = process.env.BASE_PATH ?? '/telegram-sticker-maker/';

// The browser suite drives the encoding core through a separate entry point.
// It is emitted only when explicitly asked for, so the deployed site never
// carries a page that exposes internals.
const includeTestHarness = process.env.INCLUDE_TEST_HARNESS === '1';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        ...(includeTestHarness
          ? { harness: fileURLToPath(new URL('./harness.html', import.meta.url)) }
          : {}),
      },
    },
  },
});
