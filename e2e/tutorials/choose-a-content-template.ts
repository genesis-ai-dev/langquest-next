// "Choose or make a content template", for coordinators: Lumari records
// FIA's passages of the New Testament. Daniel looks at the other ways to
// divide the Bible, has Lumari translate the whole Bible, and finds where
// to make a template of the organization's own.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const radios = (page: Page) => page.getByRole('radio').locator('visible=true');

export const chooseAContentTemplate: Tutorial = {
  id: 'choose-a-content-template',
  title: 'Choose or make a content template',
  as: 'COORD',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to choose what a language records, and how it is divided into passages. Tap Manage.",
      tap: true,
      until: (page) => button(page, /^Lumari /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Lumari /),
      tap: true,
      until: (page) => button(page, /^Content template/).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'language_home',
      part: (page) => button(page, /^Content template/),
      say: 'Open the language, then Content template.',
      tap: true,
      until: (page) => button(page, 'Which books').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'templates_home',
      part: (page) => words(page, 'FIA passages (English)'),
      say: "This is the one Lumari uses: FIA's passages."
    },
    {
      screen: 'templates_home',
      // The first radio is the one in use.
      part: (page) => [radios(page).nth(1), radios(page).last()],
      say: 'Below it are other ready-made ways to divide the Bible: by book, by chapter, or in sections. Tap one to use it instead.'
    },
    {
      screen: 'templates_home',
      part: (page) => button(page, 'Which books'),
      say: 'Which books says what the team translates. Lumari will translate the whole Bible.',
      tap: true,
      until: (page) => words(page, 'What to translate').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'templates_home',
      part: (page) => id(page, 'primary-action'),
      say: 'It asks the same questions as when the language was added. Keep what stays the same.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'templates_home',
      part: (page) => id(page, 'primary-action'),
      tap: true,
      until: (page) => words(page, 'Whole Bible').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'templates_home',
      part: (page) => words(page, 'Whole Bible'),
      say: 'At the bottom, pick Whole Bible,',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'templates_home',
      part: (page) => id(page, 'primary-action'),
      say: 'and tap Use this. What is recorded already is kept.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1.5
    },
    {
      screen: 'templates_home',
      part: (page) => button(page, 'All content templates'),
      say: 'To make a template of your own, for Bible stories, lessons or songs, open All content templates and tap Template.',
      stay: 2
    }
  ]
};
