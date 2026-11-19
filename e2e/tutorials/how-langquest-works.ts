// "How LangQuest works", for everyone: the whole app in one video, with no
// taps taught. Samuel goes through what an organization holds (languages,
// their people), the three choices each language has (what to translate, what
// helps, how it is checked: ready-made, and each can be changed), the map
// down to one passage, and the path that its language chose for it.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name }).locator('visible=true').first();
const shown = (s: string | RegExp, timeout = 30_000) => (page: Page) => words(page, s).waitFor({ timeout });
const radios = (page: Page) => page.getByRole('radio').locator('visible=true');
const switches = (page: Page) => page.getByRole('switch').locator('visible=true');

export const howLangQuestWorks: Tutorial = {
  id: 'how-langquest-works',
  title: 'How LangQuest works',
  as: 'ADMIN',
  tune: true,
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      say: 'This is LangQuest. A team uses it to translate with their voices: the Bible, stories, books, or anything their community needs.',
      stay: 0.4
    },
    {
      screen: 'my_work',
      part: (page) => tab(page, 'Manage'),
      say: 'A team works in an organization.',
      tap: true,
      until: shown(recordAPassage.names.org!),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Lumari /),
      say: 'An organization has languages. Each language is its own work.',
      tap: true,
      until: (page) => button(page, /^Content template/).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'language_home',
      part: (page) => words(page, 'People'),
      say: 'Each language has its people.',
      tap: true,
      until: shown('Grace'),
      stay: 0.6
    },
    {
      screen: 'members_list',
      say: 'Each person has a role. Admins and leads set up the work. Translators record. Reviewers check. Followers see the progress.',
      stay: 0.4
    },
    {
      screen: 'members_list',
      part: (page) => button(page, 'Back'),
      tap: true,
      until: (page) => button(page, /^Content template/).waitFor({ timeout: 30_000 }),
      stay: 0.4
    },
    {
      screen: 'language_home',
      part: (page) => [button(page, /^Content template/), button(page, /^Review flow/)],
      say: 'Each language also has three choices. Each choice has good ready-made options, and you can change every one.'
    },
    {
      screen: 'language_home',
      part: (page) => button(page, /^Content template/),
      say: 'First, what to translate.',
      tap: true,
      until: (page) => button(page, 'Which books').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'templates_home',
      part: (page) => [radios(page).first(), radios(page).last()],
      say: 'There are ready-made ways to divide the Bible into passages.'
    },
    {
      screen: 'templates_home',
      part: (page) => button(page, /^All content templates/),
      say: 'Or make your own, for stories, lessons, songs or other books.'
    },
    {
      screen: 'templates_home',
      part: (page) => button(page, 'Back'),
      tap: true,
      until: (page) => button(page, /^Reference material/).waitFor({ timeout: 30_000 }),
      stay: 0.4
    },
    {
      screen: 'language_home',
      part: (page) => button(page, /^Reference material/),
      say: 'Second, what helps the translators.',
      tap: true,
      until: (page) => button(page, 'Add more').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'reference_home',
      part: (page) => [switches(page).first(), switches(page).last()],
      say: 'Bibles, study guides and key words are ready to use. Turn each one on or off.'
    },
    {
      screen: 'reference_home',
      part: (page) => button(page, 'Add more'),
      say: 'Or add your own.'
    },
    {
      screen: 'reference_home',
      part: (page) => button(page, 'Back'),
      tap: true,
      until: (page) => button(page, /^Review flow/).waitFor({ timeout: 30_000 }),
      stay: 0.4
    },
    {
      screen: 'language_home',
      part: (page) => button(page, /^Review flow/),
      say: 'Third, how the work is checked.',
      tap: true,
      until: shown('All review flows'),
      stay: 0.6
    },
    {
      screen: 'flows_home',
      // The card itself, not Edit's row in it: in French and Spanish the card's name takes four lines, the card is
      // then over a third of the screen, and the light stayed on Edit's row (the frame check held both films).
      part: (page) => button(page, 'Edit').locator('../..'),
      say: 'A ready-made set of checks is in place.'
    },
    {
      screen: 'flows_home',
      part: (page) => [radios(page).nth(1), radios(page).last()],
      say: 'Pick a different set. Or change the checks, their order, and who does each one.'
    },
    {
      screen: 'flows_home',
      part: (page) => button(page, 'Back'),
      tap: true,
      until: (page) => button(page, /^Review flow/).waitFor({ timeout: 30_000 }),
      stay: 0.4
    },
    {
      screen: 'language_home',
      part: (page) => tab(page, 'Map'),
      say: 'Now the work itself.',
      tap: true,
      until: (page) => button(page, /^Lumari: /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'status_home',
      part: (page) => button(page, /^Lumari: /),
      say: 'The map shows how far each language has come.',
      tap: true,
      until: shown('Luke'),
      stay: 0.6
    },
    {
      screen: 'map_home',
      part: (page) => button(page, /^Luke/),
      say: 'A language has books.',
      tap: true,
      until: (page) => page.getByText(/^Luke 1:1–4/).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.6,
      // The book opens on its first passages, none started. The video cuts to the passages the team works on.
      offCamera: async (page) => {
        const passage = page.getByText(/^Luke 14:25–35/).first();
        for (let i = 0; i < 4 && !(await passage.count()); i++) {
          await button(page, /^Show \d+ more/).click();
          await page.waitForTimeout(400);
        }
        await passage.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(600);
      }
    },
    {
      screen: 'book_map',
      say: 'A book has passages. Each passage shows where it is, and who it waits for.'
    },
    {
      screen: 'book_map',
      part: (page) => page.getByText(/^Luke 14:25–35/).locator('visible=true').first(),
      say: 'A passage follows the path its language chose.',
      tap: true,
      stay: 1
    },
    {
      screen: 'passage_record',
      // Nothing lit: Record and Done lit as one box cut the player's handle, which stands at the box's left edge.
      say: 'A translator studies the passage, records it, and finishes it.'
    },
    {
      screen: 'passage_record',
      part: (page) => [button(page, /^Peer check/), button(page, /^Back translation · check it/)],
      say: 'Then the team checks it, one check after another. Reviewers give feedback, and the translator answers.'
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Final approval/),
      say: 'After the final approval, the passage is done.'
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, 'Back'),
      tap: true,
      until: (page) => tab(page, /Work$/).waitFor({ timeout: 30_000 }),
      stay: 0.4
    },
    {
      screen: 'book_map',
      part: (page) => tab(page, /Work$/),
      tap: true,
      until: (page) => button(page, 'Live').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'my_work',
      part: (page) => button(page, 'Live'),
      say: 'LangQuest works without internet. The phone keeps the work, and sends it when the internet comes back.'
    },
    {
      screen: 'my_work',
      say: "LangQuest is on Android, on iPhone, and in a web browser. The video 'Create your account and look around' shows how to start. The video 'The path of a passage' follows a passage to its last check. Both videos are linked in the description below.",
      videos: ['create-your-account-and-look-around', 'the-path-of-a-passage'],
      stay: 2
    }
  ]
};
