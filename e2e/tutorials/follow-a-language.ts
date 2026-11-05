// "Follow a language on the map", for coordinators: how far Lumari has come,
// book by book, and which passages are in review. Daniel reads Progress,
// opens Lumari's map, and filters it to what waits on reviewers.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const lumari = (page: Page) => button(page, /^Lumari: /);

export const followALanguage: Tutorial = {
  id: 'follow-a-language',
  title: 'Follow a language on the map',
  as: 'COORD',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Map' }).locator('visible=true').first(),
      say: "Here's how to see how far each language has come. Tap Map.",
      tap: true,
      until: (page) => lumari(page).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'status_home',
      part: lumari,
      say: 'Each language has a bar. The further its passages have come through the checks, the darker the band.'
    },
    {
      screen: 'status_home',
      part: lumari,
      say: 'Tap a language to see its map.',
      tap: true,
      until: (page) => words(page, 'Luke').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'map_home',
      part: (page) => button(page, /^Luke/),
      say: 'Each book shows how many of its passages are recorded.'
    },
    {
      screen: 'map_home',
      part: (page) => button(page, 'Filter'),
      say: 'To see only some passages, tap Filter.',
      tap: true,
      until: (page) => button(page, /^In review/).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'map_home',
      part: (page) => [button(page, /^Feedback waiting/), button(page, /^Not recorded/)],
      say: 'Feedback waiting, with reviewers, in review, done, or not recorded yet.'
    },
    {
      screen: 'map_home',
      part: (page) => button(page, /^In review/),
      say: 'Tap In review.',
      tap: true,
      stay: 1.2
    },
    {
      screen: 'map_home',
      part: (page) => button(page, /^Luke/),
      say: 'Now the map counts only the passages in review. Open the book.',
      tap: true,
      until: (page) => page.getByText(/^Luke 14:25–35/).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'book_map',
      part: (page) => page.getByText(/^Luke 14:25–35/).locator('visible=true').first(),
      say: 'Each passage says where it stands, and who it waits on. Tap one to open it.',
      stay: 2
    }
  ]
};
