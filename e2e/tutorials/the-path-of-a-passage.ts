// "The path of a passage", for everyone: the second general video, with no
// taps taught. Samuel opens Luke in Lumari and goes from passage to passage,
// each one further along the path: not started, recording, waiting on a
// check, waiting on the translator to answer feedback, between two checks,
// done. It says who does each part (Daniel asks, Grace translates, Ruth
// checks), and ends back on the map.
import type { Page } from 'playwright';
import type { Step, Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';

const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name }).locator('visible=true').first();
/** A passage's row on the book's map (its label starts with its name and where it is). */
const row = (page: Page, ref: string) => button(page, new RegExp(`^${ref}\\. `));
/** Opens a passage from the book's map, with what is said on the way in. */
const open = (ref: string, say: string): Step => ({
  screen: 'book_map',
  part: (page) => row(page, ref),
  say,
  tap: true,
  until: (page) => button(page, /^1\. Record/).waitFor({ timeout: 30_000 }),
  stay: 0.8
});
/** Back from a passage to the book's map. */
const back: Step = {
  screen: 'passage_record',
  part: (page) => button(page, 'Back'),
  tap: true,
  until: (page) => row(page, 'Luke 14:25–35').waitFor({ timeout: 30_000 }),
  stay: 0.4
};

export const thePathOfAPassage: Tutorial = {
  id: 'the-path-of-a-passage',
  title: 'The path of a passage',
  as: 'ADMIN',
  tune: true,
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      say: 'Every passage in LangQuest takes the same path, from not started to done. This video follows that path, and shows who does each part.',
      stay: 0.4
    },
    {
      screen: 'my_work',
      part: (page) => tab(page, 'Map'),
      tap: true,
      until: (page) => button(page, /^Lumari: /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'status_home',
      part: (page) => button(page, /^Lumari: /),
      tap: true,
      until: (page) => page.getByText('Luke', { exact: true }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'map_home',
      part: (page) => button(page, /^Luke/),
      say: 'This team translates the book of Luke. Daniel leads the work, Grace translates, and Ruth checks.',
      tap: true,
      until: (page) => page.getByText(/^Luke 1:1–4/).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.6,
      // The book opens on its first passages, none started. The video cuts to the passages the team works on.
      offCamera: async (page) => {
        const passage = page.getByText(/^Luke 14:15–24/).first();
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
      say: 'Each passage shows where it is on the path.'
    },
    open('Luke 13:31–35', 'A passage starts as not started.'),
    {
      screen: 'passage_record',
      part: (page) => button(page, /^1\. Record/),
      say: 'Daniel asked Grace to translate this one.'
    },
    {
      screen: 'passage_record',
      // Done is a button only once the passage is recorded: until then its line of words stands for it.
      part: (page) => [button(page, /^1\. Record/), page.getByText('Then ask for the peer check').locator('visible=true').first()],
      say: 'Her part has two steps: record, then done.'
    },
    {
      screen: 'passage_record',
      part: (page) => [button(page, /^Peer check/), button(page, /^Community check/)],
      say: 'Then the team checks her work. The path shows each check, and who does it.'
    },
    back,
    open('Luke 14:1–14', 'Here, Grace has started.'),
    {
      screen: 'passage_record',
      part: (page) => button(page, /^1\. Record/),
      say: 'She studies the passage first. Then she records it in her own language, one part at a time. LangQuest keeps the parts as a draft.'
    },
    back,
    open('Luke 15:11–32', 'This passage is recorded.'),
    {
      screen: 'passage_record',
      // Done alone: lit with Record, the box's edge would cut the player's handle, which stands at the start.
      part: (page) => button(page, /^2\. Done/),
      say: 'Grace finished her first version, and asked Ruth for the first check. Now the team can hear it.'
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Peer check/),
      say: 'The passage waits on Ruth.'
    },
    back,
    open('Luke 14:15–24', 'Ruth has checked this passage.'),
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Peer check/),
      say: 'She listened, and asked for changes.'
    },
    {
      screen: 'passage_record',
      part: (page) => page.getByText(/^Waiting on Grace to answer/).locator('visible=true').first(),
      say: 'Now the passage waits on Grace again. She answers the feedback, or records a new version.'
    },
    back,
    open('Luke 14:25–35', 'This passage is further along.'),
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Peer check/),
      say: 'The peer check looks good, so the next check opens.'
    },
    {
      screen: 'passage_record',
      part: (page) => [button(page, /^Back translation · make it/), button(page, /^Back translation · check it/)],
      say: 'Next is the back translation. A teammate says the passage back in a language the consultant knows. That shows what the recording means.'
    },
    {
      screen: 'passage_record',
      part: (page) => [button(page, /^Community check/), button(page, /^Final approval/)],
      say: 'Then come the community check, the consultant check, and the final approval. Each language chooses its own checks, and their order.'
    },
    back,
    open('Luke 16:19–31', 'And this passage has every check.'),
    {
      screen: 'passage_record',
      part: (page) => button(page, /^Final approval/),
      say: 'After the final approval, the passage is done.'
    },
    back,
    {
      screen: 'book_map',
      part: (page) => [row(page, 'Luke 14:15–24'), row(page, 'Luke 15:11–32')],
      say: 'So the map always shows where each passage is, and who it waits for.'
    },
    {
      screen: 'book_map',
      part: (page) => button(page, 'Back'),
      tap: true,
      until: (page) => button(page, /^Luke/).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'map_home',
      part: (page) => button(page, /^Luke/),
      say: 'And each book shows how far it has come.'
    },
    {
      screen: 'map_home',
      say: 'That is the path of a passage. The next videos show each part, step by step.',
      stay: 2
    }
  ]
};
