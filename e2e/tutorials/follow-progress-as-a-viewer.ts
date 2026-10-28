// "Follow progress as a viewer", for partners and churches that watch the
// work: Joseph's home is Progress (every language's bar), then Lumari's map,
// a finished passage, and its recording.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';
import { findOnMap } from './passage-nav';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const lumari = (page: Page) => button(page, /^Lumari: /);
const [find, open] = findOnMap('Luke 16:19–31', 'Luke 16:19');

export const followProgressAsAViewer: Tutorial = {
  id: 'follow-progress-as-a-viewer',
  title: 'Follow progress as a viewer',
  as: 'VIEW',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'status_home',
      part: (page) => [words(page, 'recorded'), words(page, 'done'), words(page, 'with reviewers')],
      say: "Here's how to follow a team's work when you can view it. Progress is your home. It shows how much is recorded and done, in every language."
    },
    {
      screen: 'status_home',
      part: (page) => page.getByRole('progressbar', { name: /^Recorded: \d+ of \d+, / }).locator('visible=true').first(),
      say: 'Each language has a bar. The further a passage has come through its checks, the darker its part of the bar.'
    },
    {
      screen: 'status_home',
      part: lumari,
      say: 'Tap a language to open its map.',
      tap: true,
      until: (page) => button(page, /^Luke\. /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'map_home',
      part: (page) => button(page, /^Luke\. /),
      say: 'Each book shows how many of its passages are recorded.'
    },
    { ...find!, say: 'To find a passage, type where it is.' },
    { ...open!, say: 'Tap it.' },
    {
      screen: 'passage_record',
      part: (page) => [button(page, /^1\. Record\./), button(page, /^2\. Done\./)],
      say: 'A passage shows how far it has come,'
    },
    {
      screen: 'passage_record',
      part: (page) => [button(page, /^Peer check, /), button(page, /^Final approval, /)],
      say: 'and each check, with who did it.'
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, /^1\. Record\./),
      say: 'Tap the recording to hear it.',
      tap: true,
      until: (page) => button(page, 'Play Version 1').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'version_detail',
      part: (page) => button(page, 'Play Version 1'),
      say: 'Tap play to listen. You can look and listen, but not change anything.',
      stay: 1.5
    }
  ]
};
