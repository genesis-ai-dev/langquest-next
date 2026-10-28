// "Versions and history", for translators: Luke 16:1-15 has Version 1, and
// Daniel set its Community check aside. Grace opens its versions and its
// history, where a step can be undone, and opens Version 1.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';
import { openOnMap } from './passage-nav';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();

export const versionsAndHistory: Tutorial = {
  id: 'versions-and-history',
  title: 'Versions and history',
  as: 'TRANS',
  names: recordAPassage.names,
  steps: [
    ...openOnMap('Luke 16:1–15', 'Luke 16', "Here's how to see a passage's versions, and everything that happened to it. Find the passage on the Map, and open it."),
    {
      screen: 'passage_record',
      part: (page) => button(page, 'Versions and history'),
      say: 'Tap Versions and history.',
      tap: true,
      until: (page) => button(page, 'Open Version 1').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'version_detail',
      part: (page) => button(page, 'Open Version 1'),
      say: 'Each finished version is here, the newest first.'
    },
    {
      screen: 'version_detail',
      part: (page) => words(page, 'New version'),
      say: 'New version starts another recording. The reviews so far stay with the version they heard.'
    },
    {
      screen: 'version_detail',
      part: (page) => words(page, /^History/),
      say: 'History lists everything that happened to this passage, and who did it. Tap it.',
      tap: true,
      until: (page) => words(page, 'Community check set aside').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'version_detail',
      part: (page) => [words(page, 'Community check set aside'), page.getByText(/No community meeting this month/).locator('visible=true').first()],
      say: 'Here, Daniel set the Community check aside, and said why.'
    },
    {
      screen: 'version_detail',
      part: (page) => button(page, 'Undo'),
      say: 'If a step should not have happened, it can be undone here.'
    },
    {
      screen: 'version_detail',
      part: (page) => button(page, /^Version 1 published/),
      say: 'Tap a version to open it.',
      tap: true,
      until: (page) => page.getByRole('heading', { name: 'Version 1' }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 2
    }
  ]
};
