// "Get the blue check", for admins: Samuel asks LangQuest for the Riverside
// team's blue check, and proves the team's website is theirs with a code sent
// to an address there, and the request waits for LangQuest.
//
// The code's email comes from an Edge Function that a filmed world does not
// run: the film answers the app's call to it, starting the request on the
// server as the function does, and keeps the code to type.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { id } from './workspace';
import { serviceClient } from '../ui/people-helpers';

const DOMAIN = 'riverside.example.org';
let code = '';
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).locator('visible=true').first();
const seal = (page: Page, name: string | RegExp) => page.getByRole('button', { name }).locator('visible=true').first();

export const getTheBlueCheck: Tutorial = {
  id: 'get-the-blue-check',
  title: 'Get the blue check',
  as: 'ADMIN',
  names: recordAPassage.names,
  before: async (page, _mic, world) => {
    await page.route('**/functions/v1/verify-org-email', async (route) => {
      const body = route.request().postDataJSON() as { orgId: string; domain: string; email: string };
      const { data, error } = await serviceClient().rpc('org_verification_begin', {
        p_actor: world.accounts.ADMIN.id, p_org: body.orgId, p_domain: body.domain, p_email: body.email
      });
      if (error) throw new Error(`org_verification_begin: ${error.message}`);
      const begun = data as { ok: boolean; reason?: string; requestId?: string; code?: string; email?: string; expiresAt?: string };
      if (!begun.ok) { await route.fulfill({ status: 400, json: { error: 'Not sent', reason: begun.reason } }); return; }
      code = begun.code!;
      await route.fulfill({ status: 200, json: { sent: true, email: begun.email, expiresAt: begun.expiresAt } });
    });
  },
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to get your organization a blue check, so everyone can see it is the real one. Tap Manage.",
      tap: true,
      until: (page) => seal(page, 'Ask for a blue check').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => seal(page, 'Ask for a blue check'),
      say: 'The grey check beside the name has not been added yet. Tap it.',
      tap: true,
      until: (page) => field(page, "Your organization's website").waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'org_home',
      // The words with the blue check beside them.
      part: (page) => page.getByText(/^A blue check means the LangQuest team has verified/).locator('visible=true').first().locator('xpath=..'),
      say: 'A blue check means the LangQuest team has checked your organization is who it says.'
    },
    {
      screen: 'org_home',
      part: (page) => field(page, "Your organization's website"),
      say: "Type your organization's website.",
      type: DOMAIN,
      stay: 0.5
    },
    {
      screen: 'org_home',
      part: (page) => field(page, 'Your email at that website'),
      say: 'And your email address there.',
      type: `samuel@${DOMAIN}`,
      stay: 0.5
    },
    {
      screen: 'org_home',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Email me a code.',
      tap: true,
      until: (page) => field(page, 'Code from the email').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'org_home',
      part: (page) => field(page, 'Code from the email'),
      say: 'Type the six numbers from the email.',
      type: () => code,
      stay: 0.5
    },
    {
      screen: 'org_home',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Confirm.',
      tap: true,
      until: (page) => words(page, 'Waiting for LangQuest').waitFor({ timeout: 30_000 }),
      stay: 1
    },
    {
      screen: 'org_home',
      part: (page) => words(page, 'Waiting for LangQuest'),
      say: 'Now the LangQuest team looks at your request. When they add the check, it turns blue beside your name, for everyone to see.',
      stay: 2
    }
  ]
};
