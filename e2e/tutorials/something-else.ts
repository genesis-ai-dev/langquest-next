// "Something else?", for translators: Daniel asked Grace to record Luke
// 13:1-9, and she can't this week. She opens Something else?, sees what it
// offers, and leaves a voice note for the team.
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { openOnMap } from './passage-nav';

export const somethingElse: Tutorial = {
  id: 'something-else',
  title: 'Something else?',
  as: 'TRANS',
  names: recordAPassage.names,
  // Grace's voice note: she is away this week.
  speech: ['away-note.wav'],
  steps: [
    ...openOnMap('Luke 13:1–9', 'Luke 13:1', "Here's what to do when the next step isn't the right one. Open the passage."),
    {
      screen: 'passage_record',
      part: (page) => button(page, 'Something else?'),
      say: 'Tap Something else?',
      tap: true,
      until: (page) => page.getByRole('heading', { name: 'Something else?' }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Someone else should do this/),
      say: 'If someone else should record it, ask them here: someone on the team, or someone outside by WhatsApp or text.'
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, /^What helps here/),
      say: 'What helps here shows the Bibles and guides for this passage.'
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Say it instead/),
      say: 'To tell the team something, leave a voice note. Tap Say it instead.',
      tap: true,
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Say it$|^Tap and speak$/),
      say: 'Tap and speak.',
      tap: true,
      speak: 0
    },
    {
      screen: 'passage_record',
      atSpeech: 4,
      part: (page) => button(page, 'Stop recording'),
      tap: true,
      stay: 0.6
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, 'Add note'),
      say: 'Then add it. Your team hears it on this passage.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 10_000 }),
      stay: 2
    }
  ]
};
