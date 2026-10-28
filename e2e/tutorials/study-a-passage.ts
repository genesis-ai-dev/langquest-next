// "Study a passage before recording", for translators: Grace finds John
// 3:1-8 on the map, opens its study guide, answers a question with what the
// group said, and finishes the first step.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { offerStudyWorld } from '../ui/study-helpers';
import { writeVoice } from '../fixtures/voice';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const find = (page: Page) => page.getByRole('textbox', { name: 'Find “John 3”' }).locator('visible=true').first();
const stepBar = (page: Page, n: number) => button(page, new RegExp(`^Step ${n} of \\d+: `));

export const studyAPassage: Tutorial = {
  id: 'study-a-passage',
  title: 'Study a passage before recording',
  as: 'TRANS',
  names: recordAPassage.names,
  // The UI tests' study guides for Luke 15 and John 3 (its first step spoken by the test voice, not played here).
  prepare: async (world) => { writeVoice(); await offerStudyWorld(world); },
  // What the group said about the first question.
  speech: ['study-answer.wav'],
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Map' }).locator('visible=true').first(),
      say: "Here's how to study a passage before you record it. Tap Map.",
      tap: true,
      until: (page) => find(page).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'map_home',
      part: find,
      say: 'Type the passage.',
      type: 'John 3',
      stay: 1
    },
    {
      screen: 'map_home',
      part: (page) => words(page, 'John 3:1–8'),
      say: 'Tap it.',
      tap: true,
      until: (page) => button(page, 'Versions and history').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => id(page, 'primary-action'),
      say: 'When a passage has a study guide, it starts with Study. Tap it.',
      tap: true,
      until: (page) => stepBar(page, 1).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'study_guide',
      part: (page) => stepBar(page, 1),
      say: 'The guide takes you through the passage, one step at a time.'
    },
    {
      screen: 'study_guide',
      part: (page) => words(page, /^The passage · /),
      say: 'The passage is at the bottom. Hear it as often as you need.'
    },
    {
      screen: 'study_guide',
      part: (page) => button(page, /^1\.\s/),
      say: 'Talk about the questions together. Tap a question to answer it.',
      tap: true,
      until: (page) => button(page, 'Answer').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'study_guide',
      part: (page) => button(page, 'Answer'),
      say: 'Tap Answer.',
      tap: true,
      until: (page) => words(page, 'Your answer').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'study_guide',
      part: (page) => button(page, 'Record what the group said'),
      say: 'Record what the group said.',
      tap: true,
      speak: 0
    },
    {
      screen: 'study_guide',
      atSpeech: 5.9,
      part: (page) => button(page, 'Stop recording'),
      say: "Tap stop when they've finished.",
      tap: true,
      stay: 0.8
    },
    {
      screen: 'study_guide',
      part: (page) => button(page, 'Add your answer'),
      say: 'Then tap Add your answer. It stays with the passage, and reviewers see it with the study.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 10_000 }),
      stay: 1
    },
    {
      screen: 'study_guide',
      part: (page) => id(page, 'primary-action'),
      say: 'When you have done a step, tap Done with this step.',
      tap: true,
      until: (page) => stepBar(page, 2).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'study_step',
      part: (page) => stepBar(page, 2),
      say: 'Tap here to see every step, and which ones are done.',
      tap: true,
      until: (page) => words(page, /^1 of \d+ done/).waitFor({ timeout: 10_000 }),
      stay: 2
    }
  ]
};
