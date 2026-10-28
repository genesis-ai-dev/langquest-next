// "Let in people who ask to join", for admins: Moses has an account and asked
// to join the Riverside team. Samuel sees the request on My Work, picks what
// Moses will do and in which language, and lets Moses in.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { askToJoin, newPerson } from '../ui/people-helpers';

const MOSES = 'Moses Ochieng';
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();

export const letPeopleIn: Tutorial = {
  id: 'let-people-in',
  title: 'Let in people who ask to join',
  as: 'ADMIN',
  names: recordAPassage.names,
  prepare: async (world) => {
    const moses = await newPerson(world, MOSES);
    await askToJoin(moses, world.orgId, 'I read Lumari well and can help record.');
  },
  steps: [
    {
      screen: 'my_work',
      part: (page) => words(page, `${MOSES} wants to join`),
      say: "Here's how to let in someone who asks to join your organization. Their request shows on My Work. Tap it.",
      tap: true,
      until: (page) => words(page, 'What will they do?').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'edit_member',
      part: (page) => page.getByText(/I read Lumari well/).locator('visible=true').first(),
      say: 'It says who they are, and what they wrote.'
    },
    {
      screen: 'edit_member',
      part: (page) => [words(page, 'Translate'), words(page, 'Help run the team')],
      say: 'Pick what they will do. Moses will translate.'
    },
    {
      screen: 'edit_member',
      part: (page) => [words(page, 'Kitara'), words(page, 'All of them')],
      say: 'And in which language, or in all of them.'
    },
    {
      screen: 'edit_member',
      part: (page) => words(page, 'Say no'),
      say: "If you don't know them, say no. They can ask again later."
    },
    {
      screen: 'edit_member',
      part: (page) => id(page, 'primary-action'),
      say: 'To let them in, tap the button at the bottom.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 2.5
    }
  ]
};
