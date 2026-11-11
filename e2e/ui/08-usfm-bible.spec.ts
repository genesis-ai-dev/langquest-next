// 08 · Study and reference, the uploaded Bible (docs/ui-test-suite/08-study-and-reference.md,
// STUDY-037 and STUDY-038; LAN-230, decisions 207 and 208): an organization's Bible that
// came as USFM files shows as a Bible, with the file's book names, headings, lines of
// poetry and notes, and never a raw marker. One world for the file (usfm-helpers.ts).
//
// LAN230_PICS=<folder> also saves the phone-sized pictures the review reads.
import type { Page } from '@playwright/test';
import { button, expect, expectStill, expectSyncIdle, primary, screenText, test, text } from './support';
import { openRecord, open, useRunWorld, visible } from './reviewing-helpers';
import { ENGLISH, IRV, IRV_NAME, offerUsfmWorld } from './usfm-helpers';

const world = useRunWorld('08-usfm', offerUsfmWorld);
const pics = process.env['LAN230_PICS'];
if (pics) test.use({ viewport: { width: 412, height: 915 } });

const tabChip = (page: Page, name: string | RegExp) => visible(page.getByRole('tab', { name })).first();
const irvRow = (page: Page) => button(page, new RegExp(`^${IRV} · ${IRV_NAME.replace(/[()]/g, '\\$&')}`));
const snap = async (page: Page, name: string) => { if (pics) await page.screenshot({ path: `${pics}/${name}.png` }); };

/** TRANS's workspace for P-SUBMITTED, on the Bible chip. */
async function openBible(page: Page): Promise<void> {
  await open(page, world(), 'TRANS');
  await openRecord(page, world(), 'P-SUBMITTED');
  // A fresh device draws the record before the language arrives: read the main button once Version 1 shows.
  await expect(text(page, /^Version 1 · \d+:\d\d$/)).toBeVisible();
  await expectSyncIdle(page);
  await expectStill(primary(page));
  await primary(page).click();
  await expect(text(page, /^Recording Version \d+$/)).toBeVisible();
  await tabChip(page, 'Bible').click();
}

/** Nothing on the screen is a raw marker: USFM's own words start with a backslash. */
async function expectNoMarkers(page: Page): Promise<void> {
  expect(await screenText(page)).not.toContain('\\');
}

test('STUDY-037 An uploaded Bible beside the passage, with its headings', async ({ page }) => {
  await openBible(page);
  // Both Bibles the organization recommends are offered; the English one sorts first.
  await button(page, `Bible: ${ENGLISH}. Choose another`).click();
  await expect(text(page, 'Choose a Bible')).toBeVisible();
  await snap(page, 'after-bibles');
  await visible(page.getByRole('radio', { name: new RegExp(IRV) })).first().click();
  await expect(button(page, `Bible: ${IRV}. Choose another`)).toBeVisible();
  // The passage's verses are Luke 15:11-32 in Hindi, under the file's own headings.
  await expect(button(page, /^Verse 15:11\. /)).toBeVisible();
  await expect(text(page, /^फिर उसने कहा/)).toBeVisible();
  await expect(text(page, 'उड़ाऊ पुत्र का दृष्टान्त')).toBeVisible();
  await expect(text(page, 'उड़ाऊ पुत्र का लौटना')).toBeVisible();
  await expect(text(page, `${IRV}: © Bridge Connectivity Solutions. CC BY-SA 4.0.`)).toBeVisible();
  await expectNoMarkers(page);
  await snap(page, 'after-passage');
});

test('STUDY-038 More Bibles opens the uploaded Bible with the file\'s books, headings, poetry and notes', async ({ page }) => {
  await openBible(page);
  await button(page, `Bible: ${ENGLISH}. Choose another`).click();
  await button(page, /More Bibles/).click();
  await expect(text(page, 'In your organization\'s library')).toBeVisible();
  await irvRow(page).click();
  await expect(text(page, IRV_NAME)).toBeVisible();
  await expect(text(page, `${IRV} · hin`)).toBeVisible();
  await expect(text(page, 'Can be kept offline')).toBeVisible();
  // The book chips are the file's own names; it opens at the passage's chapter, Luke 15, with the passage's verses marked.
  await expect(text(page, 'योना')).toBeVisible();
  await expect(text(page, 'लूका')).toBeVisible();
  await expect(button(page, 'Chapter 15')).toBeVisible();
  await expect(text(page, 'उड़ाऊ पुत्र का दृष्टान्त')).toBeVisible();
  await expectNoMarkers(page);
  // Jonah 2: a heading, poetry on lines of their own, and the footnote under verse 2.
  await text(page, 'योना').click();
  await button(page, 'Chapter 2').click();
  await expect(text(page, 'योना की प्रार्थना')).toBeVisible();
  await expect(text(page, /^और उसने मेरी सुन ली;/)).toBeVisible();
  await expect(text(page, /^तेरी सब तरंग और लहरें मेरे ऊपर से बह गईं।/)).toBeVisible();
  const note = text(page, 'जल की गहराई अधोलोक के सदृश्य थी और वह मृतकों में गिना गया था।', false);
  await expect(note).toBeVisible();
  await expectNoMarkers(page);
  await snap(page, 'after-book');
});
