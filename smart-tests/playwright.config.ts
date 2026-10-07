import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVoice } from './fixtures/voice';

const directory = path.dirname(fileURLToPath(import.meta.url));
const voice = writeVoice();
// Journeys get their own dev server, started from a shell so Metro sees edits
// (the preview pane's server on 8090 does not in this environment).
const port = process.env['SMART_PORT'] ?? '8091';

export default defineConfig({
  testDir: path.join(directory, 'journeys'),
  testMatch: '**/*.spec.ts',
  workers: 1,
  // A retry that turns red into green hides exactly what this suite exists to find.
  retries: 0,
  forbidOnly: Boolean(process.env['CI']),
  timeout: 180_000,
  reporter: [['line']],
  outputDir: path.join(directory, 'results'),
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 430, height: 932 },
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${voice}`]
    },
    // Sessions and signed URLs must not land in shared traces.
    trace: 'off', screenshot: 'off', video: 'off'
  },
  webServer: [
    {
      command: `smart-tests/web.sh ${port}`,
      cwd: path.join(directory, '..'),
      url: `http://localhost:${port}`,
      reuseExistingServer: true,
      timeout: 300_000
    },
    // The Worker that keeps the audio (decisions.md 69); env.sh points the
    // app and the seeds at it. Listing files without a key answers 403,
    // which Playwright counts as up.
    {
      command: 'npm run web:dev',
      cwd: path.join(directory, '..'),
      url: 'http://localhost:8787/api/blobs',
      reuseExistingServer: true,
      timeout: 120_000
    }
  ]
});
