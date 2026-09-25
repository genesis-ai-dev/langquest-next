import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVoice } from './fixtures/voice';

const directory = path.dirname(fileURLToPath(import.meta.url));
const voice = writeVoice();

export default defineConfig({
  testDir: path.join(directory, 'journeys'),
  testMatch: '**/*.spec.ts',
  workers: 1,
  // A retry that turns red into green hides exactly what this suite exists to find.
  retries: 0,
  forbidOnly: Boolean(process.env['CI']),
  timeout: 240_000,
  reporter: [['line']],
  outputDir: path.join(directory, 'results'),
  use: {
    baseURL: process.env['SMART_BASE_URL'] ?? 'http://localhost:8090',
    viewport: { width: 430, height: 932 },
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${voice}`]
    },
    // Sessions and signed URLs must not land in shared traces.
    trace: 'off', screenshot: 'off', video: 'off'
  },
  webServer: {
    command: 'npm run web -w mobile -- --port 8090',
    cwd: path.join(directory, '..'),
    url: 'http://localhost:8090',
    reuseExistingServer: true,
    timeout: 300_000
  }
});
