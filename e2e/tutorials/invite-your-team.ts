// "Invite your team", for admins: Samuel invites Lumari's translators with a
// group code that they scan, and shows the other ways: a link, by email, one
// person by name. The other side is "Join your team with an invite".
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const until = (s: string | RegExp, timeout = 10_000) => (page: Page) => words(page, s).waitFor({ timeout });
const card = (page: Page, role: string) => page.getByTestId(`invite-role-${role}`).locator('visible=true').first();

export const inviteYourTeam: Tutorial = {
  id: 'invite-your-team',
  title: 'Invite your team',
  as: 'ADMIN',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to invite your team. Tap Manage.",
      tap: true,
      until: until(recordAPassage.names.org!, 30_000),
      stay: 0.8
    },
    {
      screen: 'org_home',
      part: (page) => words(page, 'Invite people'),
      say: 'Tap Invite people.',
      tap: true,
      until: until('In which language?'),
      stay: 0.8
    },
    {
      screen: 'invite_member',
      part: (page) => page.getByRole('button', { name: 'Lumari', exact: true }).locator('visible=true').first(),
      say: 'Choose the language they will work in.',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'invite_member',
      part: (page) => [card(page, 'Translators'), card(page, 'Team leads')],
      say: 'Then who you are inviting. Each card says what those people do.'
    },
    {
      screen: 'invite_member',
      part: (page) => card(page, 'Translators').getByRole('button', { name: 'Invite', exact: true }),
      say: 'To invite translators, tap Invite on their card.',
      tap: true,
      until: (page) => words(page, 'Which checks will they do?').or(words(page, 'Ask them to scan this')).first().waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'invite_member',
      part: (page) => words(page, 'Peer check'),
      say: "Translators check each other's work too. Tap the checks they will do.",
      tap: true,
      stay: 0.4
    },
    {
      screen: 'invite_member',
      part: (page) => id(page, 'primary-action'),
      say: 'Then tap Show the code to scan.',
      tap: true,
      until: until('Ask them to scan this', 30_000),
      stay: 0.8
    },
    {
      screen: 'invite_qr',
      part: (page) => [words(page, 'Ask them to scan this'), page.locator('svg').locator('visible=true').first()],
      say: 'Ask them to scan this code with their phone. One code works for your whole group, and nobody needs a password.'
    },
    {
      screen: 'invite_qr',
      part: (page) => words(page, 'Share as a link'),
      say: 'If they are far away, share it as a link instead.'
    },
    {
      screen: 'invite_qr',
      part: (page) => [words(page, 'By email'), words(page, 'One person, by name')],
      say: 'You can also invite someone by email, or one person by name.'
    },
    {
      screen: 'invite_qr',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Done when everyone has it.',
      tap: true,
      until: until(/^Members/),
      stay: 0.8
    },
    {
      screen: 'org_home',
      part: (page) => words(page, /^Members/),
      say: 'When they join, you see them here, in Members.',
      stay: 2
    }
  ]
};
