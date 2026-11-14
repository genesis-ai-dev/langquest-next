import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Stryker's vitest runner 10.0.0 does not work with vitest 5 unaided, for two reasons:
// 1. it adds its setup file to the project after vitest has started, which vitest 5
//    ignores, so the setup file is listed here;
// 2. it selects tests with a name regex joined by ' ', while vitest 5 matches against
//    names joined by ' > ', so every test is skipped and no mutant is ever killed.
//    stryker-names.ts makes the match see ' ' instead.
// linesVersion.test.ts hashes passage.ts as written, and the sandbox holds it instrumented,
// so it fails the initial run and with it every nightly mutation run; it holds no mutant.
// stryker.config.json leaves scripts/ out of the sandbox, all but scripts/unit-shards.ts,
// which vitest.config.ts imports, and library/ out, all but library/versifications, which
// core's versification tests read. noStoredStatus.test.ts reads supabase/, apps/ and
// packages/sync, which stay out of the sandbox; it scans files and kills no mutant.
// Used only by stryker.config.json. Drop it when the runner supports vitest 5.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      setupFiles: [`./stryker-setup-${process.env.STRYKER_MUTATOR_WORKER ?? 0}.js`, './stryker-names.ts'],
      exclude: [
        '**/node_modules/**',
        'packages/core/test/linesVersion.test.ts',
        'packages/core/test/noStoredStatus.test.ts'
      ]
    }
  })
);
