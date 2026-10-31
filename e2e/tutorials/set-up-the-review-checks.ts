// "Set up the review checks", for admins: Samuel opens Lumari's review flow,
// its checks in order, and one check's people, questions and what is on the
// checker's screen, and adds a question to the Peer check.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const until = (s: string | RegExp, timeout = 10_000) => (page: Page) => words(page, s).waitFor({ timeout });

export const setUpTheReviewChecks: Tutorial = {
  id: 'set-up-the-review-checks',
  title: 'Set up the review checks',
  as: 'ADMIN',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to set up how recordings get checked. Tap Manage.",
      tap: true,
      until: until(recordAPassage.names.org!, 30_000),
      stay: 0.8
    },
    {
      screen: 'org_home',
      part: (page) => words(page, 'Lumari'),
      say: 'Tap the language.',
      tap: true,
      until: until('Review flow', 30_000),
      stay: 0.8
    },
    {
      screen: 'language_home',
      part: (page) => words(page, 'Review flow'),
      say: 'Then Review flow.',
      tap: true,
      until: until('All review flows', 30_000),
      stay: 0.8
    },
    {
      screen: 'flows_home',
      // Lumari's own flow: the card with Edit in it (the ready-made ones under it are the radios).
      part: (page) => button(page, 'Edit').locator('..'),
      say: "These are Lumari's checks. Under them are other ready-made ways to check. To change Lumari's own, tap Edit.",
    },
    {
      screen: 'flows_home',
      part: (page) => words(page, 'Edit'),
      tap: true,
      until: (page) => button(page, 'Add a check').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'flow_editor',
      part: (page) => [button(page, '1. Peer check'), button(page, '4. Final approval')],
      say: 'A recording goes through these checks, in order. Drag a check by its handle to move it.'
    },
    {
      screen: 'flow_editor',
      part: (page) => page.getByRole('switch', { name: 'Consultant check must pass before the next steps' }).locator('visible=true').first(),
      say: 'A lock means the check must pass before the next ones start.'
    },
    {
      screen: 'flow_editor',
      part: (page) => button(page, '1. Peer check'),
      say: 'Tap a check to set it up.',
      tap: true,
      until: (page) => page.getByRole('button', { name: /^Questions / }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'flow_editor',
      part: (page) => [page.getByRole('button', { name: /^People / }).locator('visible=true').first(), page.getByRole('button', { name: /^Questions / }).locator('visible=true').first()],
      say: 'Choose who does it, and questions for them to answer.'
    },
    {
      screen: 'flow_editor',
      part: (page) => [words(page, 'On their screen'), words(page, 'Earlier versions')],
      say: 'And what they see while they check: the Bible, guides, key words, notes, and earlier versions.'
    },
    {
      screen: 'flow_editor',
      part: (page) => page.getByRole('button', { name: /^Questions / }).locator('visible=true').first(),
      say: 'To add a question, tap Questions.',
      tap: true,
      until: until('Add a question'),
      stay: 0.6
    },
    {
      screen: 'flow_editor',
      part: (page) => words(page, 'Add a question'),
      say: 'Then Add a question.',
      tap: true,
      until: (page) => page.getByPlaceholder('The question').locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'flow_editor',
      part: (page) => page.getByPlaceholder('The question').locator('visible=true').first(),
      say: 'Type it.',
      type: 'Is it clear to a child?',
      stay: 0.5
    },
    {
      screen: 'flow_editor',
      part: (page) => [button(page, 'Text'), button(page, '1–5')],
      say: 'Choose how they answer: in their own words, yes or no, or one to five.'
    },
    {
      screen: 'flow_editor',
      part: (page) => words(page, 'Required'),
      say: 'Turn on Required if they must answer it.'
    },
    {
      screen: 'flow_editor',
      part: (page) => button(page, 'Save'),
      say: 'Tap Save.',
      tap: true,
      until: (page) => words(page, 'Is it clear to a child?').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'flow_editor',
      part: (page) => words(page, 'Is it clear to a child?'),
      say: 'Whoever does the Peer check now answers it.',
      stay: 2
    }
  ]
};
