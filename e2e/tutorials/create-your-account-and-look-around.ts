// "Create your account and look around", for everyone: one walk from the
// Sign In screen to knowing the app. Mary makes an account with her email,
// joins Lumari's translators with the invite Samuel made (on the web she
// pastes its link), and looks around: My Work, the cloud, the bell, the Map,
// Me and the ? on every screen. It takes in what "Create an account and sign
// in", "Join your team with an invite" and "Find your way around" each show.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';
import { DOMAIN, freeAddresses } from './addresses';
import { signIn } from '../ui/fixture';
import { issueInviteAs } from '../ui/people-helpers';

const EMAIL = `mary.okafor@${DOMAIN}`;
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).locator('visible=true').first();
const tab = (page: Page, name: string) => page.getByRole('tab', { name }).locator('visible=true').first();

let link = '';

export const createYourAccountAndLookAround: Tutorial = {
  id: 'create-your-account-and-look-around',
  title: 'Create your account and look around',
  as: 'NOORG',
  signedOut: true,
  names: recordAPassage.names,
  // The address is the same in every film, so the last film's account gives it up first.
  prepare: () => freeAddresses([EMAIL]),
  before: async (page, _mic, world) => {
    const { sb } = await signIn(world, 'ADMIN');
    const token = await issueInviteAs(sb, world.orgId, 'translator', { level: 'language', languageId: world.languages.A.languageId }, 30);
    link = `https://next.langquest.org/invite#org=${world.orgId}&token=${token}`;
    await page.getByText('Create Account', { exact: true }).first().waitFor({ timeout: 120_000 });
  },
  steps: [
    {
      screen: 'sign_in',
      say: "Here's how to start in LangQuest. You make an account, join your team, and look around."
    },
    {
      screen: 'sign_in',
      // The way in as a whole: the fields with their names, and Sign In.
      part: (page) => [page.getByText('Email or sign-in name', { exact: true }).locator('visible=true').first(), button(page, 'Sign In')],
      say: 'If you already have an account, sign in here.'
    },
    {
      screen: 'sign_in',
      part: (page) => button(page, 'Scan a code'),
      say: "If someone invited you, scan their code instead. You won't need an email."
    },
    {
      screen: 'sign_in',
      part: (page) => button(page, 'Create Account'),
      say: 'To make an account with your email, tap Create Account.',
      tap: true,
      until: (page) => page.getByPlaceholder('you@example.com').locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'create_account',
      part: (page) => field(page, 'Email'),
      say: 'Type your email.',
      type: EMAIL,
      stay: 0.3
    },
    {
      screen: 'create_account',
      part: (page) => field(page, 'Password'),
      say: 'Choose a password, of six or more letters and numbers.',
      type: 'harvest24',
      stay: 0.3
    },
    {
      screen: 'create_account',
      part: (page) => field(page, 'Confirm password'),
      say: 'And type it again.',
      type: 'harvest24',
      stay: 0.3
    },
    {
      screen: 'create_account',
      part: (page) => page.getByRole('link', { name: /^Creating an account accepts the Terms of Use and Privacy Policy/ }).locator('visible=true').first(),
      say: 'Creating an account accepts the Terms of Use and the Privacy Policy. Tap here to read them.'
    },
    {
      screen: 'create_account',
      part: (page) => button(page, 'Create Account'),
      say: 'Tap Create Account.',
      tap: true,
      until: (page) => page.getByText('Join your team', { exact: true }).locator('visible=true').first().waitFor({ timeout: 60_000 }),
      stay: 0.8
    },
    {
      screen: 'intent_chooser',
      part: (page) => page.getByText('Join your team', { exact: true }).locator('visible=true').first(),
      say: 'You have an account. Next, you need your team.'
    },
    {
      screen: 'intent_chooser',
      part: (page) => button(page, /^Start a new one/),
      say: "If you lead the work, and your organization is not in LangQuest yet, start a new one. The video 'Start an organization' shows how. That video is linked in the description below.",
      videos: ['start-an-organization']
    },
    {
      screen: 'intent_chooser',
      part: (page) => button(page, /^Find your organization/),
      say: 'If your organization is in LangQuest, you can find it, and ask them to let you in.'
    },
    {
      screen: 'intent_chooser',
      part: (page) => button(page, /^Scan their code/),
      say: 'Most people join with an invite. Someone on your team, like your team leader, has it. Ask them to show you its code, and tap Scan their code.',
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
      until: (page) => tab(page, 'Work').waitFor({ timeout: 30_000 }),
      stay: 1
    },
    {
      screen: 'my_work',
      // The card for what to do next.
      part: (page) => id(page, 'primary-action').locator('xpath=..'),
      say: 'Now look around. My Work shows what to do next. When nobody has asked you for a passage yet, it shows a good place to start.'
    },
    {
      screen: 'my_work',
      part: (page) => button(page, 'Live'),
      say: 'A green dot on the cloud means you are connected, and your work is sent as you go.',
      help: 'help.sync.live'
    },
    {
      screen: 'my_work',
      part: (page) => button(page, /^Updates/),
      say: 'The bell has your updates: checks asked of you, feedback, and news from your team.'
    },
    {
      screen: 'my_work',
      part: (page) => tab(page, 'Map'),
      say: 'Tap Map.',
      tap: true,
      until: (page) => page.getByRole('textbox', { name: 'Find “John 3”' }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'map_home',
      part: (page) => button(page, /^Luke\. /),
      say: 'The map shows every book, and how far each one has come. Tap a book to see its passages.'
    },
    {
      screen: 'map_home',
      part: (page) => page.getByRole('textbox', { name: 'Find “John 3”' }).locator('visible=true').first(),
      say: 'Or type a passage to find it.'
    },
    {
      screen: 'map_home',
      part: (page) => tab(page, 'Me'),
      say: 'Tap Me.',
      tap: true,
      until: (page) => button(page, /^More settings/).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'settings_home',
      part: (page) => [button(page, /Name, email and password$/), button(page, /^More settings/)],
      say: 'Me has your name, what this phone keeps for when there is no internet, and your settings.'
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^Language/),
      say: 'Here you choose the language of the app.'
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^How LangQuest works/),
      say: 'How LangQuest works plays a short tour.'
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, 'Help: explain this screen'),
      say: 'And on every screen, tap the question mark to have it explained.'
    },
    {
      screen: 'settings_home',
      part: (page) => tab(page, 'Work'),
      say: 'Tap Work to go back to your work.',
      tap: true,
      until: (page) => id(page, 'primary-action').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'my_work',
      say: "Now you are ready. The video 'Record a passage' shows how to translate. The video 'Do a check' shows how to check. Both videos are linked in the description below.",
      videos: ['record-a-passage', 'do-a-check'],
      stay: 2
    }
  ]
};
