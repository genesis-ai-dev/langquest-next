// "Move a passage along", for coordinators: Luke 15:11-32 does not need its
// back translation, so Daniel sets it aside with a reason. Luke 15:1-10 waits
// at the Consultant check, a checkpoint, and the church needs it before the
// consultant can come: Daniel moves past it, with a reason, on the record.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { openFromProgress } from './passage-nav';

const sheet = (page: Page) => page.getByTestId('sheet').locator('visible=true').last();
const find = (page: Page) => page.getByRole('textbox', { name: 'Find “John 3”' }).locator('visible=true').first();

export const moveAPassageAlong: Tutorial = {
  id: 'move-a-passage-along',
  title: 'Move a passage along',
  as: 'COORD',
  names: recordAPassage.names,
  steps: [
    ...openFromProgress('Lumari', 'Luke 15:11–32', 'Luke 15:11', "Here's how to move a passage along when a check isn't needed, or can't happen yet. Open the passage."),
    {
      screen: 'passage_record',
      part: (page) => id(page, 'team-row-bt'),
      say: 'This one does not need a back translation. Tap the check.',
      tap: true,
      until: (page) => sheet(page).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => sheet(page).getByRole('button', { name: 'Already happened' }).last(),
      say: 'If it happened outside the app, say so here.'
    },
    {
      screen: 'passage_record',
      part: (page) => sheet(page).getByRole('button', { name: 'Set aside' }).last(),
      say: 'If it is not needed, set it aside.',
      tap: true,
      until: (page) => sheet(page).getByRole('button', { name: 'Not needed for this passage' }).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => sheet(page).getByRole('button', { name: 'Not needed for this passage' }),
      say: 'Say why, so the next person understands.',
      tap: true,
      stay: 0.5
    },
    {
      screen: 'passage_record',
      part: (page) => sheet(page).getByRole('button', { name: 'Set aside', exact: true }).last(),
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1.5
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, 'Back'),
      say: 'Now a passage held at a checkpoint.',
      tap: true,
      until: (page) => find(page).waitFor({ timeout: 30_000 }),
      stay: 0.5
    },
    {
      screen: 'map_home',
      part: find,
      type: 'Luke 15:1',
      replace: true,
      stay: 0.6
    },
    {
      screen: 'map_home',
      part: (page) => page.getByText('Luke 15:1–10', { exact: true }).locator('visible=true').first(),
      tap: true,
      until: (page) => id(page, 'team-row-consultant').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => id(page, 'team-row-consultant'),
      say: 'The lock means the consultant check must pass before the next steps. The consultant cannot come for months. Tap it.',
      tap: true,
      until: (page) => sheet(page).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => sheet(page).getByRole('button', { name: 'Move past this checkpoint…' }),
      say: 'Tap Move past this checkpoint.',
      tap: true,
      until: (page) => sheet(page).getByRole('button', { name: 'Consultant visit is months away; church needs it now' }).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => sheet(page).getByRole('button', { name: 'Consultant visit is months away; church needs it now' }),
      say: 'Pick the reason. It goes on the record with your name.',
      tap: true,
      stay: 0.5
    },
    {
      screen: 'passage_record',
      part: (page) => sheet(page).getByRole('button', { name: 'Move past checkpoint', exact: true }),
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1.5
    },
    {
      screen: 'passage_record',
      part: (page) => id(page, 'primary-action'),
      say: 'Final approval can go ahead now. To change your mind, undo it from History.',
      stay: 2
    }
  ]
};
