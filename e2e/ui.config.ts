import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVoice } from './fixtures/voice';

// The UI test suite on the web (docs/ui-test-suite, decisions.md 95, 102): by
// default the app's release export of the local stack, served by the Worker
// (e2e/ui-web.sh); UI_TARGET=dev runs Metro's dev build instead,
// against the local stack, one fresh fixture world per
// spec file (e2e/ui/fixture.ts), so files run in parallel without
// touching each other. Tests inside a file run in order: they share its world.
const directory = path.dirname(fileURLToPath(import.meta.url));
// One id per run, set in the runner process and inherited by its workers: a
// spec file's world is kept under it (support.ts useWorld).
process.env['UI_RUN_ID'] ??= `${Date.now().toString(36)}-${process.pid}`;
const voice = writeVoice();
// The export is served with /api by the Worker, and the export bakes in its own origin
// for /api, so the app and the Worker share :8787 (where the fixtures and the offline
// tests also expect the Worker). The dev target keeps Metro on its own port, so a journey
// server on another port is left alone, beside the Worker on :8787.
const dev = process.env['UI_TARGET'] === 'dev';
const port = process.env['UI_PORT'] ?? (dev ? '8097' : '8787');
process.env['UI_PORT'] = port;
const chrome = process.env['PW_CHROME'] ? { channel: 'chrome' } : {};
const mic = {
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${voice}`] }
};

export default defineConfig({
  testDir: path.join(directory, 'ui'),
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: Number(process.env['UI_WORKERS'] ?? 4),
  // A retry that turns red into green hides what this suite exists to find.
  retries: 0,
  forbidOnly: Boolean(process.env['CI']),
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: path.join(directory, 'results/ui/report.json') }]],
  outputDir: path.join(directory, 'results/ui'),
  use: {
    baseURL: `http://localhost:${port}`,
    actionTimeout: 20_000,
    navigationTimeout: 120_000,
    // Sessions and signed URLs must not land in shared traces; screenshots only of failures.
    trace: 'off', video: 'off', screenshot: 'only-on-failure'
  },
  projects: [
    // Tests tagged @wide run only in the wide project; it is listed first so its few long
    // journeys start at once rather than last, alone (and land in CI's first shard).
    { name: 'wide', grep: /@wide/, use: { ...devices['Desktop Chrome'], ...chrome, viewport: { width: 1280, height: 900 }, ...mic } },
    // Phone width, the default for every test.
    { name: 'phone', grepInvert: /@wide/, use: { ...devices['Desktop Chrome'], ...chrome, viewport: { width: 430, height: 932 }, ...mic } }
  ],
  webServer: dev
    ? [
        {
          command: `bash e2e/web.sh ${port}`,
          cwd: path.join(directory, '..'),
          url: `http://localhost:${port}`,
          reuseExistingServer: true,
          timeout: 300_000
        },
        // The Worker that keeps the audio and serves Reports (decisions.md 69, 57).
        {
          command: 'npm run web:dev',
          cwd: path.join(directory, '..'),
          url: 'http://localhost:8787/api/blobs',
          reuseExistingServer: true,
          timeout: 120_000
        }
      ]
    : [
        // Exports the app, then serves it and /api from one Worker. A Worker already on this
        // port is reused as it is: stop it first to serve a fresh export (README, Running the suite).
        {
          command: `bash e2e/ui-web.sh ${port}`,
          cwd: path.join(directory, '..'),
          url: `http://localhost:${port}/version.json`,
          reuseExistingServer: true,
          timeout: 600_000
        }
      ]
});
