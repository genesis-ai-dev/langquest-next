// "Write or adapt a study guide", for coordinators: Luke 13:10-17 has no
// guide yet. Daniel writes one: a title, its verses, FIA's six steps, and
// the first step's words, then publishes it for Lumari's team.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const box = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true }).locator('visible=true').first();

export const writeAStudyGuide: Tutorial = {
  id: 'write-a-study-guide',
  title: 'Write or adapt a study guide',
  as: 'COORD',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to write a study guide for a passage. Tap Manage.",
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
      say: 'Open the language, then Reference material,',
      tap: true,
      until: (page) => button(page, 'All reference material').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'reference_home',
      part: (page) => button(page, 'All reference material'),
      say: 'and All reference material.',
      tap: true,
      until: (page) => page.getByText('Write a guide', { exact: true }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'reference_home',
      part: (page) => page.getByText('Write a guide', { exact: true }).locator('visible=true').first(),
      say: 'Tap Write a guide.',
      tap: true,
      until: (page) => box(page, 'Title').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'guide_editor',
      part: (page) => box(page, 'Title'),
      say: 'Give it a title.',
      type: 'Jesus heals on the Sabbath',
      stay: 0.5
    },
    {
      screen: 'guide_editor',
      part: (page) => [button(page, "FIA's six steps"), button(page, 'One empty step')],
      say: "Start from FIA's six steps, or from one empty step."
    },
    {
      screen: 'guide_editor',
      part: (page) => box(page, 'Verses'),
      say: 'Say which verses it is for. Every passage with these verses gets it.',
      type: 'LUK 13:10-17',
      stay: 0.6
    },
    {
      screen: 'guide_editor',
      part: (page) => button(page, /^Like most English Bibles/),
      say: 'And how its verses are numbered.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'guide_editor',
      part: (page) => button(page, 'Steps · 6'),
      say: 'Then fill in each step.',
      tap: true,
      until: (page) => button(page, /^Step 1: Hear and Heart/).waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'guide_editor',
      part: (page) => button(page, /^Step 1: Hear and Heart/),
      tap: true,
      until: (page) => box(page, 'Step text').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'guide_editor',
      part: (page) => button(page, 'Record this step'),
      say: 'Record what the group hears, for people who do not read,'
    },
    {
      screen: 'guide_editor',
      part: (page) => box(page, 'Step text'),
      say: 'and write it.',
      type: 'Listen to the passage twice. Then talk together: what surprised you?',
      stay: 0.6
    },
    {
      screen: 'guide_editor',
      part: (page) => button(page, 'Done'),
      say: "Tap Done to publish it. Phones get it when they next sync. To adapt another organization's guide, copy it and change your copy.",
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
