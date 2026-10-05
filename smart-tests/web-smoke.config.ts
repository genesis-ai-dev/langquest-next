import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVoice } from './fixtures/voice';

// The web smoke test (decisions.md 58): the release web build, served as in
// production, in three browser engines, at desktop and phone width. Plain
// selectors, no model: it checks the web platform itself (storage, tabs,
// URLs, headers, sign-out), not the journeys.
const directory = path.dirname(fileURLToPath(import.meta.url));
const voice = writeVoice();
const port = process.env['SMOKE_PORT'] ?? '8787';
// PW_CHROME=1 runs the Chromium projects in the installed Google Chrome instead of Playwright's download.
const chrome = process.env['PW_CHROME'] ? { channel: 'chrome' } : {};
const chromiumMic = { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${voice}`] };

export default defineConfig({
  testDir: path.join(directory, 'web-smoke'),
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env['CI']),
  timeout: 240_000,
  reporter: [['line']],
  outputDir: path.join(directory, 'results'),
  use: { baseURL: `http://localhost:${port}`, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chrome, viewport: { width: 1280, height: 900 }, permissions: ['microphone'], launchOptions: chromiumMic } },
    { name: 'chromium-phone', use: { ...devices['Desktop Chrome'], ...chrome, viewport: { width: 430, height: 932 }, permissions: ['microphone'], launchOptions: chromiumMic } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 900 } } }
  ],
  webServer: {
    command: `smart-tests/web-smoke.sh ${port}`,
    cwd: path.join(directory, '..'),
    url: `http://localhost:${port}/version.json`,
    reuseExistingServer: true,
    timeout: 600_000
  }
});
