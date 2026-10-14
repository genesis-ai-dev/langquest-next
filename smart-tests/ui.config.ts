import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVoice } from './fixtures/voice';

// The UI test suite on the web (docs/ui-test-suite, decisions.md 93): the
// app's dev web build against the local stack, one fresh fixture world per
// spec file (smart-tests/ui/fixture.ts), so files run in parallel without
// touching each other. Tests inside a file run in order: they share its world.
const directory = path.dirname(fileURLToPath(import.meta.url));
// One id per run, set in the runner process and inherited by its workers: a
// spec file's world is kept under it (support.ts useWorld).
process.env['UI_RUN_ID'] ??= `${Date.now().toString(36)}-${process.pid}`;
const voice = writeVoice();
// Its own port, so a journey or smoke server on another port is left alone.
const port = process.env['UI_PORT'] ?? '8097';
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
    // Phone width, the default for every test. Tests tagged @wide run only in the wide project.
    { name: 'phone', grepInvert: /@wide/, use: { ...devices['Desktop Chrome'], ...chrome, viewport: { width: 430, height: 932 }, ...mic } },
    { name: 'wide', grep: /@wide/, use: { ...devices['Desktop Chrome'], ...chrome, viewport: { width: 1280, height: 900 }, ...mic } }
  ],
  webServer: [
    {
      command: `bash smart-tests/web.sh ${port}`,
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
});
