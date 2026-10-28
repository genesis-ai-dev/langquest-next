// "Do a check", for reviewers: Grace asked Ruth for the Peer check of Luke
// 15:11-32. Ruth listens, adds a note at a moment, decides it needs changes,
// and says what should change.
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

export const doACheck: Tutorial = {
  id: 'do-a-check',
  title: 'Do a check',
  as: 'REV',
  names: recordAPassage.names,
  // Ruth's feedback, said into the microphone.
  speech: ['check-feedback.wav'],
  steps: [
    {
      screen: 'my_work',
      part: (page) => button(page, /^Check Luke 15:11–32/),
      say: "Here's how to do a check. When someone asks you to check their work, it shows on My Work. Tap it to start.",
      tap: true,
      until: (page) => button(page, 'Listen, step 1 of 2').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'review_capture',
      part: (page) => [button(page, 'Listen, step 1 of 2'), button(page, 'Decide, step 2 of 2')],
      say: 'A check has two steps. First you listen, then you decide.'
    },
    {
      screen: 'review_capture',
      part: (page) => page.getByRole('button', { name: /^Play/ }).locator('visible=true').first(),
      say: 'Listen to all of it first. Tap play.',
      tap: true,
      stay: 6
    },
    {
      screen: 'review_capture',
      part: (page) => button(page, 'Add a note at this moment'),
      say: 'When you notice something, tap Note. Your note is kept at that moment in the recording.',
      tap: true,
      until: (page) => page.getByText(/^A note at /).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'review_capture',
      part: (page) => page.getByLabel('Or type it', { exact: true }).locator('visible=true').first(),
      say: 'Say it, or type it.',
      type: 'Say "his share" more clearly',
      stay: 0.5
    },
    {
      screen: 'review_capture',
      part: (page) => button(page, 'Add a note'),
      say: 'Then tap Add a note.',
      tap: true,
      until: (page) => page.getByText('With your review', { exact: true }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 1
    },
    {
      screen: 'review_capture',
      part: (page) => id(page, 'primary-action'),
      say: "When you've heard it all, tap Next.",
      tap: true,
      until: (page) => button(page, 'Needs changes').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'review_capture',
      part: (page) => [button(page, 'Looks good'), button(page, 'Needs changes')],
      say: 'Now decide. Looks good sends it on to the next check. Needs changes asks Grace to fix something.'
    },
    {
      screen: 'review_capture',
      part: (page) => button(page, 'Needs changes'),
      say: 'This one needs a change. Tap Needs changes.',
      tap: true,
      until: (page) => page.getByText('What should change?', { exact: true }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'review_capture',
      part: (page) => button(page, 'Tap and speak'),
      say: 'Say what should change, in your own words. Grace will hear it.',
      tap: true,
      speak: 0
    },
    {
      screen: 'review_capture',
      atSpeech: 6.6,
      part: (page) => button(page, 'Stop recording'),
      say: "Tap stop when you've finished.",
      tap: true,
      until: (page) => button(page, 'Record again').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'review_capture',
      part: (page) => id(page, 'primary-action'),
      say: 'Then tap Send feedback.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
