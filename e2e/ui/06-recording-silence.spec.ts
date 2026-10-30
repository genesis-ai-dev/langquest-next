// 06 · Recording: the silence switch (docs/ui-test-suite/06-recording.md
// REC-057, decision 194), in a world of its own so P-S is untouched for
// 06-recording.spec.ts. The tone microphone speaks for a set time, then is
// silent, so each pause between parts is a known stretch of quiet.
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
