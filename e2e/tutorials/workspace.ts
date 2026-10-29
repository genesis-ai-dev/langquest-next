// What the recording videos share: finding a part of the screen as the UI
// tests do, and the parts that a video about the parts starts from, recorded
// off camera the way the person in the video would record them.
import type { Locator, Page } from 'playwright';
import type { Mic } from './tutorial';

export const id = (page: Page, testId: string): Locator => page.getByTestId(testId).locator('visible=true').last();
export const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' }).locator('visible=true').last();
export const shows = (page: Page, testId: string): Promise<void> => id(page, testId).waitFor({ state: 'visible', timeout: 30_000 });
/** A part's verse space (its label says the part and its verse). */
export const verseSpace = (page: Page, n: number): Locator =>
  page.getByRole('button', { name: new RegExp(`^Part ${n}, (no verse yet|Verses? )`) }).locator('visible=true').first();
/** A part's row: its verse space, play button, bars and handle. */
export const partRow = (page: Page, n: number): Locator[] =>
  [verseSpace(page, n), page.getByLabel(`Move Part ${n}`, { exact: true }).locator('visible=true').first()];
export const divider = (page: Page): Locator => page.getByRole('slider', { name: 'Divider between reference and your recording' });

/**
 * From My Work, the passage Daniel asked for (Luke 13:31-35), recorded from
 * the speaker's first recording, stopped and kept: the workspace with its
 * parts, every one saved and uploaded, and the upload bar gone.
 */
export async function recordOffCamera(page: Page, mic: Mic, parts: number): Promise<void> {
  await page.getByText('Luke 13:31–35').locator('visible=true').first().waitFor({ timeout: 60_000 });
  await id(page, 'primary-action').click();
  await shows(page, 'path-step-record');
  await id(page, 'primary-action').click();
  await shows(page, 'record-button');
  await id(page, 'record-button').click();
  await mic.say(0);
  await id(page, 'record-button').click();
  await page.getByText('Stopped', { exact: true }).waitFor();
  await button(page, 'Done').click();
  await shows(page, 'publish-button');
  await button(page, new RegExp(`^Parts 1–${parts}, ${parts} parts · `)).waitFor({ timeout: 60_000 });
  const play = page.getByRole('button', { name: `Play Parts 1–${parts}`, exact: true }).locator('visible=true').first();
  await page.waitForFunction((e) => e?.getAttribute('aria-disabled') !== 'true', await play.elementHandle({ timeout: 60_000 }), { timeout: 60_000 });
  await page.getByText('All uploaded').waitFor({ timeout: 60_000 }).catch(() => undefined);
  await id(page, 'upload-bar').waitFor({ state: 'hidden', timeout: 60_000 });
  // The count can read right before the last part comes in: counted again once every part is kept.
  await button(page, new RegExp(`^Parts 1–${parts}, ${parts} parts · `)).waitFor({ timeout: 10_000 });
}
