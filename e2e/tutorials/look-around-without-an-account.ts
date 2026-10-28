// "Look at public work without an account", for everyone: from the Sign In
// screen to Explore, where each language an organization lists publicly has a
// card (its license and how much is recorded). A card sends a guest to sign
// in, then they can ask its organization to let them in.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import type { LanguageKey, UiWorld } from '../ui/fixture';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';
import { serviceClient } from '../ui/people-helpers';

const names = recordAPassage.names.languages!;
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const card = (page: Page, key: LanguageKey) => button(page, new RegExp(`^${names[key]}, \\d+%$`));

/** Lists a language publicly, as the server's projection would, with how much is recorded. */
async function list(world: UiWorld, key: LanguageKey, pct: number, license: string): Promise<void> {
  const sb = serviceClient();
  const { orgId, languageId, name } = world.languages[key];
  const shown = await sb.from('language_visibility').upsert({ org_id: orgId, language_id: languageId, listed: true });
  if (shown.error) throw new Error(`listing ${name}: ${shown.error.message}`);
  const lang = await sb.from('languages').select('code').eq('org_id', orgId).eq('language_id', languageId).maybeSingle();
  const { error } = await sb.from('public_languages').upsert({
    org_id: orgId, language_id: languageId, name, code: (lang.data as { code?: string } | null)?.code ?? '',
    translated_pct: pct, license, updated_at: new Date().toISOString()
  });
  if (error) throw new Error(`public card for ${name}: ${error.message}`);
}

export const lookAroundWithoutAnAccount: Tutorial = {
  id: 'look-around-without-an-account',
  title: 'Look at public work without an account',
  as: 'NOORG',
  signedOut: true,
  names: recordAPassage.names,
  prepare: async (world) => {
    await list(world, 'A', 34, 'all-rights-reserved');
    await list(world, 'B', 8, 'all-rights-reserved');
    await list(world, 'C', 61, 'CC-BY-4.0');
  },
  before: async (page, _mic, world) => {
    // Every test world lists languages too; the video shows this one's.
    await page.route('**/rest/v1/public_languages*', (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set('org_id', `in.(${world.orgId},${world.org2Id})`);
      return route.continue({ url: url.toString() });
    });
    await page.getByText('Create Account', { exact: true }).first().waitFor({ timeout: 120_000 });
  },
  steps: [
    {
      screen: 'sign_in',
      part: (page) => button(page, 'Browse public work'),
      say: "Here's how to look at the work organizations share publicly, without an account. On the sign-in screen, tap Browse public work.",
      tap: true,
      until: (page) => card(page, 'A').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'explore_home',
      part: (page) => [card(page, 'A'), card(page, 'B'), card(page, 'C')],
      say: 'Each language listed publicly has a card.'
    },
    {
      screen: 'explore_home',
      part: (page) => [words(page, 'All rights reserved · Only your organization'), words(page, 'CC BY 4.0 · Any use, with credit')],
      say: 'It says how its organization lets others use the recordings.'
    },
    {
      screen: 'explore_home',
      part: (page) => card(page, 'C').getByText(/\d+%$/).last(),
      say: 'And how much of it is recorded.'
    },
    {
      screen: 'explore_home',
      part: (page) => card(page, 'A'),
      say: 'To help with a language, tap its card. Sign in first, then you can ask its organization to let you in.',
      tap: true,
      until: (page) => page.getByText('Create Account', { exact: true }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
