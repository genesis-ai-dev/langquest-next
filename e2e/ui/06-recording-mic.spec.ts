// 06 · Recording: the microphone refused (docs/ui-test-suite/06-recording.md
// REC-020, REC-021), in a world of its own so P-Q4 is untouched.
//
// Chrome is started with --use-fake-ui-for-media-stream (ui.config.ts),
// which answers every microphone prompt "Allow", and the site's own
// permission set to "denied" through the DevTools protocol does not stop it.
// So "Block" is the page's microphone refusing as Chrome does after a
// person blocks it: getUserMedia fails with NotAllowedError
// (06-recording-helpers.ts `mic(page).mode('refuse')`); allowing it again in
// the site's settings is the microphone answering again.
import type { Page } from '@playwright/test';
import {
  expectIdle, expectParts, expectUploaded, installMicControl, mic, openWorkspace, partCount, publishButton, recordButton, recordParts, settledEventCount, useFileWorld, workspaceSub
} from './06-recording-helpers';
import { back, button, expect, openAs, primary, tab, test, text, waitForApp } from './support';

const world = useFileWorld('06-recording-mic');

test.beforeEach(async ({ page }) => { await installMicControl(page); });

/** The site's microphone permission, as a person sets it in Chrome's site settings. */
async function sitePermission(page: Page, setting: 'denied' | 'granted'): Promise<void> {
  await mic(page).mode(setting === 'denied' ? 'refuse' : 'file');
}

const refused = (page: Page) => text(page, 'Microphone permission is required.');

test('REC-020 Microphone permission refused @p0', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await sitePermission(page, 'denied');
  await openWorkspace(page, w, 'P-Q4', 'Record');
  const before = await settledEventCount(page, w);
  await recordButton(page).click();
  await expect(refused(page)).toBeVisible();
  await expectIdle(page);
  expect(await partCount(page)).toBe(0);
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  // Again: the same message, no crash.
  await recordButton(page).click();
  await expect(refused(page)).toBeVisible();
  await expectIdle(page);
  await expect(text(page, 'This screen could not open')).toHaveCount(0);
  // ✕ still returns to the record, and nothing was written.
  await back(page).click();
  await expect(primary(page)).toHaveText('Record');
  expect(await settledEventCount(page, w), 'nothing is written').toBe(before);
});

test('REC-021 Recording works once the microphone is allowed in Settings', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await sitePermission(page, 'denied');
  await openWorkspace(page, w, 'P-Q4', 'Record');
  await recordButton(page).click();
  await expect(refused(page)).toBeVisible();
  // The site's settings: allow the microphone, then reload and open the workspace again.
  await page.reload();
  await waitForApp(page);
  await sitePermission(page, 'granted');
  await openWorkspace(page, w, 'P-Q4', 'Record');
  await recordParts(page, 1);
  await expect(refused(page)).toHaveCount(0);
  await expectParts(page, 1);
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expectUploaded(page, w);
});

