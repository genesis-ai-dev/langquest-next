// "Choose reference material", for coordinators: what Lumari's translators
// see beside each passage. Daniel looks over its Bible and guides, offers
// the example guides and FIA's key words too, and finds where to add more.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';

const toggle = (page: Page, name: string) => page.getByRole('switch', { name, exact: true }).locator('visible=true').first();

export const chooseReferenceMaterial: Tutorial = {
  id: 'choose-reference-material',
  title: 'Choose reference material',
  as: 'COORD',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to choose the Bibles and guides your translators see beside each passage. Tap Manage.",
      tap: true,
      until: (page) => button(page, /^Lumari /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Lumari /),
      tap: true,
      until: (page) => button(page, /^Reference material/).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'language_home',
      part: (page) => button(page, /^Reference material/),
      say: 'Open the language, then Reference material.',
      tap: true,
      until: (page) => button(page, 'Add more').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'reference_home',
      part: (page) => button(page, /^Bibles and guides in English/),
      say: 'First, the languages they read. Lumari reads English.'
    },
    {
      screen: 'reference_home',
      part: (page) => toggle(page, 'Berean Standard Bible, read by Frederick Surrey'),
      say: 'Each switch that is on, they see. This Bible has audio and text.'
    },
    {
      screen: 'reference_home',
      part: (page) => toggle(page, 'Example study guides'),
      say: 'Turn on more study guides,',
      tap: true,
      stay: 0.8
    },
    {
      screen: 'reference_home',
      part: (page) => toggle(page, 'FIA key words'),
      say: 'and key words, with what each one means.',
      tap: true,
      until: (page) => button(page, 'Use English').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'reference_home',
      part: (page) => button(page, 'Use English'),
      say: 'They come in several languages. Pick the one the team reads best.',
      tap: true,
      until: (page) => button(page, 'Use English').waitFor({ state: 'hidden', timeout: 10_000 }),
      stay: 1
    },
    {
      screen: 'reference_home',
      part: (page) => button(page, 'Add more'),
      say: 'For another Bible, a guide or a note of your own, tap Add more.',
      stay: 2
    }
  ]
};
