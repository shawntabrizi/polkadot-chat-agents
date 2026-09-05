import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `npm run dev` proxies /api to a running daemon (`pcs up`); the built app is
// served by the daemon itself at `/`, so paths stay relative.
const daemon = process.env.PCS_URL ?? 'http://127.0.0.1:7788';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: { '/api': { target: daemon, changeOrigin: false } },
    // lib/markdown.mjs is shared with the daemon and lives one level up.
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
