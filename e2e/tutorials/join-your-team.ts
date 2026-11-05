// "Join your team with an invite", for everyone: Mary has an account and no
// organization yet. Samuel, the admin, made a group invite for Lumari's
// translators. On a phone she scans its code; on the web she pastes its link.
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { signIn } from '../ui/fixture';
import { issueInviteAs } from '../ui/people-helpers';

let link = '';

export const joinYourTeam: Tutorial = {
  id: 'join-your-team',
  title: 'Join your team with an invite',
  as: 'NOORG',
  names: { ...recordAPassage.names, people: { ...recordAPassage.names.people, NOORG: 'Mary Okafor' } },
  before: async (page, _mic, world) => {
    const { sb } = await signIn(world, 'ADMIN');
    const token = await issueInviteAs(sb, world.orgId, 'translator', { level: 'language', languageId: world.languages.A.languageId }, 30);
    link = `https://next.langquest.org/invite#org=${world.orgId}&token=${token}`;
    await page.getByText('Join your team', { exact: true }).locator('visible=true').first().waitFor({ timeout: 60_000 });
  },
  steps: [
    {
      screen: 'intent_chooser',
      part: (page) => page.getByText('Join your team', { exact: true }).locator('visible=true').first(),
      say: "Here's how to join your team. Someone on your team, like your team leader, has an invite for you."
    },
    {
      screen: 'intent_chooser',
      part: (page) => button(page, 'Scan their code'),
      say: 'Ask them to show you its code, and tap Scan their code.',
      tap: true,
      until: (page) => page.getByPlaceholder('Invite or sign-in code').locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'scan_qr',
      part: (page) => page.getByPlaceholder('Invite or sign-in code').locator('visible=true').first(),
      say: 'On a phone, point the camera at the code. If they sent you a link instead, paste it here.',
      paste: () => link,
      stay: 1.2
    },
    {
      screen: 'scan_qr',
      part: (page) => page.getByText(/^Translator · /).locator('visible=true').first(),
      say: 'The invite says which team you join, and what you do there.'
    },
    {
      screen: 'scan_qr',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Join.',
      tap: true,
      until: (page) => page.getByText(/invited you$/).locator('visible=true').first().waitFor({ timeout: 60_000 }),
      stay: 1
    },
    {
      screen: 'welcome',
      part: (page) => page.getByText(/^You're a Translator/).locator('visible=true').first(),
      say: "You're in. The welcome says who invited you, and your part in the team."
    },
    {
      screen: 'welcome',
      part: (page) => page.getByText('Get started', { exact: true }).locator('visible=true').first(),
      say: 'Tap Get started to see your work.',
      tap: true,
      until: (page) => page.getByRole('tab', { name: 'Work' }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 2
    }
  ]
};
