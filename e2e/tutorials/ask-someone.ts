// "Ask someone to record or check", for coordinators: nobody has been asked
// to record Luke 12:35-48. Daniel asks Grace, with a word of direction; a
// check is asked for the same way, from its row.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { openFromProgress } from './passage-nav';

const radio = (page: Page, name: RegExp) => page.getByRole('radio', { name }).locator('visible=true').first();

export const askSomeone: Tutorial = {
  id: 'ask-someone',
  title: 'Ask someone to record or check',
  as: 'COORD',
  names: recordAPassage.names,
  steps: [
    ...openFromProgress('Lumari', 'Luke 12:35–48', 'Luke 12:35', "Here's how to ask someone to record a passage, or to check it. Open the passage."),
    {
      screen: 'passage_record',
      part: (page) => button(page, 'Something else?'),
      say: 'Nobody has been asked to record it yet. Tap Something else?',
      tap: true,
      until: (page) => button(page, /^Someone else should do this/).waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Someone else should do this/),
      say: 'Then Someone else should do this. You can ask someone on the team, or someone outside by WhatsApp or text.',
      tap: true,
      until: (page) => radio(page, /^Grace/).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'ask_someone',
      part: (page) => radio(page, /^Grace/),
      say: 'Pick who on the team.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'ask_someone',
      part: (page) => page.getByLabel('Or type them', { exact: true }).locator('visible=true').first(),
      say: 'Say or type directions, if they help.',
      type: 'Please record this one next.',
      stay: 0.5
    },
    {
      screen: 'ask_someone',
      part: (page) => id(page, 'primary-action'),
      say: "Tap Ask Grace. It shows on Grace's My Work.",
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1.5
    },
    {
      screen: 'passage_record',
      part: (page) => [id(page, 'team-row-peer'), id(page, 'team-row-final')],
      say: "To ask for a check, tap the check's row here, and ask its team or one person, the same way.",
      stay: 2
    }
  ]
};
