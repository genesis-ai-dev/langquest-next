// 01 Getting in, the welcome (AUTH-056 to 059): a world whose accounts have
// never been welcomed, each signed in through Sign In on a new browser.
//
// ADMIN is also a member of UI Second Org, and a new device opens the first
// organization by name; each browser here last had UI Test Org open, as the
// tester's own device would.
import type { Browser, Page } from '@playwright/test';
import { quiet, signInWithForm } from './auth-helpers';
import type { AccountKey } from './fixture';
import { back, button, expect, openSignedOut, screenText, tab, tabsShown, test, text, useWorld } from './support';

const world = useWorld({ welcomed: false });
test.beforeEach(async ({ context }) => { await quiet(context); });

/** A new browser with UI Test Org as the organization last open, signed in through Sign In. */
async function signInFresh(browser: Browser, key: AccountKey): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await quiet(context);
  const who = world().accounts[key];
  await context.addInitScript(([id, orgId]) => {
    if (!localStorage.getItem(`selection:${id}`)) localStorage.setItem(`selection:${id}`, JSON.stringify({ orgId }));
  }, [who.id, world().orgId] as const);
  const page = await context.newPage();
  await openSignedOut(page);
  await signInWithForm(page, who.email, who.password!);
  return { page, close: () => context.close() };
}

const TRANSLATOR = ['Record passages in your language.', 'Your team listens and says what to change.', "My Work shows what's next for you."];
const REVIEWER = ['Listen to recordings when someone asks you.', 'Say what works and what should change.', 'My Work shows who is waiting on you.'];
const ADMIN = ['Add the languages your teams record.', 'Choose how passages get checked.', 'Invite your team.'];
const VIEWER = ['See how far each language has come.', 'Open any passage to hear what happened.'];

test('AUTH-056 The welcome says each role\'s job', async ({ browser }) => {
  const org = world().orgName;
  const roles: [AccountKey, string, string[]][] = [
    ['ADMIN', `You're an Organization Admin on ${org}.`, ADMIN],
    ['COORD', `You're a Coordinator on ${org}.`, ADMIN],
    ['LADMIN', `You're a Language Lead on the Alpha team at ${org}.`, ADMIN],
    ['TRANS', `You're a Translator on the Alpha team at ${org}.`, TRANSLATOR],
    ['REV', `You're a Reviewer on the Alpha team at ${org}.`, REVIEWER],
    ['TREV', `You're a Translator-Reviewer on the Alpha team at ${org}.`, TRANSLATOR],
    ['VIEW', `You're a Viewer on ${org}.`, VIEWER]
  ];
  for (const [key, sentence, lines] of roles) {
    await test.step(key, async () => {
      const { page, close } = await signInFresh(browser, key);
      try {
        const first = world().accounts[key].name.split(' ')[0];
        await expect(text(page, `Welcome, ${first}`)).toBeVisible({ timeout: 60_000 });
        expect(await tabsShown(page)).toEqual([]);
        await expect.poll(() => screenText(page)).toContain(sentence);
        // The role's name is bold.
        const role = /You're an? (.+?) on /.exec(sentence)![1]!;
        const weight = await page.getByText(role, { exact: true }).locator('visible=true').first().evaluate((e) => getComputedStyle(e).fontWeight);
        expect(Number(weight)).toBeGreaterThanOrEqual(700);
        const body = await screenText(page);
        for (const line of lines) expect(body).toContain(line);
        // Everyone but the organization's creator joined by ADMIN's invite.
        if (key === 'ADMIN') await expect(text(page, /invited you$/)).toBeHidden();
        else await expect(text(page, `${world().accounts.ADMIN.name} invited you`)).toBeVisible();
        await expect(text(page, 'Nothing to remember')).toBeHidden();
        await expect(button(page, 'What is LangQuest?')).toBeVisible();
        // One way on for every role (decision 71: the Getting started card that "Show me how" opened is gone).
        await expect(button(page, 'Get started')).toBeVisible();
        await expect(button(page, 'Show me how')).toHaveCount(0);
        await expect(button(page, 'Skip for now')).toHaveCount(0);
      } finally {
        await close();
      }
    });
  }
});

async function signOutFromMe(page: Page) {
  await tab(page, 'me').click();
  await button(page, /^Sign out/).click();
  await button(page, 'Sign Out').click();
  await expect(page.getByLabel('Email or sign-in name', { exact: true }).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
}

test('AUTH-057 Leaving the welcome', async ({ browser }) => {
  for (const [key, tabs] of [['TRANS', ['work', 'map', 'me']], ['VIEW', ['map', 'inbox', 'me']]] as const) {
    await test.step(key, async () => {
      const { page, close } = await signInFresh(browser, key);
      try {
        await button(page, 'Get started').click({ timeout: 60_000 });
        await expect(tab(page, tabs[0])).toBeVisible({ timeout: 60_000 });
        await expect.poll(() => tabsShown(page)).toEqual([...tabs]);
        if (key === 'TRANS') await expect(text(page, 'My Work')).toBeVisible();
        await signOutFromMe(page);
        const who = world().accounts[key];
        await signInWithForm(page, who.email, who.password!);
        await expect(tab(page, tabs[0])).toBeVisible({ timeout: 60_000 });
        await expect(text(page, `Welcome, ${who.name.split(' ')[0]}`)).toBeHidden();
      } finally {
        await close();
      }
    });
  }
});

test('AUTH-058 The welcome is shown once per account', async ({ browser }) => {
  // TRANS was welcomed in AUTH-057, on another browser. A new device signs in.
  const { page, close } = await signInFresh(browser, 'TRANS');
  try {
    await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
    await expect(text(page, 'Welcome, Tom')).toBeHidden();
    await expect(button(page, 'Get started')).toHaveCount(0);
  } finally {
    await close();
  }
});

test('AUTH-059 "What is LangQuest?" from the welcome', async ({ browser }) => {
  // TREV, still never welcomed (TRANS was welcomed in AUTH-057).
  const { page, close } = await signInFresh(browser, 'TREV');
  try {
    await button(page, 'What is LangQuest?').click({ timeout: 60_000 });
    await expect(text(page, '1 of 3')).toBeVisible();
    await expect(text(page, 'Scripture in every language')).toBeVisible();
    await expect(text(page, 'Teams record the Bible in their own language, check it together, and share it.')).toBeVisible();
    await button(page, 'Next').click();
    await expect(text(page, '2 of 3')).toBeVisible();
    await expect(text(page, 'Every passage keeps a record')).toBeVisible();
    await back(page).click();
    await expect(text(page, '1 of 3')).toBeVisible();
    await button(page, 'Next').click();
    await button(page, 'Next').click();
    await expect(text(page, '3 of 3')).toBeVisible();
    await expect(text(page, 'Do it, or ask someone')).toBeVisible();
    await button(page, 'Done').click();
    await expect(text(page, 'Welcome, Trevor')).toBeVisible();
    await expect(button(page, 'Get started')).toBeVisible();
    // Not yet welcomed: a new device still gets the welcome.
    const second = await signInFresh(browser, 'TREV');
    try {
      await expect(text(second.page, 'Welcome, Trevor')).toBeVisible({ timeout: 60_000 });
    } finally {
      await second.close();
    }
  } finally {
    await close();
  }
});
