// "Show a language to the public", for admins: Lumari is not on the public
// list yet. Samuel puts its name and progress there, where anyone can find
// it under Browse public work, without an account.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';
import { signIn } from '../ui/fixture';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const listed = (page: Page) => page.getByRole('switch', { name: /Show on the public list/ }).locator('visible=true').first();

export const showALanguageToThePublic: Tutorial = {
  id: 'show-a-language-to-the-public',
  title: 'Show a language to the public',
  as: 'ADMIN',
  names: recordAPassage.names,
  // Off camera, Lumari starts off the list (a new world lists it).
  prepare: async (world) => {
    const { sb } = await signIn(world, 'ADMIN');
    const { error } = await sb.rpc('set_language_visibility', { p_org: world.orgId, p_language: world.languages.A.languageId, p_listed: false });
    if (error) throw new Error(`taking Lumari off the list: ${error.message}`);
  },
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to let anyone see a language's progress, even without an account. Tap Manage.",
      tap: true,
      until: (page) => button(page, /^Lumari /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Lumari /),
      say: 'Open the language.',
      tap: true,
      until: (page) => listed(page).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'language_home',
      part: (page) => words(page, 'Show on the public list'),
      say: 'Show on the public list is off. Only your organization sees Lumari.'
    },
    {
      screen: 'language_home',
      part: listed,
      say: 'Turn it on.',
      tap: true,
      stay: 1
    },
    {
      screen: 'language_home',
      part: (page) => words(page, 'Show on the public list'),
      say: "Now Lumari's name and progress are on the public list. Anyone can find them under Browse public work. Turn it off to take them away again.",
      stay: 2
    }
  ]
};
