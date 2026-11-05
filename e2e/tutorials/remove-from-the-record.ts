// "Remove something from the record", for admins: Ruth reported a note on
// Luke 13:1-9 that sells phones. Samuel opens the report from Updates and
// removes the note for everyone.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { noteAs, reportAs } from '../ui/account-helpers';

const report = (page: Page) => button(page, /^A note was reported/);

export const removeFromTheRecord: Tutorial = {
  id: 'remove-from-the-record',
  title: 'Remove something from the record',
  as: 'ADMIN',
  names: recordAPassage.names,
  prepare: async (world) => {
    const noteId = await noteAs(world, 'TREV', 'P-NEW', 'Cheap phones for sale! Call 555-0100');
    await reportAs(world, 'REV', { kind: 'note', id: noteId, profileId: world.accounts.TREV.id, unitId: world.passages['P-NEW'].unitId }, 'spam');
  },
  steps: [
    {
      screen: 'my_work',
      part: (page) => button(page, /^Updates/),
      say: "Here's what to do when someone reports something that doesn't belong. Reports come to Updates.",
      tap: true,
      until: (page) => report(page).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'inbox_home',
      part: report,
      say: 'Open the report.',
      tap: true,
      until: (page) => button(page, 'Remove from the record').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'inbox_home',
      part: (page) => [button(page, 'Remove from the record'), button(page, 'Keep it')],
      say: 'Open the passage to look at it. If it is fine, keep it. If it breaks the terms of use, remove it from the record.'
    },
    {
      screen: 'inbox_home',
      part: (page) => button(page, 'Remove from the record'),
      tap: true,
      until: (page) => button(page, 'Remove for everyone').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'inbox_home',
      part: (page) => page.getByText(/It leaves the record for everyone in the organization/).locator('visible=true').first(),
      say: 'It leaves the record for everyone in the organization, so it asks first.'
    },
    {
      screen: 'inbox_home',
      part: (page) => button(page, 'Remove for everyone'),
      say: 'Tap Remove for everyone. Phones stop showing it when they next sync. Anything can also be removed from the flag beside it.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
