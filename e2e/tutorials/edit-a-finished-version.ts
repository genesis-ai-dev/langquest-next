// "Edit a finished version", for translators: Luke 16:19-31 has Version 1,
// and every check of it is done. Grace opens Version 1, taps Edit, says
// Part 2 again in the new draft, says what changed, and finishes Version 2.
// Version 1 stays as it was, with its checks.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id, partRow } from './workspace';
import { openOnMap } from './passage-nav';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();

export const editAFinishedVersion: Tutorial = {
  id: 'edit-a-finished-version',
  title: 'Edit a finished version',
  as: 'TRANS',
  names: recordAPassage.names,
  // Part 2 (Luke 16:22-23) said again.
  speech: ['done-2-again.wav'],
  steps: [
    ...openOnMap('Luke 16:19–31', 'Luke 16',
      "Here's how to fix a recording that is already finished, even after every check. Find the passage on the Map, and open it."),
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
      say: 'Tap the version you want to change.',
      tap: true,
      until: (page) => page.getByRole('heading', { name: 'Version 1' }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'version_detail',
      part: (page) => button(page, 'Edit'),
      say: 'Edit starts a new draft from this version. Version 1 stays as it is, so nothing the team checked is lost. Tap Edit.',
      help: 'passage.versions.editVersionHelp',
      tap: true,
      until: (page) => id(page, 'record-button').waitFor({ state: 'visible', timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => [button(page, /^Version 1, 3 parts · /), ...partRow(page, 1), ...partRow(page, 3)],
      say: 'Your draft starts with every part of Version 1.',
      stay: 0.3
    },
    {
      screen: 'workspace',
      // The whole of Part 2's row is lit; the finger taps its recording (the first part named).
      part: (page) => [button(page, 'Record Part 2 again'), ...partRow(page, 2)],
      say: 'In this example, Part 2 has a mistake. Tap it. What you record next replaces it.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'record-button'),
      say: 'Tap the red button and speak.',
      tap: true,
      speak: 0
    },
    {
      screen: 'workspace',
      atSpeech: 'end',
      part: (page) => id(page, 'record-button'),
      say: "Tap stop when you've finished.",
      tap: true,
      until: (page) => page.getByText('Stopped', { exact: true }).waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Done'),
      say: 'Then tap the tick to keep it. Not right? Tap the part, and record it again.',
      tap: true,
      until: (page) => id(page, 'publish-button').waitFor({ state: 'visible', timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'publish-button'),
      say: 'When every change is made, tap Done.',
      tap: true,
      until: (page) => button(page, /^Say what changed\./).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => button(page, /^Say what changed\./),
      say: 'Say what changed, so the team knows what to listen for. Tap here.',
      tap: true,
      until: (page) => words(page, 'What changed?').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => page.getByPlaceholder('Or type it').locator('visible=true').first(),
      say: 'Say it, or type it.',
      type: 'Part 2: fixed a wrong word.',
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Done'),
      say: 'Then tap Done.',
      tap: true,
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Finish Version 2'),
      say: 'Tap Finish Version 2.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1.5
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, /^1\. Record\. Version 2 · /),
      say: 'Version 2 is finished, and the team can hear it. The checks stay done.'
    },
    {
      screen: 'passage_record',
      part: (page) => button(page, 'Versions and history'),
      say: 'Version 1 is still here, in Versions and history.',
      stay: 2
    }
  ]
};
