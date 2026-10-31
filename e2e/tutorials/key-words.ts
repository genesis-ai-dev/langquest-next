// "Key words", for translators: Grace has recorded Luke 13:31-35. She adds
// "fox" (13:32) as a key word with her word for it, sees it marked in the
// Bible, and ties it to her draft.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id, recordOffCamera } from './workspace';

const chip = (page: Page, name: string) => page.getByRole('tab', { name }).locator('visible=true').first();
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).locator('visible=true').first();

export const keyWords: Tutorial = {
  id: 'key-words',
  title: 'Key words',
  as: 'TRANS',
  names: recordAPassage.names,
  // The passage, recorded off camera; then Grace's word for "fox".
  speech: ['passage.wav', 'fox.wav'],
  before: (page, mic) => recordOffCamera(page, mic, 3),
  steps: [
    {
      screen: 'workspace',
      part: (page) => chip(page, 'Key words'),
      say: "Here's how to keep key words the same every time. Tap Key words.",
      tap: true,
      until: (page) => button(page, 'Add a key word').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Add a key word'),
      say: 'A key word is one your team should say the same way every time. Tap Add a key word.',
      tap: true,
      until: (page) => field(page, 'The word in the Bible, e.g. shepherd').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => field(page, 'The word in the Bible, e.g. shepherd'),
      say: 'Type the word as the Bible has it.',
      type: 'fox',
      stay: 0.4
    },
    {
      screen: 'workspace',
      part: (page) => field(page, 'What it means (optional)'),
      say: 'And what it means, if you like.',
      type: 'Herod, a sly ruler',
      stay: 0.4
    },
    {
      screen: 'workspace',
      // The heading and the card of verses under it (the word is marked in each): the word's line, its verse, the card.
      part: (page) => [page.getByText('Where it is here', { exact: true }).locator('visible=true').first(), page.getByText('fox', { exact: true }).locator('visible=true').first().locator('xpath=ancestor::div[3]')],
      say: 'It shows where the word is in this passage.'
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Say it in Lumari'),
      say: 'Then tap here, and say your word for it.',
      tap: true,
      speak: 1
    },
    {
      screen: 'workspace',
      atSpeech: 1.8,
      part: (page) => button(page, 'Stop recording'),
      tap: true,
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Add the word'),
      say: 'Tap Add the word.',
      tap: true,
      until: (page) => button(page, /^fox\. /).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => chip(page, 'Bible'),
      say: 'Now tap Bible.',
      tap: true,
      until: (page) => page.getByRole('link', { name: /^fox, key word/ }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.4
    },
    {
      screen: 'workspace',
      part: (page) => page.getByRole('link', { name: /^fox, key word/ }).locator('visible=true').first(),
      say: 'The word is marked wherever it comes up, so everyone sees it while they record.'
    },
    {
      screen: 'workspace',
      part: (page) => page.getByRole('link', { name: /^fox, key word/ }).locator('visible=true').first(),
      say: 'Tap it to open it.',
      tap: true,
      until: (page) => button(page, 'Tie to your draft').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'key_term_detail',
      part: (page) => button(page, 'Tie to your draft'),
      say: 'Tap Tie to your draft, so reviewers know this word shaped your recording.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 10_000 }),
      stay: 2
    }
  ]
};
