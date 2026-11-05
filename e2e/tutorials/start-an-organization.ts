// "Start an organization", for admins: Samuel has an account and nobody has
// invited him. He starts Riverside Translation Team, chooses who may use its
// work, and lands on getting it ready: a language, then a team.
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const ORG = recordAPassage.names.org;
const licence = (page: import('playwright').Page) => page.getByRole('button', { name: /^License: / }).locator('visible=true').first();

export const startAnOrganization: Tutorial = {
  id: 'start-an-organization',
  title: 'Start an organization',
  as: 'NOORG',
  names: { ...recordAPassage.names, people: { ...recordAPassage.names.people, NOORG: 'Samuel' } },
  before: async (page) => {
    await page.getByText('Join your team', { exact: true }).locator('visible=true').first().waitFor({ timeout: 60_000 });
  },
  steps: [
    {
      screen: 'intent_chooser',
      part: (page) => page.getByText('Start a new one', { exact: true }).locator('visible=true').first(),
      say: "Here's how to start an organization for your team. If nobody has invited you, tap Start a new one.",
      tap: true,
      until: (page) => page.getByText('Start your organization', { exact: true }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'create_org',
      part: (page) => page.getByPlaceholder('Enter organization name').locator('visible=true').first(),
      say: 'Give it a name. Everyone on your team will see it.',
      type: ORG,
      stay: 0.6
    },
    {
      screen: 'create_org',
      part: licence,
      say: 'Then choose who may use your work. Tap here.',
      tap: true,
      until: (page) => button(page, 'Use this license').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'create_org',
      part: (page) => [page.getByRole('radio').locator('visible=true').first(), page.getByRole('radio').locator('visible=true').last()],
      say: 'All rights reserved keeps your work inside your organization. The others let people outside hear it and share it. You can open it up later, but never close it again.'
    },
    {
      screen: 'create_org',
      part: (page) => button(page, 'Use this license'),
      say: 'Tap Use this license.',
      tap: true,
      until: (page) => licence(page).waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'create_org',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Create Organization.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 60_000 }),
      stay: 1.5
    },
    {
      screen: 'my_work',
      part: (page) => [page.getByText(`Get ${ORG} ready`, { exact: true }).locator('visible=true').first(), button(page, 'Add a language')],
      say: "Your organization is ready, and you're its admin. Next, add the language your team speaks, then invite your team.",
      stay: 2
    }
  ]
};
