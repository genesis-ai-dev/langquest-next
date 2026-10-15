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
        'packages/sync/src/**',
        'packages/v2-import/src/**',
        'apps/mobile/src/**',
        'apps/web/worker/**',
        'scripts/**'
      ],
      exclude: [
        // Folders' READMEs (apps/mobile/src/server/README.md): not code, and parsing them prints a stack.
        '**/*.md',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/tsconfig.json',
        '**/generated/**',
        '**/*.generated.*',
        'apps/mobile/src/shell/flow.ts',
        'scripts/**/*.{sh,mjs}',
        'scripts/fleet/**',
        'scripts/bench/**'
      ],
      thresholds: {
        'packages/core/src/**': { lines: 95, branches: 83, functions: 92, statements: 90 },
        'packages/sync/src/**': { lines: 95, branches: 85, functions: 91, statements: 92 },
        'packages/v2-import/src/**': { lines: 48, branches: 42, functions: 45, statements: 46 },
        // Screen models (docs/testing.md layer 3): pure, so they stay covered. model.ts and <thing>Model.ts under apps/mobile/src.
        'apps/mobile/src/**/{model,*Model}.ts': { lines: 88, branches: 79, functions: 87, statements: 86 }
      }
    }
  }
});
