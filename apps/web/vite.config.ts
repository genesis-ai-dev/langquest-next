import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // The dashboard reads the same Supabase project as the phones, from the
  // mobile app's encrypted env files. Only these two names reach the bundle;
  // anything else in those files (dev logins) stays out.
  envPrefix: ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'],
  resolve: {
    alias: {
      '@langquest-next/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@langquest-next/client': fileURLToPath(new URL('../../packages/client/src/index.ts', import.meta.url))
    }
  },
  build: { outDir: 'dist', sourcemap: true }
});
