// 06 · Recording: the silence switch (docs/ui-test-suite/06-recording.md
// REC-057, decision 194) and the boxes edited freely once stopped (REC-058,
// LAN-199), in a world of their own so P-S and P-T are untouched for
// 06-recording.spec.ts. The tone microphone speaks for a set time, then is
// silent, so each pause between parts is a known stretch of quiet.
import type { Locator, Page } from '@playwright/test';
import { expectParts, expectUploaded, installMicControl, leaveSession, mic, openWorkspace, recordButton, say, stopRecording, useFileWorld } from './06-recording-helpers';
import { byId, expect, openAs, test, text } from './support';

const world = useFileWorld('06-recording-silence');

test.beforeEach(async ({ page }) => { await installMicControl(page); });

test('REC-057 The silence switch boxes the pauses between parts and keeps them as parts', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-S', 'Record');
  const m = mic(page);
  await m.mode('tone');
  await m.speak(false);
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  // The switch sits right of the red button while the session is open, off until switched on.
  const toggle = byId(page, 'silence-switch');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  // Two parts with a pause between them: the pause is a part of its own, numbered between them.
  await say(page, 2500, 0);
  await expectParts(page, 1, 10_000);
  await say(page, 2500, 0);
  await expectParts(page, 3, 10_000);
  // The silence after the last part grows, as the next part's number, until something is said.
  await expect(byId(page, 'live-silence-4')).toBeVisible();
  await stopRecording(page);
  const part = (n: number) => byId(page, `live-part-${n}`);
  const silence = (n: number) => byId(page, `live-silence-${n}`);
  for (const box of [part(1), silence(2), part(3)]) await expect(box).toBeVisible();
  // Stopped, nothing grows: the room after the last part is not kept.
  await expect(silence(4)).toHaveCount(0);
  // Off: only the speech is boxed, numbered as before; on again, the pause is back.
  await toggle.click();
  await expect(silence(2)).toHaveCount(0);
  await expect(part(2)).toBeVisible();
  await toggle.click();
  await expect(silence(2)).toBeVisible();
  // A tap on the pause plays it.
  const quiet = (await silence(2).boundingBox())!;
  await page.mouse.click(quiet.x + quiet.width / 2, quiet.y + quiet.height / 2);
  await expect(text(page, /could not|Something went wrong/)).toHaveCount(0);
  // Done keeps it as an ordinary part, in its place between the two.
  await leaveSession(page);
  await expect(page.getByRole('button', { name: /^Parts 1–3, 3 parts · 0:\d\d$/ })).toBeVisible();
  // The browser keeps the switch for the next session.
  expect(await page.evaluate(() => localStorage.getItem('recording:silence-parts:v1'))).toBe('on');
  await m.mode('file');
  await expectUploaded(page, w);
});

/** A tap on a box's ×, in its bottom-right corner. */
async function tapCorner(page: Page, box: Locator): Promise<void> {
  const b = (await box.boundingBox())!;
  await page.mouse.click(b.x + b.width - 15, b.y + b.height - 15);
}

test('REC-058 Stopped, any box can go, a box stretches over a dropped one, and a + adds a box', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-T', 'Record');
  const m = mic(page);
  await m.mode('tone');
  await m.speak(false);
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  // Three parts, each followed by two seconds of quiet: the room between them is kept whatever the switch.
  for (const n of [1, 2, 3]) {
    await say(page, 2500);
    await expectParts(page, n, 10_000);
  }
  await stopRecording(page);
  const part = (n: number) => byId(page, `live-part-${n}`);
  const silence = (n: number) => byId(page, `live-silence-${n}`);
  // The switch on: each pause is boxed, and its × drops that pause alone.
  const toggle = byId(page, 'silence-switch');
  await toggle.click();
  for (const box of [part(1), silence(2), part(3), silence(4), part(5)]) await expect(box).toBeVisible();
  await expect(byId(page, 'live-add')).toHaveCount(0);
  await tapCorner(page, silence(2));
  for (const box of [part(1), part(2), silence(3), part(4)]) await expect(box).toBeVisible();
  await expect(silence(2)).toHaveCount(0);
  // Off: the speech alone. Part 2's × frees its room, and the + there boxes it again, in its place.
  await toggle.click();
  for (const box of [part(1), part(2), part(3)]) await expect(box).toBeVisible();
  await tapCorner(page, part(2));
  await expect(part(2)).toHaveCount(0);
  const one = (await part(1).boundingBox())!;
  const three = (await part(3).boundingBox())!;
  const adds = await byId(page, 'live-add').all();
  const spots = await Promise.all(adds.map((a) => a.boundingBox()));
  const between = spots.find((b) => b && b.x > one.x + one.width && b.x + b.width < three.x)!;
  expect(between, 'a + where part 2 was').toBeTruthy();
  await page.mouse.click(between.x + between.width / 2, between.y + between.height / 2);
  await expect(part(2)).toBeVisible();
  // Dropped again, part 1's end stretches over its sound, and stops at part 3's edge.
  await tapCorner(page, part(2));
  await expect(part(2)).toHaveCount(0);
  const y = one.y + one.height / 2;
  const x0 = one.x + one.width - 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const steps = Math.ceil((three.x + 30 - x0) / 5);
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + i * 5, y);
  await page.mouse.up();
  // Its right side meets part 3's left side, to a pixel.
  await expect.poll(async () => { const b = await part(1).boundingBox(); return b ? Math.abs(b.x + b.width - three.x) : null; },
    { message: 'part 1 reaches part 3, never into it' }).toBeLessThanOrEqual(1);
  // Done keeps the two parts as their boxes stand.
  await leaveSession(page);
  await expect(page.getByRole('button', { name: /^Parts 1–2, 2 parts · 0:\d\d$/ })).toBeVisible();
  await m.mode('file');
  await expectUploaded(page, w);
});
