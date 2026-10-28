// "Take back a review", for reviewers: Ruth said Luke 15:11-32 looks good,
// then thought again. On the passage she opens her Peer check and undoes it;
// only the reviewer can take back their own check.
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const sheet = (page: import('playwright').Page) => page.getByTestId('sheet').locator('visible=true').last();

export const takeBackAReview: Tutorial = {
  id: 'take-back-a-review',
  title: 'Take back a review',
  as: 'REV',
  names: recordAPassage.names,
  // Off camera, Ruth does the Peer check of Luke 15:11-32: Looks good.
  before: async (page) => {
    await button(page, /^Check Luke 15:11–32/).click();
    await button(page, 'Listen, step 1 of 2').waitFor({ timeout: 30_000 });
    await id(page, 'primary-action').click();
    await button(page, 'Looks good').click();
    await page.getByTestId('team-row-peer').locator('visible=true').first().waitFor({ timeout: 30_000 });
    await id(page, 'toast').waitFor({ state: 'hidden', timeout: 30_000 });
  },
  steps: [
    {
      screen: 'passage_record',
      part: (page) => page.getByTestId('team-row-peer').locator('visible=true').first(),
      say: "Here's how to take back a review. On the passage, tap the check you did.",
      tap: true,
      until: (page) => sheet(page).getByRole('button', { name: 'Undo', exact: true }).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => sheet(page).getByRole('button', { name: 'Undo', exact: true }),
      say: 'Tap Undo. Only you can take back your own check.',
      tap: true,
      until: (page) => sheet(page).getByRole('button', { name: 'Review it now' }).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => sheet(page).getByRole('button', { name: 'Review it now' }),
      say: 'The check is open again. Do it again when you are ready.',
      stay: 2
    }
  ]
};
