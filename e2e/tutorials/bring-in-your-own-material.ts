// "Bring in your own material", for publishers: LangQuest turned on the FIA
// importer for the organization; its admin chooses a language, the server
// builds the guides (left out of the video), and the admin publishes them.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { serviceClient } from '../ui/people-helpers';
import { localServer } from '../ui/fixture';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const publish = (page: Page) => button(page, /^Publish \d+ items?$/);

/** What the app Worker's schedule does every ten minutes: build the import that is waiting. */
async function buildImports(): Promise<void> {
  const s = localServer();
  await promisify(execFile)('npx', ['tsx', 'scripts/publisher-import.ts', 'step'], {
    env: { ...process.env, SUPABASE_URL: s.url, SUPABASE_SERVICE_ROLE_KEY: s.service }, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000
  });
}

export const bringInYourOwnMaterial: Tutorial = {
  id: 'bring-in-your-own-material',
  title: 'Bring in your own material',
  as: 'ADMIN',
  names: recordAPassage.names,
  prepare: async (world) => {
    const { data, error } = await serviceClient().rpc('org_importer_grant', { p_org: world.orgId, p_importer: 'fia', p_source: 'BibleAquifer', p_by: 'Tutorial' });
    if (error || data !== 'granted') throw new Error(`turning on the FIA importer: ${error?.message ?? String(data)}`);
  },
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how a publisher brings its own material into LangQuest, once LangQuest has turned on an importer for it. Tap Manage.",
      tap: true,
      until: (page) => button(page, /^Setup\. /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Setup\. /),
      say: 'Open Setup,',
      tap: true,
      until: (page) => button(page, /^Reference material /).waitFor({ timeout: 10_000 }),
      stay: 0.4
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Reference material /),
      say: 'then Reference material.',
      tap: true,
      until: (page) => id(page, 'import-fia').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'reference_home',
      part: (page) => id(page, 'import-fia'),
      say: 'Your importer is here. Tap it.',
      tap: true,
      until: (page) => button(page, /^Import \d+ language/).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'reference_home',
      part: (page) => [words(page, 'English'), words(page, 'Bislama')],
      say: 'Choose the languages to bring in.'
    },
    {
      screen: 'reference_home',
      part: (page) => button(page, /^Import \d+ language/),
      say: 'Tap Import.',
      tap: true,
      until: (page) => words(page, /^(Waiting to start|Importing)$/).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'reference_home',
      part: (page) => words(page, /^(Waiting to start|Importing)$/),
      say: 'LangQuest builds the guides on its server. It takes a few minutes. You can close this and come back.',
      stay: 0.6,
      // The sheet asks again every 15 seconds.
      offCamera: async (page) => { await buildImports(); await publish(page).waitFor({ timeout: 120_000 }); }
    },
    {
      screen: 'reference_home',
      part: (page) => page.getByText(/^[\d,]+ study guides?$/).locator('visible=true').first(),
      say: "When it's ready, it lists what was made. Nothing is in your library yet."
    },
    {
      screen: 'reference_home',
      part: (page) => page.getByRole('switch', { name: /^Share with other organizations/ }).locator('visible=true').first(),
      say: 'Leave this on, and other organizations can follow it. Each new import reaches them as an update.'
    },
    {
      screen: 'reference_home',
      part: publish,
      say: 'Tap Publish.',
      tap: true,
      until: (page) => words(page, /^Published \d+ items?$/).waitFor({ timeout: 60_000 }),
      stay: 0.6
    },
    {
      screen: 'reference_home',
      part: (page) => words(page, /^Published \d+ items?$/),
      say: "It's in your library now. To bring in what the publisher added later, use the importer again.",
      stay: 1.5
    }
  ]
};
