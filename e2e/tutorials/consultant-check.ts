// "Consultant check", for consultants: Luke 15:1-10 waits at the Consultant
// check, which must pass. Ruth listens, answers its questions (one of them
// required), and decides.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { openOnMap } from './passage-nav';

const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true }).locator('visible=true').first();
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();

export const consultantCheck: Tutorial = {
  id: 'consultant-check',
  title: 'Consultant check',
  as: 'REV',
  names: recordAPassage.names,
  steps: [
    ...openOnMap('Luke 15:1–10', 'Luke 15:1', "Here's how to do a consultant check. Open the passage."),
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Do the consultant (check|review)$/i),
      say: 'Tap Do the consultant check.',
      tap: true,
      until: (page) => button(page, 'Listen, step 1 of 3').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'review_capture',
      part: (page) => [button(page, 'Listen, step 1 of 3'), button(page, 'Decide, step 3 of 3')],
      say: 'It has three steps: listen, answer its questions, and decide.'
    },
    {
      screen: 'review_capture',
      part: (page) => page.getByRole('button', { name: /^Play/ }).locator('visible=true').first(),
      say: 'Listen to all of it first.',
      tap: true,
      stay: 6
    },
    {
      screen: 'review_capture',
      part: (page) => page.getByText(/^Back translation to compare$/i).locator('visible=true').first(),
      say: 'The back translation is here too, to compare its meaning with the source.'
    },
    {
      screen: 'review_capture',
      part: (page) => id(page, 'primary-action'),
      say: 'Then tap Next.',
      tap: true,
      until: (page) => page.getByLabel('Question 1 of 4', { exact: true }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'review_capture',
      part: (page) => radio(page, '4'),
      say: 'Answer each question. This one goes from one to five.',
      tap: true,
      stay: 0.4
    },
    {
      screen: 'review_capture',
      part: (page) => id(page, 'primary-action'),
      say: 'Next question.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'review_capture',
      part: (page) => radio(page, 'Yes'),
      say: 'This one is yes or no.',
      tap: true,
      stay: 0.4
    },
    {
      screen: 'review_capture',
      part: (page) => id(page, 'primary-action'),
      tap: true,
      stay: 0.6
    },
    {
      screen: 'review_capture',
      part: (page) => button(page, 'Skip this question'),
      say: 'You can skip a question that is not required.',
      tap: true,
      until: (page) => words(page, 'Required').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'review_capture',
      part: (page) => words(page, 'Required'),
      say: 'A required question needs an answer before you decide.'
    },
    {
      screen: 'review_capture',
      part: (page) => radio(page, 'Yes'),
      tap: true,
      stay: 0.4
    },
    {
      screen: 'review_capture',
      part: (page) => id(page, 'primary-action'),
      say: 'Then tap Next.',
      tap: true,
      until: (page) => button(page, 'Looks good').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'review_capture',
      part: (page) => button(page, 'Looks good'),
      say: 'This check must pass before the next ones start. It looks good, so tap Looks good.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
