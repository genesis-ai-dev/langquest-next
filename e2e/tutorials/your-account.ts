// "Your account", for everyone: Samuel changes his name, sees how to switch
// organization, and where to delete his account (he keeps it).
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const NAMES = recordAPassage.names;

export const yourAccount: Tutorial = {
  id: 'your-account',
  title: 'Your account',
  as: 'ADMIN',
  names: NAMES,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Me' }).locator('visible=true').first(),
      say: "Here's how to look after your account. Tap Me.",
      tap: true,
      until: (page) => heading(page, 'Me').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /Name and photo$/),
      say: 'To change your name, tap it.',
      tap: true,
      until: (page) => heading(page, 'Edit Profile').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'profile_edit',
      part: (page) => page.getByLabel('Full Name', { exact: true }).locator('visible=true').first(),
      say: 'Change it here. Your team sees this name on your work.',
      paste: 'Samuel Mensah',
      stay: 0.8
    },
    {
      screen: 'profile_edit',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Save Profile.',
      tap: true,
      until: (page) => heading(page, 'Me').waitFor({ timeout: 10_000 }),
      stay: 1
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^Switch Organization/),
      say: 'If you are in more than one organization, Switch Organization moves between them.',
      tap: true,
      until: (page) => heading(page, 'Switch Organization').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'org_switcher',
      part: (page) => [button(page, `${NAMES.org}, active`), button(page, NAMES.org2!)],
      say: 'Tap one to open it. Your place in each one stays as it is.'
    },
    {
      screen: 'org_switcher',
      part: (page) => id(page, 'header-back'),
      tap: true,
      until: (page) => heading(page, 'Me').waitFor({ timeout: 10_000 }),
      stay: 0.4
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^More settings/),
      say: 'More settings has your password, notifications and sync.',
      tap: true,
      until: (page) => heading(page, 'More settings').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^Delete account/),
      say: 'And Delete account.',
      tap: true,
      until: (page) => heading(page, 'Delete your account?').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'delete_account',
      part: (page) => [words(page, 'Deleted'), words(page, 'Kept by your organization')],
      say: 'It says first what is deleted, and what your organization keeps: your recordings and reviews stay part of its work, without your name.'
    },
    {
      screen: 'delete_account',
      part: (page) => button(page, 'Cancel'),
      say: 'To keep your account, tap Cancel.',
      tap: true,
      until: (page) => heading(page, 'More settings').waitFor({ timeout: 10_000 }),
      stay: 2
    }
  ]
};
