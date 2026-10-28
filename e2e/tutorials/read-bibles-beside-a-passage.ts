// "Read Bibles beside a passage", for translators: in Luke 13:31-35's
// workspace, Grace hears the Bible, goes back ten seconds and notes a verse.
// Choosing another Bible waits for a world with a second Bible for Luke 13.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id, shows } from './workspace';

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).locator('visible=true').first();

export const readBiblesBesideAPassage: Tutorial = {
  id: 'read-bibles-beside-a-passage',
  title: 'Read Bibles beside a passage',
  as: 'TRANS',
  names: recordAPassage.names,
  before: async (page) => {
    await page.getByText('Luke 13:31–35').locator('visible=true').first().waitFor({ timeout: 60_000 });
    await id(page, 'primary-action').click();
    await shows(page, 'path-step-record');
    await id(page, 'primary-action').click();
    await shows(page, 'record-button');
  },
  steps: [
    {
      screen: 'workspace',
      part: (page) => button(page, 'Play Luke 13:31–35'),
      say: "Here's how to use the Bible while you record. The passage is at the top. Tap play to hear it.",
      tap: true,
      stay: 7
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Pause'),
      say: 'Tap pause.',
      tap: true,
      stay: 0.4
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Back 10 seconds'),
      say: 'This goes back ten seconds, to hear it again.'
    },
    {
      screen: 'workspace',
      part: (page) => page.getByRole('button', { name: /^Verse 13:32\./ }).locator('visible=true').first(),
      say: 'Tap a verse to do something with it.',
      tap: true,
      until: (page) => button(page, 'Add a note here').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Add a note here'),
      say: 'Tap Add a note here to keep a note on that verse.',
      tap: true,
      until: (page) => field(page, 'Or type it').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => field(page, 'Or type it'),
      say: 'Say it, or type it.',
      type: 'Ask the elders how we say fox',
      stay: 0.4
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Add a note'),
      say: 'Then tap Add a note. Reviewers and the next translator see it with the passage.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 10_000 }),
      stay: 1
    },
    {
      screen: 'workspace',
      part: (page) => page.getByRole('tab', { name: /^Notes/ }).locator('visible=true').first(),
      say: 'Your notes are kept under Notes.',
      stay: 2
    }
  ]
};
