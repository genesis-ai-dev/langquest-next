// "Create an account and sign in", for everyone: the Sign In screen's ways in,
// then Mary makes an account with her email and lands on "Join your team".
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';
import { DOMAIN, freeAddresses } from './addresses';

const EMAIL = `mary.okafor@${DOMAIN}`;
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).locator('visible=true').first();

export const createAnAccount: Tutorial = {
  id: 'create-an-account',
  title: 'Create an account and sign in',
  as: 'NOORG',
  signedOut: true,
  names: recordAPassage.names,
  // The address is the same in every film, so the last film's account gives it up first.
  prepare: () => freeAddresses([EMAIL]),
  before: async (page) => {
    await page.getByText('Create Account', { exact: true }).first().waitFor({ timeout: 120_000 });
  },
  steps: [
    {
      screen: 'sign_in',
      part: (page) => [field(page, 'Email or sign-in name'), field(page, 'Password')],
      say: "Here's how to get into LangQuest. If you already have an account, sign in here."
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
      say: "You're in. Now join your team with their invite, or start a new organization.",
      stay: 2
    }
  ]
};
