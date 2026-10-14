import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@langquest-next/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url))
    }
  },
  test: {
    globals: true,
    // Some suites are CPU-bound (the catalog scan, the library build, the fleet): a second or two alone, past
    // vitest's 5 s default on a busy CI runner or a Mac running other builds, where they failed as timeouts
    // (2026-10-14). A test that truly hangs still fails, after 30 s.
    testTimeout: 30_000,
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'scripts/**/*.test.ts', 'e2e/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'packages/core/src/**',
        'packages/client/src/**',
        'apps/mobile/src/**',
        'apps/web/worker/**',
        'scripts/**'
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/generated/**',
        '**/*.generated.*',
        'apps/mobile/src/flow.ts',
        'scripts/**/*.{sh,mjs}',
        'scripts/fleet/**',
        'scripts/bench/**'
      ],
      thresholds: {
        'packages/core/src/**': { lines: 93, branches: 79, functions: 90, statements: 88 },
        'packages/client/src/**': { lines: 88, branches: 77, functions: 85, statements: 86 }
      }
    }
  }
});
