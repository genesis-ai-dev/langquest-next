// "Read any organization as a Global Viewer", for LangQuest staff and
// partners LangQuest gives that access: Mary sets up an authenticator, types
// its code, and opens the Riverside team to read its work.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { serviceClient } from '../ui/people-helpers';
import { totp } from '../ui/totp';

const ORG = recordAPassage.names.org!;
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).locator('visible=true').first();
// The key the app shows, read off camera: what the authenticator app would read from the code.
let key = '';

export const readAnyOrganization: Tutorial = {
  id: 'read-any-organization',
  title: 'Read any organization as a Global Viewer',
  as: 'NOORG',
  names: recordAPassage.names,
  // As `npm run global-viewer -- grant` does.
  prepare: async (world) => {
    const { data, error } = await serviceClient().rpc('global_viewer_grant', { p_email: world.accounts.NOORG.email, p_by: 'Tutorial', p_note: 'Tutorial' });
    if (error || data !== 'granted') throw new Error(`Global Viewer for ${world.accounts.NOORG.email}: ${error?.message ?? String(data)}`);
  },
  // Every film's world has organizations of the same names; the list shows this world's.
  before: async (page, _mic, world) => {
    await page.route('**/rest/v1/rpc/global_viewer_organizations*', async (route) => {
      // Asked of the server page by page, as many as it takes to reach them.
      const asked = route.request().postDataJSON() as Record<string, unknown>;
      const ours: { org_id: string; name: string }[] = [];
      let after: Record<string, string> = {};
      for (;;) {
        const answer = await route.fetch({ postData: JSON.stringify({ ...asked, ...after, p_limit: 200 }) });
        const rows = (await answer.json()) as { org_id: string; name: string }[];
        ours.push(...rows.filter((r) => r.org_id === world.orgId || r.org_id === world.org2Id));
        if (rows.length < 200) break;
        after = { p_after_name: rows.at(-1)!.name, p_after_org: rows.at(-1)!.org_id };
      }
      await route.fulfill({ json: asked['p_after_name'] ? [] : ours });
    });
  },
  steps: [
    {
      screen: 'intent_chooser',
      part: (page) => button(page, /^Global Viewer/),
      say: "Here's how to read any organization's work, once LangQuest has made you a Global Viewer. Do this on a call with the person who gave you access. Tap Global Viewer.",
      tap: true,
      until: (page) => button(page, 'Set up authenticator').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'global_viewer',
      part: (page) => button(page, 'Set up authenticator'),
      say: 'You need an authenticator app on your phone, such as Google Authenticator. Tap Set up authenticator.',
      tap: true,
      until: (page) => id(page, 'global-viewer-key').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'global_viewer',
      part: (page) => [words(page, 'Scan this code with your authenticator app.'), id(page, 'global-viewer-key')],
      say: 'Scan this code with the authenticator app.'
    },
    {
      screen: 'global_viewer',
      first: async (page) => { key = ((await id(page, 'global-viewer-key').textContent()) ?? '').replace(/\s/g, ''); },
      part: (page) => field(page, 'Code from your authenticator'),
      say: 'Type the code it shows.',
      type: () => totp(key),
      stay: 0.3
    },
    {
      screen: 'global_viewer',
      part: (page) => button(page, 'Check code'),
      say: 'Tap Check code.',
      tap: true,
      until: (page) => field(page, 'Organization or language').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'global_viewer',
      part: (page) => field(page, 'Organization or language'),
      say: 'Find the organization,',
      type: 'Riverside',
      stay: 0.6
    },
    {
      screen: 'global_viewer',
      part: (page) => button(page, ORG),
      say: 'and tap it.',
      tap: true,
      until: (page) => page.getByRole('tab', { name: 'Map' }).locator('visible=true').first().waitFor({ timeout: 60_000 }),
      stay: 1
    },
    {
      screen: 'status_home',
      part: (page) => button(page, /^Lumari: /),
      say: "It opens as its own viewers see it. You can read everything, and change nothing."
    },
    {
      screen: 'status_home',
      part: (page) => id(page, 'global-viewer-link'),
      say: 'To open another organization, tap here.',
      tap: true,
      until: (page) => id(page, 'global-viewer-here').waitFor({ timeout: 30_000 }),
      stay: 1.5
    }
  ]
};
