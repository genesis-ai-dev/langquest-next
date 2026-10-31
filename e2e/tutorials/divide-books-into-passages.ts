// "Divide books into passages", for coordinators: Lumari now translates the
// whole Bible, and FIA's passages do not cover Proverbs. Daniel finds it on
// the map and breaks it up by chapter.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();

/** Off camera: Lumari translates the whole Bible, with FIA's passages where FIA has them. */
async function wholeBible(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first().click();
  await button(page, /^Lumari /).click();
  await button(page, /^Content template/).click();
  await button(page, 'Which books').click();
  await words(page, 'What to translate').waitFor({ timeout: 10_000 });
  await id(page, 'primary-action').click();
  await id(page, 'primary-action').click();
  // FIA's passages in every language it has: 46 books, so some of the whole Bible waits.
  await words(page, 'FIA passages').click();
  await words(page, 'Whole Bible').click();
  await id(page, 'primary-action').click();
  await id(page, 'toast').waitFor({ timeout: 30_000 });
  await id(page, 'toast').waitFor({ state: 'hidden', timeout: 30_000 });
  const work = page.getByRole('tab', { name: 'Work' }).locator('visible=true').first();
  while (!(await work.isVisible())) await button(page, 'Back').click();
  await work.click();
  // Every passage of the new template is uploaded before filming, so the banner says so.
  await page.getByText(/changes? waiting to upload/).locator('visible=true').first().waitFor({ state: 'hidden', timeout: 180_000 });
}

export const divideBooksIntoPassages: Tutorial = {
  id: 'divide-books-into-passages',
  title: 'Divide books into passages',
  as: 'COORD',
  names: recordAPassage.names,
  before: async (page) => {
    await page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first().waitFor({ timeout: 120_000 });
    await wholeBible(page);
  },
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Map' }).locator('visible=true').first(),
      say: "Here's how to divide a book into passages, when the way you chose does not cover it. Tap Map.",
      tap: true,
      until: (page) => button(page, /^Lumari: /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'status_home',
      part: (page) => button(page, /^Lumari: /),
      say: 'Open the language.',
      tap: true,
      until: (page) => words(page, 'Old Testament').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'map_home',
      part: (page) => words(page, 'Old Testament'),
      tap: true,
      until: (page) => words(page, 'Proverbs').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'map_home',
      part: (page) => words(page, 'Proverbs'),
      say: 'Proverbs is waiting to be divided. Tap it.',
      tap: true,
      until: (page) => button(page, 'Divide Proverbs').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'book_map',
      part: (page) => button(page, 'Divide Proverbs'),
      say: 'Tap Divide Proverbs.',
      tap: true,
      until: (page) => words(page, 'By chapter').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'book_map',
      part: (page) => words(page, 'Divide it your own way'),
      say: 'Divide it your own way, choosing where each passage starts,'
    },
    {
      screen: 'book_map',
      part: (page) => words(page, 'By chapter'),
      say: 'or pick a ready-made way. Here, by chapter.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'book_map',
      part: (page) => button(page, 'Divide Proverbs'),
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1
    },
    {
      screen: 'book_map',
      // Its first two rows of passages.
      part: (page) => [page.getByTestId(/^row-.+-1$/).locator('visible=true').first(), page.getByTestId(/^row-.+-8$/).locator('visible=true').first()],
      say: 'Proverbs has its passages now, ready to record.',
      stay: 2
    }
  ]
};
