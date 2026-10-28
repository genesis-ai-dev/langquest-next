// "Answer feedback", for translators: Ruth's Peer check of Luke 14:15-24 says
// verse 18 is too fast. Grace hears the feedback, records Part 2 again more
// slowly, and sends Version 2 back to the check. Keeping it as it is, with a
// reason, is shown but not chosen.
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, divider, id, shows } from './workspace';

export const answerFeedback: Tutorial = {
  id: 'answer-feedback',
  title: 'Answer feedback',
  as: 'TRANS',
  names: recordAPassage.names,
  // Part 2 (verses 17 and 18) said again, slower.
  speech: ['needs-2-again.wav'],
  steps: [
    {
      screen: 'my_work',
      part: (page) => button(page, /^\d+ more for you$/),
      say: "Here's how to answer feedback. Tap here to see all your work.",
      tap: true,
      stay: 0.8
    },
    {
      screen: 'my_work',
      part: (page) => button(page, /Feedback to hear$/),
      say: 'Feedback to hear means a check came back with changes to make. Tap it.',
      tap: true,
      until: (page) => id(page, 'primary-action').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Hear the feedback.',
      tap: true,
      until: (page) => button(page, 'Record a fix').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'review_detail',
      part: (page) => page.getByRole('button', { name: /^Play .*'s feedback/ }).locator('visible=true').first(),
      say: 'Tap play to hear what Ruth said.',
      tap: true,
      stay: 6
    },
    {
      screen: 'review_detail',
      part: (page) => button(page, 'Hear Version 1, the version they heard'),
      say: 'You can also hear the version Ruth heard.'
    },
    {
      screen: 'review_detail',
      part: (page) => button(page, 'Keep it, say why'),
      say: "If you think it's right as it is, tap Keep it, and say why. Ruth and the team will hear your reason."
    },
    {
      screen: 'review_detail',
      part: (page) => button(page, 'Record a fix'),
      say: 'To fix it, tap Record a fix.',
      tap: true,
      until: (page) => shows(page, 'record-button'),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => divider(page),
      say: 'Your new version starts with the parts you already have. Drag the divider up to see them.',
      drag: { by: { x: 0, y: -230 } },
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Record Part 2 again'),
      say: 'Verse eighteen is in Part 2. Tap it to say it again.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'record-button'),
      say: 'Tap the red button and speak, a little slower this time.',
      tap: true,
      speak: 0
    },
    {
      screen: 'workspace',
      atSpeech: 15.6,
      part: (page) => id(page, 'record-button'),
      say: "Tap stop when you've finished.",
      tap: true,
      until: (page) => page.getByText('Stopped', { exact: true }).waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Done'),
      say: 'Then tap the tick to keep it.',
      tap: true,
      until: (page) => shows(page, 'publish-button'),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'publish-button'),
      say: 'Tap Done to finish Version 2.',
      tap: true,
      until: (page) => page.getByText('Next check', { exact: true }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => page.getByText(/^Answers the Peer check feedback from/).locator('visible=true').first(),
      say: 'Version 2 answers Ruth\'s feedback.'
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap here to send it back to the Peer check.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
