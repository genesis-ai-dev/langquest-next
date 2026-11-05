// "Report or block someone", for everyone: someone left a note on Luke
// 13:1-9 selling phones. Ruth reports the note, then blocks the person who
// left it, and sees that the same flag unblocks them.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { openOnMap } from './passage-nav';
import { noteAs } from '../ui/account-helpers';

const SPAM = 'Cheap phones for sale! Call 555-0100';
const PETER = recordAPassage.names.people!.TREV!;
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
// The note shows inside its history entry, with who left it.
const note = (page: Page) => page.getByText(SPAM).locator('visible=true').first();
const row = (page: Page, start: string) => button(page, new RegExp(`^${start}`));
const flag = (page: Page) => button(page, `Report or block ${PETER}`);

export const reportOrBlockSomeone: Tutorial = {
  id: 'report-or-block-someone',
  title: 'Report or block someone',
  as: 'REV',
  names: recordAPassage.names,
  prepare: async (world) => { await noteAs(world, 'TREV', 'P-NEW', SPAM); },
  steps: [
    ...openOnMap('Luke 13:1–9', 'Luke 13:1', "Here's what to do when something someone added doesn't belong here. This note is on a passage."),
    {
      screen: 'passage_record',
      part: (page) => button(page, 'Versions and history'),
      tap: true,
      until: (page) => button(page, /^History/).waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'version_detail',
      part: (page) => button(page, /^History/),
      tap: true,
      until: (page) => note(page).waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'version_detail',
      part: note,
      say: 'Here is the note.'
    },
    {
      screen: 'version_detail',
      part: flag,
      say: 'Beside anything someone else added, there is a flag. Tap it.',
      tap: true,
      until: (page) => words(page, 'Report or block').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'version_detail',
      part: (page) => [row(page, 'Report this note'), row(page, `Block ${PETER}`)],
      say: 'Report the note, report the person for how they behave, or block them.'
    },
    {
      screen: 'version_detail',
      part: (page) => row(page, 'Report this note'),
      say: 'Tap Report this note.',
      tap: true,
      until: (page) => words(page, 'What is wrong with it?').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'version_detail',
      part: (page) => page.getByRole('radio', { name: /^Spam or unrelated/ }).locator('visible=true').first(),
      say: 'Pick what is wrong with it.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'version_detail',
      part: (page) => page.getByText(/^Your organization's admins and the LangQuest team see the report/).locator('visible=true').first(),
      say: `Your organization's admins see the report. ${PETER} is not told who sent it.`
    },
    {
      screen: 'version_detail',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Send report.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1.5
    },
    {
      screen: 'version_detail',
      part: flag,
      say: `To stop seeing what ${PETER} adds, tap the flag again.`,
      tap: true,
      until: (page) => words(page, 'Report or block').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'version_detail',
      part: (page) => row(page, `Block ${PETER}`),
      say: `Tap Block. Only you stop seeing it, and ${PETER} isn't told.`,
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 10_000 }),
      stay: 3
    },
    {
      screen: 'version_detail',
      part: (page) => page.getByText(/Hidden because you blocked them/).locator('visible=true').first(),
      say: 'What they add is hidden for you now.'
    },
    {
      screen: 'version_detail',
      part: flag,
      say: 'The same flag unblocks them.',
      stay: 2
    }
  ]
};
