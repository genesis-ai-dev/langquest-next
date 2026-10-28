// "Get a language ready", for admins: Kitara was added with nothing chosen
// yet. Samuel answers its four questions from My Work: what its translators
// record, what helps them, who checks, and who translates.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();

export const getALanguageReady: Tutorial = {
  id: 'get-a-language-ready',
  title: 'Get a language ready',
  as: 'ADMIN',
  language: 'B',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByText(/^Get Kitara ready · /).locator('visible=true').first(),
      say: "Here's how to get a new language ready for its translators. My Work asks four questions, one at a time."
    },
    {
      screen: 'my_work',
      part: (page) => button(page, 'Choose'),
      say: 'Tap Choose.',
      tap: true,
      until: (page) => words(page, 'The Bible').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'get_ready',
      part: (page) => words(page, 'The Bible'),
      say: 'First, what will they record? The Bible.',
      tap: true,
      stay: 0.5
    },
    {
      screen: 'get_ready',
      part: (page) => id(page, 'primary-action'),
      tap: true,
      until: (page) => words(page, 'Like most English Bibles').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'get_ready',
      part: (page) => words(page, 'Like most English Bibles'),
      say: 'Which Bible do they translate from? Its verses will match.',
      tap: true,
      stay: 0.5
    },
    {
      screen: 'get_ready',
      part: (page) => id(page, 'primary-action'),
      tap: true,
      until: (page) => words(page, 'FIA passages (English)').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'get_ready',
      part: (page) => words(page, 'FIA passages (English)'),
      say: 'And how it is cut into passages. What Lumari uses is already picked.'
    },
    {
      screen: 'get_ready',
      part: (page) => id(page, 'primary-action'),
      tap: true,
      until: (page) => words(page, '2 of 4').waitFor({ timeout: 30_000 }),
      stay: 1
    },
    {
      screen: 'get_ready',
      part: (page) => id(page, 'primary-action'),
      say: 'Second, what will help them: the languages of their Bibles and guides, and which ones they see.',
      tap: true,
      until: (page) => words(page, 'What will help them?').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'get_ready',
      part: (page) => id(page, 'primary-action'),
      tap: true,
      until: (page) => words(page, 'Who checks the recordings?').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'get_ready',
      part: (page) => words(page, 'Suggested'),
      say: 'Third, who checks the recordings. The suggested checks are a good start.'
    },
    {
      screen: 'get_ready',
      part: (page) => id(page, 'primary-action'),
      tap: true,
      until: (page) => words(page, 'Invite your translators').waitFor({ timeout: 30_000 }),
      stay: 1
    },
    {
      screen: 'get_ready',
      part: (page) => words(page, 'Ask them to scan this'),
      say: 'Last, invite the translators. They scan this code, or you share a link.'
    },
    {
      screen: 'get_ready',
      part: (page) => words(page, 'Done'),
      say: 'Tap Done. Kitara is ready.',
      tap: true,
      until: (page) => page.getByRole('tab', { name: 'Work' }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
