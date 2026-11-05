// "Make your own role", for admins: the Riverside team has people from the
// community who check recordings and leave notes, and no role fits them.
// Samuel makes a Community checker role.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const ROLE = 'Community checker';
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const toggle = (page: Page, name: string) => page.getByRole('switch', { name, exact: true }).locator('visible=true').first();

export const makeARole: Tutorial = {
  id: 'make-a-role',
  title: 'Make your own role',
  as: 'ADMIN',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to make a role of your own, when the usual roles don't fit what someone does. Tap Manage.",
      tap: true,
      until: (page) => words(page, 'Setup').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => words(page, 'Setup'),
      say: 'Open Setup.',
      tap: true,
      until: (page) => words(page, 'Roles').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => words(page, 'Roles'),
      say: 'Then Roles.',
      tap: true,
      until: (page) => words(page, 'Defined at Organization').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'roles_home',
      part: (page) => [words(page, 'Organization Admin'), words(page, 'Translator-Reviewer')],
      say: 'Each role is a set of things a person may do.'
    },
    {
      screen: 'roles_home',
      part: (page) => button(page, 'Role'),
      say: 'To make a new one, tap Role.',
      tap: true,
      until: (page) => page.getByLabel('What is it called?', { exact: true }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'role_editor',
      part: (page) => page.getByLabel('What is it called?', { exact: true }).locator('visible=true').first(),
      say: 'Give it a name.',
      type: ROLE,
      stay: 0.6
    },
    {
      screen: 'role_editor',
      part: (page) => toggle(page, 'Check recordings'),
      say: 'Turn on what they may do. A community checker checks recordings,',
      tap: true,
      stay: 0.5
    },
    {
      screen: 'role_editor',
      part: (page) => toggle(page, 'Add notes and key words'),
      say: 'and adds notes.',
      tap: true,
      stay: 0.5
    },
    {
      screen: 'role_editor',
      part: (page) => id(page, 'primary-action'),
      say: 'Then save it.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1
    },
    {
      screen: 'roles_home',
      part: (page) => words(page, ROLE),
      say: 'Now you can give it to people when you invite them, or let them in.',
      stay: 2
    }
  ]
};
