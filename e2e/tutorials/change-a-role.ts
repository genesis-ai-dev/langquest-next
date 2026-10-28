// "Change someone's role or remove them", for admins: Ruth checks recordings
// in Lumari and will now translate too; Peter has moved away. Samuel changes
// Ruth's role and takes Peter off the language.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const sheet = (page: Page) => page.getByTestId('sheet').locator('visible=true').last();

export const changeARole: Tutorial = {
  id: 'change-a-role',
  title: "Change someone's role or remove them",
  as: 'ADMIN',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to change what someone does on your team, or take them off it. Tap Manage.",
      tap: true,
      until: (page) => button(page, /^Lumari /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Lumari /),
      say: 'Open the language.',
      tap: true,
      until: (page) => words(page, 'People').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'language_home',
      part: (page) => words(page, 'People'),
      say: 'Then People.',
      tap: true,
      until: (page) => words(page, /^Language members · /).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'members_list',
      part: (page) => words(page, 'Ruth'),
      say: 'Tap the person.',
      tap: true,
      until: (page) => words(page, 'Reviewer · Lumari').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'edit_member',
      part: (page) => words(page, 'Reviewer · Lumari'),
      say: 'Ruth checks recordings in Lumari.'
    },
    {
      screen: 'edit_member',
      part: (page) => page.getByRole('radio', { name: 'Translator-Reviewer' }).locator('visible=true').first(),
      say: 'Pick the new role. Ruth will translate and check.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'edit_member',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Save Assignment.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1.5
    },
    {
      screen: 'members_list',
      part: (page) => words(page, 'Peter'),
      say: 'To take someone off the team, open them too.',
      tap: true,
      until: (page) => words(page, 'Remove from language').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'edit_member',
      part: (page) => words(page, 'Remove from language'),
      say: 'Tap Remove from language.',
      tap: true,
      until: (page) => sheet(page).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'edit_member',
      part: (page) => sheet(page).getByRole('button', { name: 'Remove from language', exact: true }),
      say: 'It asks first, because nothing puts them back afterwards. What they made stays with the work.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
