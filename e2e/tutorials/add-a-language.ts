// "Add a language", for admins: Samuel adds Selani to Riverside Translation
// Team. Its name and the languages its translators use, the Bible it
// translates from and how it is split, reference material and checks as
// suggested; inviting its people is its own video.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const NAME = 'Selani';
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const until = (s: string | RegExp, timeout = 10_000) => (page: Page) => words(page, s).waitFor({ timeout });

export const addALanguage: Tutorial = {
  id: 'add-a-language',
  title: 'Add a language',
  as: 'ADMIN',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to add a language to your organization. Tap Manage.",
      tap: true,
      until: until(recordAPassage.names.org!, 30_000),
      stay: 0.8
    },
    {
      screen: 'org_home',
      part: (page) => words(page, 'New language or cluster'),
      say: "Your organization's languages are here. Tap New language.",
      tap: true,
      until: until('6 steps'),
      stay: 0.8
    },
    {
      screen: 'new_language',
      // The six steps, from the first to the last with what is under it: the box the two are in.
      part: (page) => page.locator('div').filter({ has: page.getByText('Language', { exact: true }) }).filter({ has: page.getByText('People', { exact: true }) }).filter({ visible: true }).last(),
      say: 'There are six steps: its name, what it translates, how that is split into passages, reference material, how recordings get checked, and its people.'
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Start.',
      tap: true,
      until: (page) => page.getByLabel('Its name', { exact: true }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'new_language',
      part: (page) => page.getByLabel('Its name', { exact: true }).locator('visible=true').first(),
      say: "Type the language's name. If it shows in the language list, tap it. If not, go on, and link it later.",
      type: NAME,
      stay: 1.5
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Continue.',
      tap: true,
      until: until(/translators use\?$/),
      stay: 0.6
    },
    {
      screen: 'new_language',
      part: (page) => words(page, /translators use\?$/),
      say: 'Next, the languages your translators use. The ones you need are already chosen.'
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Continue.',
      tap: true,
      until: until(/What will .* translate\?/),
      stay: 0.6
    },
    {
      screen: 'new_language',
      part: (page) => words(page, 'The Bible'),
      say: `What will ${NAME} translate? Tap The Bible.`,
      tap: true,
      stay: 0.4
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: 'Then Continue.',
      tap: true,
      until: until('Bibles number verses differently'),
      stay: 0.6
    },
    {
      screen: 'new_language',
      part: (page) => words(page, 'Bibles number verses differently'),
      say: 'Bibles number some verses differently, so LangQuest needs to know which Bible your team uses.'
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Continue.',
      tap: true,
      until: until("Find your Bible's numbering"),
      stay: 0.6
    },
    {
      screen: 'new_language',
      part: (page) => words(page, 'Pick your Bible'),
      say: 'There are three ways to find it. Tap Pick your Bible.',
      tap: true,
      until: until('Which Bible do you translate from?'),
      stay: 0.6
    },
    {
      screen: 'new_language',
      part: (page) => page.getByPlaceholder('NIV, Reina-Valera, Luther…').locator('visible=true').first(),
      say: 'Which Bible does your team translate from? Type its name.',
      type: 'World English',
      stay: 0.8
    },
    {
      screen: 'new_language',
      part: (page) => words(page, 'World English Bible'),
      say: 'And tap it.',
      tap: true,
      stay: 0.4
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Continue.',
      tap: true,
      until: until('How should the Bible be divided?'),
      stay: 0.6
    },
    {
      screen: 'new_language',
      part: (page) => words(page, 'FIA passages'),
      say: "Then choose how the Bible is split into passages. FIA passages go with FIA's study guides.",
      tap: true,
      stay: 0.4
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Continue.',
      tap: true,
      until: until(/What will help .*’s team\?/),
      stay: 0.8
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: 'Then Continue again, to keep the Bibles and study guides that are suggested.',
      tap: true,
      until: until('How will recordings get checked?'),
      stay: 0.6
    },
    {
      screen: 'new_language',
      part: (page) => words(page, 'Standard Bible Flow'),
      say: 'Then, how recordings get checked. Standard Bible Flow is a good start.'
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Continue.',
      tap: true,
      until: until(/’s checks$/),
      stay: 0.8
    },
    {
      screen: 'new_language',
      part: (page) => [words(page, 'Peer check'), words(page, 'Final approval')],
      say: `These are ${NAME}'s checks, in order. You can change them now, or later.`
    },
    {
      screen: 'new_language',
      part: (page) => id(page, 'primary-action'),
      say: `Tap Add ${NAME}.`,
      tap: true,
      until: until('Time to invite people', 60_000),
      stay: 1
    },
    {
      screen: 'new_language',
      part: (page) => [words(page, 'Time to invite people'), button(page, 'Done')],
      say: `${NAME} is added. Last, invite its people, now or later.`,
      stay: 2
    }
  ]
};
