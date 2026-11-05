// "Back-translate a passage", for reviewers: Grace asked Ruth to
// back-translate Luke 14:25-35. Ruth hears each part and says it in English,
// adds a word for the consultant, and finishes.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { openOnMap } from './passage-nav';

const said = (n: number) => (page: Page) => button(page, new RegExp(`^Part ${n}, 0:\\d\\d in English`)).waitFor({ timeout: 30_000 });

/** Say part n: record, stop when the speaker has finished, then Done keeps it. */
function sayPart(n: number, seconds: number, words: { record?: string; stop?: string; keep?: string } = {}) {
  return [
    {
      screen: 'back_translation',
      part: (page: Page) => button(page, `Record part ${n}`),
      ...(words.record ? { say: words.record } : {}),
      tap: true,
      speak: n - 1
    },
    {
      screen: 'back_translation',
      atSpeech: seconds + 0.3,
      part: (page: Page) => button(page, 'Stop recording'),
      ...(words.stop ? { say: words.stop } : {}),
      tap: true,
      stay: 0.4
    },
    {
      screen: 'back_translation',
      part: (page: Page) => button(page, 'Done'),
      ...(words.keep ? { say: words.keep } : {}),
      tap: true,
      until: said(n),
      stay: 0.6
    }
  ];
}

export const backTranslateAPassage: Tutorial = {
  id: 'back-translate-a-passage',
  title: 'Back-translate a passage',
  as: 'REV',
  names: recordAPassage.names,
  // Ruth says each part again in English.
  speech: ['bt-said-1.wav', 'bt-said-2.wav', 'bt-said-3.wav'],
  steps: [
    ...openOnMap('Luke 14:25–35', 'Luke 14:25', "Here's how to back-translate a passage: say it again in a language the consultant understands. Open the passage."),
    {
      screen: 'passage_record',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Back-translate it.',
      tap: true,
      until: (page) => button(page, 'Record part 1').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'back_translation',
      part: (page) => [button(page, /^Part 1/), button(page, /^Part 3/)],
      say: 'The recording comes in its parts. You say each one, in turn.'
    },
    {
      screen: 'back_translation',
      part: (page) => page.getByText(/drag back and forth as often as you like$/).locator('visible=true').first(),
      say: 'Hear the part first. Drag back and forth as often as you like.'
    },
    ...sayPart(1, 14.4, { record: 'Then tap record, and say it in English.', stop: "Tap stop when you've said it.", keep: 'Then Done keeps it.' }),
    {
      screen: 'back_translation',
      part: (page) => button(page, /^Part 2(,|$)/),
      say: 'Now part 2.',
      tap: true,
      stay: 0.4
    },
    ...sayPart(2, 9.4),
    {
      screen: 'back_translation',
      part: (page) => button(page, /^Part 3(,|$)/),
      say: 'And part 3.',
      tap: true,
      stay: 0.4
    },
    ...sayPart(3, 11.7),
    {
      screen: 'back_translation',
      part: (page) => button(page, 'Done'),
      say: 'When every part is said, tap Done.',
      tap: true,
      until: (page) => page.getByText('✓ 3 of 3 parts said', { exact: true }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'back_translation',
      part: (page) => page.getByLabel('Or type it — e.g. a word with no English match', { exact: true }).locator('visible=true').first(),
      say: 'Tell the consultant about anything that was hard to say.',
      type: 'Our word for salt is also the word for wisdom',
      stay: 0.5
    },
    {
      screen: 'back_translation',
      part: (page) => button(page, 'Finish the back translation'),
      say: 'Then tap Finish the back translation.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
