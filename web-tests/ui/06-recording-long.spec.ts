// 06 · Recording: REC-030, ten minutes of recording in one workspace
// (docs/ui-test-suite/06-recording.md), in a world of its own so it runs
// beside the other recording tests instead of after them. The speech is the
// tone microphone (06-recording-helpers.ts): 5:20 without a pause, then five
// minutes with a 1.5-second pause every 10 seconds.
import { derivePassage, type LanguageState } from '@langquest-next/core';
import type { Page } from '@playwright/test';
import {
  chip, expectIdle, expectParts, expectUploaded, installMicControl, mic, openWorkspace, partCount, publishButton, recordButton, useFileWorld
} from './06-recording-helpers';
import { clientAs } from './fixture';
import { button, expect, expectToast, openAs, primary, test, text } from './support';

const world = useFileWorld('06-recording-long');
test.beforeEach(async ({ page }) => { await installMicControl(page); });

/** How long a tap on a chip takes to show, while recording: the workspace stays responsive. */
async function tapLatency(page: Page): Promise<number> {
  const target = (await chip(page, 'Bible').getAttribute('aria-selected')) === 'true' ? 'Key words' : 'Bible';
  const started = Date.now();
  await chip(page, target).click();
  await expect(chip(page, target)).toHaveAttribute('aria-selected', 'true');
  return Date.now() - started;
}

test('REC-030 A five-minute part, and a five-minute session of many parts', async ({ page }) => {
  test.setTimeout(25 * 60_000); // ceiling: 5:20 of live speech, then 5 minutes of 30 parts, in real time
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q4', 'Record');
  const m = mic(page);
  await m.mode('tone');
  // 5:20 of speech with no pause, then 2 seconds of quiet, then stop.
  await recordButton(page).click();
  await m.speak(true);
  const slow: number[] = [];
  for (let s = 0; s < 320; s += 40) {
    await page.waitForTimeout(40_000); // sleep: 40 s of speech, the test's own length of a five-minute part
    await expect(text(page, 'Recording…')).toBeVisible();
    slow.push(await tapLatency(page));
  }
  await m.speak(false);
  await expectParts(page, 1, 10_000);
  await recordButton(page).click();
  await expectIdle(page);
  await expectParts(page, 1, 60_000);
  await expect(button(page, 'Play Part 1')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Part 1, 1 part · 5:2\d$/ })).toBeVisible();
  // Five minutes with a 1.5-second pause every 10 seconds: one part each.
  await recordButton(page).click();
  for (let i = 0; i < 30; i++) {
    await m.speak(true);
    await page.waitForTimeout(8500); // sleep: 8.5 s of speech per part, the test's own length
    await m.speak(false);
    await expectParts(page, 2 + i, 10_000);
    if (i % 5 === 4) slow.push(await tapLatency(page));
  }
  await recordButton(page).click();
  await expectIdle(page);
  await expectParts(page, 31, 60_000);
  // About ten minutes: the pauses trimmed off each part (half of each kept at its end) leave a little under.
  await expect(page.getByRole('button', { name: /^Parts 1–31, 31 parts · (9:[3-5]\d|10:\d\d)$/ })).toBeVisible();
  expect(Math.max(...slow), `taps while recording answered in ${slow.join(', ')} ms`).toBeLessThan(500);
  // Every part is listed, and the last one can be reached.
  await button(page, 'Play Part 31').scrollIntoViewIfNeeded();
  await expect(button(page, 'Play Part 31')).toBeVisible();
  expect(await partCount(page)).toBe(31);
  // Part 1 plays.
  await button(page, 'Play Part 1').click();
  await expect(button(page, 'Pause Part 1')).toBeVisible();
  await button(page, 'Pause Part 1').click();
  // Published, and REV can play the whole version from the server.
  await publishButton(page).click();
  await primary(page).click();
  await expectToast(page, 'Version 1 published.');
  await expectUploaded(page, w);
  const rev = await clientAs(w, 'REV', 'A');
  const state = rev.getState() as LanguageState;
  const v = derivePassage(state, w.passages['P-Q4'].unitId).versions;
  expect(v.map((x) => x.cardHashes.length)).toEqual([31]);
  for (const h of v[0]!.cardHashes) expect(state.blobs[h]?.stored).toBe(true);
});
