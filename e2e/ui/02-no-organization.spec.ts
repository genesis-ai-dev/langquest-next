// 02 No organization (docs/ui-test-suite/02-no-organization.md), on the web
// at phone width: Join your team, starting an organization, finding one and
// asking to join, and an admin's answer.
//
// Tests that would make NOORG a member, or leave it a request, use a fresh
// account with no organization instead (auth-helpers `newAccount`), so each
// test starts from "Join your team" with nothing asked. LANG-A's row on
// Explore and Find your organization is written as the projection worker
// writes it (`projectListing`).
import type { Browser, Page } from '@playwright/test';
import {
  issueInvite, newAccount, openFresh, openNew, paste, projectListing, quiet, settled, signInWithForm, type Fresh
} from './auth-helpers';
import { signIn } from './fixture';
import { back, button, byId, expect, expectSyncIdle, expectToast, field, primary, screenText, tab, tabsShown, test, text, useWorld } from './support';

const world = useWorld();
test.beforeEach(async ({ context }) => { await quiet(context); });
test.beforeAll(async () => { await projectListing(world(), 'A'); });
// listed_organizations stops at 500, by name, and the search is done on the phone: on a server with
// more listed (every world lists one), this world's may be cut off. Keep it in the answer (reported).
test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/rpc/listed_organizations*', async (route) => {
    const res = await route.fetch();
    const rows = (await res.json()) as { org_id: string; name: string; languages: string[] }[];
    if (!Array.isArray(rows) || rows.some((r) => r.org_id === world().orgId)) return route.fulfill({ response: res });
    await route.fulfill({ response: res, json: [...rows, { org_id: world().orgId, name: org(), languages: ['Alpha'] }] });
  });
});

const base = () => 'http://localhost:' + (process.env['UI_PORT'] ?? '8097');
const org = () => world().orgName;
const askRow = (page: Page, name: string) => page.getByRole('button', { name: `Ask ${name} to let you in`, exact: true }).locator('visible=true').first();
const CARDS = ['Scan their code', 'Find your organization', 'Start a new one'];

async function onJoinYourTeam(page: Page) {
  await expect(text(page, /^(Join your team|Asked .+)$/)).toBeVisible({ timeout: 60_000 });
}

async function newDevice(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await quiet(context);
  return context;
}

/** Only this world's public languages on Explore (the list stops at 100, and every world lists an "Alpha"). */
async function onlyThisWorld(page: Page) {
  await page.route('**/rest/v1/public_languages*', (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('org_id', `in.(${world().orgId})`);
    return route.continue({ url: url.toString() });
  });
}

/** Find your organization, narrowed to this world's organization by its name. */
async function findOrg(page: Page) {
  await text(page, 'Find your organization').click();
  await field(page, 'Name or language').fill(org());
  await expect(askRow(page, org())).toBeVisible({ timeout: 30_000 });
}

/** Ask this world's organization from Find your organization, and go back to Join your team. */
async function askFromList(page: Page) {
  await findOrg(page);
  await askRow(page, org()).click();
  await expect(text(page, `Asked ${org()}`)).toBeVisible();
  await button(page, 'Done').click();
  await expect(text(page, `Asked ${org()}`)).toBeVisible();
}

/** The fresh account's request, as an admin's server reads it (join_requests). */
async function requestsFor(who: Fresh): Promise<{ id: string; message: string }[]> {
  const { sb } = await signIn(world(), 'COORD');
  const { data, error } = await sb.from('join_requests').select('id,message').eq('org_id', world().orgId).eq('profile_id', who.id);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; message: string }[];
}

async function signOutHere(page: Page) {
  await button(page, 'Sign out').click();
  // A confirmation, once there is one (NOORG-004).
  const confirm = button(page, 'Sign Out');
  if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
}

// ---- Join your team ----------------------------------------------------------------------

test('NOORG-001 Someone with no organization lands on "Join your team" @p0', async ({ page }) => {
  const noorg = world().accounts.NOORG;
  await page.goto('/');
  await signInWithForm(page, noorg.email, noorg.password!);
  await expect(text(page, 'Join your team')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'Welcome, Nora')).toBeVisible();
  expect(await tabsShown(page)).toEqual([]);
  const body = await screenText(page);
  const at = CARDS.map((c) => body.indexOf(c));
  expect(at.every((x) => x >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  for (const sub of ['Someone on your team shows it', 'Ask them to let you in', 'For a team leader']) expect(body).toContain(sub);
  // The first card is the highlighted one.
  // Highlighted, and said so to a screen reader (kit Card's `current` as aria-current); soft, so the rest is still checked.
  await expect.soft(page.getByRole('button', { name: 'Scan their code', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('button', { name: 'Find your organization', exact: true })).not.toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Find your organization', exact: true })).not.toHaveAttribute('aria-current', 'true');
  await expect(button(page, 'Sign out')).toBeVisible();
  await expect(button(page, 'Delete account')).toBeVisible();
  await expect(button(page, 'Look around first')).toBeVisible();
  expect(body).not.toMatch(/Your invite|Asked |didn't add you/);
});

test('NOORG-002 The cards and "Look around first" lead where they say', async ({ page }) => {
  await openFresh(page, world(), 'NOORG');
  await onJoinYourTeam(page);
  await text(page, 'Scan their code').click();
  await expect(text(page, 'Scan a code')).toBeVisible();
  await expect(text(page, 'Invite includes organization, role, and scope')).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Join your team')).toBeVisible();
  await text(page, 'Find your organization').click();
  await expect(field(page, 'Name or language')).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Join your team')).toBeVisible();
  await text(page, 'Start a new one').click();
  await expect(text(page, 'Create Organization').first()).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Join your team')).toBeVisible();
  await button(page, 'Look around first').click();
  await expect(text(page, 'Explore')).toBeVisible();
  await expect(button(page, 'Sign In')).toHaveCount(0);
  await back(page).click();
  await expect(text(page, 'Join your team')).toBeVisible();
  await expect(text(page, 'Welcome, Nora')).toBeVisible();
});

test('NOORG-003 There is no way back past "Join your team"', async ({ page }) => {
  // Only the second Expected item, as the test says until the product decides on a back arrow.
  await openFresh(page, world(), 'NOORG');
  await onJoinYourTeam(page);
  await text(page, 'Find your organization').click();
  await back(page).click();
  await expect(text(page, 'Join your team')).toBeVisible();
  // The list Find your organization asked for may still be in the route above when the browser
  // leaves the app, and leaving disposes its response mid-read. That list is not what this test
  // is about, so the route goes first and a late error in it is dropped.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goBack();
  // Either the browser left the app, or the app shows where it stayed.
  await expect.poll(async () => !page.url().startsWith(base()) || /Join your team|Find your organization/.test(await screenText(page).catch(() => ''))).toBe(true);
  const left = !page.url().startsWith(base());
  if (!left) {
    await expect(text(page, /^(Join your team|Find your organization)$/)).toBeVisible();
    expect((await screenText(page)).trim()).not.toBe('');
    expect(await screenText(page)).not.toMatch(/My Work|Sign In/);
  }
});

test('NOORG-004 Sign out from "Join your team"', async ({ page }) => {
  const fresh = await newAccount(world(), 'Sam Signout');
  await openNew(page, world(), fresh);
  await onJoinYourTeam(page);
  await button(page, 'Sign out').click();
  await expect(text(page, 'Sign out?')).toBeVisible({ timeout: 10_000 });
  await expect(button(page, 'Cancel')).toBeVisible();
  await button(page, 'Sign Out').click();
  await expect(page.getByLabel('Email or sign-in name', { exact: true }).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /auth-token|selection:|outbox/.test(k)))).toEqual([]);
  await signInWithForm(page, fresh.email, fresh.password);
  await expect(text(page, 'Join your team')).toBeVisible({ timeout: 60_000 });
});

test('NOORG-005 On the web, sign-out waits for account changes still to send', async ({ page, context }) => {
  const fresh = await newAccount(world(), 'Wendy Waits');
  await openNew(page, world(), fresh);
  await onJoinYourTeam(page);
  // The list, saved on this device while online.
  await findOrg(page);
  await back(page).click();
  await settled(page);
  // The answer was kept on this device; offline, the browser's own request fails (a route would still reach the server).
  await page.unroute('**/rest/v1/rpc/listed_organizations*');
  await context.setOffline(true);
  await text(page, 'Find your organization').click();
  await field(page, 'Name or language').fill(org());
  await askRow(page, org()).click();
  await button(page, 'Done').click();
  await button(page, 'Sign out').click();
  await expect(text(page, 'Still to send: 1 account change. This device is offline. Sign out once they have synced so they are not stranded here.')).toBeVisible();
  // The confirm is its own screen. Cancel stays signed in; the ask is on the screen under it.
  await button(page, 'Cancel').click();
  await expect(text(page, `Asked ${org()}`)).toBeVisible();
  await context.setOffline(false);
  await expect(text(page, "You'll go straight in when they say yes. You can close the app; we'll let you know.")).toBeVisible({ timeout: 60_000 });
  await signOutHere(page);
  await expect(page.getByLabel('Email or sign-in name', { exact: true }).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
});

test('NOORG-006 Delete account from "Join your team"', async ({ page }) => {
  await openFresh(page, world(), 'NOORG');
  await onJoinYourTeam(page);
  await button(page, 'Delete account').click();
  await expect(text(page, 'Delete your account?')).toBeVisible();
  await expect(button(page, 'Delete My Account')).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Join your team')).toBeVisible();
  await expect(text(page, 'Welcome, Nora')).toBeVisible();
});

// ---- Start a new organization ------------------------------------------------------------

test('NOORG-007 The Create Organization screen', async ({ page }) => {
  await openFresh(page, world(), 'NOORG');
  await onJoinYourTeam(page);
  await text(page, 'Start a new one').click();
  await expect(text(page, 'Start your organization')).toBeVisible();
  await expect(text(page, 'Your teams will record Scripture in their own languages and check it together. It starts with a name.')).toBeVisible();
  await expect(page.getByPlaceholder('Enter organization name', { exact: true })).toBeVisible();
  await expect(text(page, "What's it called?")).toBeVisible();
  await expect(text(page, 'Who may use your work')).toBeVisible();
  await expect(page.getByRole('button', { name: 'License: All rights reserved. Only your organization', exact: true })).toBeVisible();
  await expect(text(page, 'Ready to use')).toBeVisible();
  await expect(text(page, "You'll get the usual roles and a standard way to check passages. Next, we'll add your first language and team together.")).toBeVisible();
  await expect(primary(page)).toHaveAccessibleName('Create Organization');
  await expect(primary(page)).toBeDisabled();
  await field(page, "What's it called?").fill('   ');
  await expect(primary(page)).toBeDisabled();
});

test('NOORG-008 Choosing who may use the work', async ({ page, context }) => {
  await context.route(/creativecommons\.org/, (route) => route.fulfill({ body: 'licence', contentType: 'text/plain' }));
  await openFresh(page, world(), 'NOORG');
  await onJoinYourTeam(page);
  await text(page, 'Start a new one').click();
  await page.getByRole('button', { name: 'License: All rights reserved. Only your organization', exact: true }).click();
  await expect(text(page, 'Who may use your work').last()).toBeVisible();
  await expect(text(page, 'Who may use what your team records and writes. You can open it up later, but never close it again.')).toBeVisible();
  const radios = page.getByRole('radio').locator('visible=true');
  const names = (await radios.allInnerTexts()).map((t) => t.split('\n')[0]!.trim());
  expect(names).toEqual(['All rights reserved', 'CC BY-NC-ND 4.0', 'CC BY-NC-SA 4.0', 'CC BY-SA 4.0', 'CC BY 4.0', 'CC0 (public domain)']);
  const body = await screenText(page);
  for (const short of ['Only your organization', 'Share unchanged, not for sale', 'Share and adapt, not for sale', 'Share and adapt, same terms', 'Any use, with credit', 'No conditions']) expect(body).toContain(short);
  // Ticked, and said so to a screen reader; soft, so the rest is still checked.
  await expect.soft(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(text(page, 'Only your members can see and use your work. Nobody else may copy or share it.')).toBeVisible();
  await expect(text(page, 'People outside can hear your team')).toBeHidden();
  await radios.nth(4).click();
  await expect.soft(radios.nth(4)).toHaveAttribute('aria-checked', 'true');
  await expect(text(page, 'Anyone may use, adapt and sell your work for any purpose, as long as they credit you.')).toBeVisible();
  await expect(text(page, 'People outside can hear your team')).toBeVisible();
  await expect(text(page, 'Anyone will be able to listen to your recordings. If a voice could put someone at risk, keep your work closed.')).toBeVisible();
  for (const i of [1, 2, 3, 5]) {
    await radios.nth(i).click();
    await expect(text(page, 'People outside can hear your team')).toBeVisible();
  }
  await radios.nth(4).click();
  const [licence] = await Promise.all([context.waitForEvent('page'), button(page, 'Read the license').click()]);
  expect(licence.url()).toMatch(/creativecommons\.org\/licenses\/by\/4\.0/);
  await licence.close();
  await button(page, 'Use this license').click();
  await expect(page.getByRole('button', { name: 'License: CC BY 4.0. Any use, with credit', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'License: CC BY 4.0. Any use, with credit', exact: true }).click();
  await radios.nth(0).click();
  await button(page, 'Use this license').click();
  await expect(page.getByRole('button', { name: 'License: All rights reserved. Only your organization', exact: true })).toBeVisible();
});

test('NOORG-009 Start a new organization @p0', async ({ page, browser }) => {
  const fresh = await newAccount(world(), 'Nico Founder');
  const name = `UI New Org ${world().run}`;
  await openNew(page, world(), fresh);
  await onJoinYourTeam(page);
  await text(page, 'Start a new one').click();
  await field(page, "What's it called?").fill(name);
  await primary(page).click();
  // The toast is up as soon as the organization exists, and it leaves after a few seconds.
  await expectToast(page, `${name} is ready to grow. Next, add your first language and invite your team.`);
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, /^Welcome, /)).toBeHidden();
  await expect.poll(() => tabsShown(page)).toEqual(['work', 'map', 'manage', 'me']);
  await expect(text(page, `Get ${name} ready`)).toBeVisible();
  await expect(text(page, 'The language your team speaks')).toBeVisible();
  await button(page, 'Add a language').click();
  await expect(text(page, 'New language').first()).toBeVisible();
  // New language is its own screen, with no tab bar. Manage is checked from My Work.
  await back(page).click();
  await tab(page, 'manage').click();
  await expect(text(page, name)).toBeVisible();
  await expect(text(page, /All rights reserved/)).toBeVisible();
  // A second device, signed in afresh: straight to My Work, and they are its Organization Admin.
  const context = await newDevice(browser);
  try {
    const second = await context.newPage();
    await second.goto('/');
    await signInWithForm(second, fresh.email, fresh.password);
    await expect(tab(second, 'work')).toBeVisible({ timeout: 60_000 });
    await expect(text(second, /^Welcome, /)).toBeHidden();
    await tab(second, 'manage').click();
    await text(second, /^Members/).click();
    await expect(text(second, 'Organization Admin', false)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('NOORG-011 A name already in use is allowed', async ({ page }) => {
  const fresh = await newAccount(world(), 'Dora Duplicate');
  await openNew(page, world(), fresh);
  await onJoinYourTeam(page);
  await text(page, 'Start a new one').click();
  await field(page, "What's it called?").fill(org());
  await primary(page).click();
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, `Get ${org()} ready`)).toBeVisible();
  // Its own organization: none of ORG's languages or people.
  await tab(page, 'manage').click();
  await expect(text(page, org())).toBeVisible();
  expect(await screenText(page)).not.toContain('Alpha');
  const { data } = await fresh.sb.rpc('my_organizations');
  const mine = (data as { org_id: string }[]).map((o) => o.org_id);
  expect(mine).toHaveLength(1);
  expect(mine[0]).not.toBe(world().orgId);
});

test('NOORG-012 Backing out of Create Organization makes nothing', async ({ page }) => {
  await openFresh(page, world(), 'NOORG');
  await onJoinYourTeam(page);
  await text(page, 'Start a new one').click();
  await field(page, "What's it called?").fill('Never Made');
  await page.getByRole('button', { name: 'License: All rights reserved. Only your organization', exact: true }).click();
  await page.getByRole('radio').locator('visible=true').nth(4).click();
  await button(page, 'Use this license').click();
  await back(page).click();
  await expect(text(page, 'Join your team')).toBeVisible();
  const { sb } = await signIn(world(), 'NOORG');
  expect((await sb.rpc('my_organizations')).data).toEqual([]);
  await text(page, 'Start a new one').click();
  await expect(field(page, "What's it called?")).toHaveValue('');
  await expect(page.getByRole('button', { name: 'License: All rights reserved. Only your organization', exact: true })).toBeVisible();
});

test('NOORG-013 A member starts a second organization', async ({ page }) => {
  const name = `UI Admin Org ${world().run}`;
  await openFresh(page, world(), 'ADMIN');
  await expect(tab(page, 'me')).toBeVisible({ timeout: 60_000 });
  // ADMIN is in two organizations: Switch Organization is on Me itself (decision 71, amended 2026-10-14).
  await tab(page, 'me').click();
  await text(page, 'Switch Organization').click();
  await expect(page.getByRole('button', { name: `${org()}, active` }).or(text(page, `${org()} (active)`))).toBeVisible();
  await expect(text(page, world().org2Name, false)).toBeVisible();
  await expect(text(page, "You'll be its admin. Your place in the others stays as it is.")).toBeVisible();
  await text(page, 'New organization').click();
  await expect(text(page, 'Start your organization')).toBeVisible();
  await back(page).click();
  await expect(text(page, 'New organization')).toBeVisible();
  await text(page, 'New organization').click();
  await field(page, "What's it called?").fill(name);
  await primary(page).click();
  await expect(text(page, `Get ${name} ready`)).toBeVisible({ timeout: 60_000 });
  await expect(text(page, /^Welcome, /)).toBeHidden();
  await tab(page, 'manage').click();
  await expect(text(page, name)).toBeVisible();
  await tab(page, 'me').click();
  await text(page, 'Switch Organization').click();
  await text(page, org(), false).click();
  await expect(tab(page, 'manage')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => tabsShown(page)).toEqual(['work', 'map', 'manage', 'me']);
  await expect(text(page, `Alpha · ${org()}`, false)).toBeVisible();
  await tab(page, 'me').click();
  await text(page, 'Switch Organization').click();
  await text(page, world().org2Name, false).click();
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => tabsShown(page)).toEqual(['work', 'map', 'me']);
});

// ---- Find your organization --------------------------------------------------------------

test('NOORG-014 Find an organization by name or language', async ({ page }) => {
  await openFresh(page, world(), 'NOORG');
  await onJoinYourTeam(page);
  await text(page, 'Find your organization').click();
  const search = field(page, 'Name or language');
  // The run's name keeps this world's row among the first 25.
  const run = world().run;
  await search.fill(`ui test org ${run}`);
  const row = askRow(page, org());
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText(org());
  await expect(row).toContainText('Alpha');
  await expect(row).toContainText('Ask to join');
  await expect(text(page, 'Not here? Ask someone on your team to show you their code.')).toBeVisible();
  await search.fill(world().org2Name.toLowerCase());
  await expect(askRow(page, world().org2Name)).toHaveCount(0);
  // Every row matches by a language now; this world's is among them.
  await search.fill(`ALPHA`);
  await expect(page.getByRole('button', { name: /^Ask .+ to let you in$/ }).first()).toBeVisible();
  await search.fill('zzzz');
  await expect(page.getByRole('button', { name: /^Ask .+ to let you in$/ })).toHaveCount(0);
  await expect(text(page, 'No organization or language matches “zzzz”.')).toBeVisible();
  await search.fill('');
  await expect(page.getByRole('button', { name: /^Ask .+ to let you in$/ }).first()).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Join your team')).toBeVisible();
});

test('NOORG-015 Asking to join from the list', async ({ page }) => {
  const fresh = await newAccount(world(), 'Lia Lister');
  await openNew(page, world(), fresh);
  await onJoinYourTeam(page);
  await findOrg(page);
  await askRow(page, org()).click();
  await expect(text(page, 'Asked').first()).toBeVisible();
  await expect(text(page, `Asked ${org()}`)).toBeVisible();
  await expect(text(page, /^(You'll go straight in when they say yes\. You can close the app; we'll let you know\.|Saved on this device\. It sends when you have a connection\.)$/)).toBeVisible();
  await expect(text(page, "You'll go straight in when they say yes. You can close the app; we'll let you know.")).toBeVisible({ timeout: 30_000 });
  await expect(byId(page, 'header-back')).toBeVisible();
  await button(page, 'Done').click();
  await expect(text(page, `Asked ${org()}`).first()).toBeVisible();
  await expect(text(page, 'Welcome, Lia')).toBeHidden();
  await expect(text(page, "You'll go straight in when they say yes. You can close the app; we'll let you know.")).toBeVisible();
  await expect(text(page, 'Meanwhile')).toBeVisible();
  for (const card of CARDS) await expect(page.getByRole('button', { name: card, exact: true })).not.toHaveAttribute('aria-selected', 'true');
  expect(await requestsFor(fresh)).toHaveLength(1);
});

test('NOORG-016 Asking with no connection', async ({ page, context }) => {
  const fresh = await newAccount(world(), 'Otto Offline');
  await openNew(page, world(), fresh);
  await onJoinYourTeam(page);
  await findOrg(page);
  await back(page).click();
  await settled(page);
  // The answer was kept on this device; offline, the browser's own request fails (a route would still reach the server).
  await page.unroute('**/rest/v1/rpc/listed_organizations*');
  await context.setOffline(true);
  await text(page, 'Find your organization').click();
  await expect(text(page, 'Unable to refresh. Showing what was saved on this device.')).toBeVisible({ timeout: 30_000 });
  await field(page, 'Name or language').fill(org());
  await askRow(page, org()).click();
  await expect(text(page, `Asked ${org()}`)).toBeVisible();
  await expect(text(page, 'Saved on this device. It sends when you have a connection.')).toBeVisible();
  await button(page, 'Done').click();
  await expect(text(page, `Asked ${org()}`).first()).toBeVisible();
  await expect(text(page, 'Your request is saved on this device and sends when you have a connection.')).toBeVisible();
  // Step 4 (restarting offline) needs a phone: a browser cannot load the app with no connection.
  await context.setOffline(false);
  await expect(text(page, "You'll go straight in when they say yes. You can close the app; we'll let you know.")).toBeVisible({ timeout: 60_000 });
  expect(await requestsFor(fresh)).toHaveLength(1);
});

test('NOORG-017 More than 25 listed organizations', async ({ page }) => {
  // 30 listed (seeded for this test): the server's own rows, padded with rows like them when fewer are listed.
  await page.unroute('**/rest/v1/rpc/listed_organizations*');
  await page.route('**/rest/v1/rpc/listed_organizations*', async (route) => {
    const res = await route.fetch();
    const rows = (await res.json()) as { org_id: string; name: string; languages: string[] }[];
    const padded = [...rows];
    for (let i = 0; padded.length < 30; i++) padded.push({ org_id: `pad-${i}`, name: `Zz Listed Org ${String(i).padStart(2, '0')}`, languages: ['Padding'] });
    await route.fulfill({ response: res, json: padded });
  });
  await openFresh(page, world(), 'NOORG');
  await onJoinYourTeam(page);
  await text(page, 'Find your organization').click();
  const rows = page.getByRole('button', { name: /^Ask .+ to let you in$/ }).locator('visible=true');
  await expect(rows).toHaveCount(25, { timeout: 30_000 });
  const more = page.getByRole('button', { name: /^Show \d+ more · \d+ left$/ });
  const [, shown, left] = /^Show (\d+) more · (\d+) left$/.exec((await more.innerText()).trim())!;
  expect(Number(shown)).toBe(Math.min(25, Number(left)));
  await more.click();
  await expect(rows).toHaveCount(25 + Number(shown));
  // A new search starts again from 25 at most; the button shows only when more than 25 match.
  await field(page, 'Name or language').fill('Zz Listed Org 0');
  const few = await rows.count();
  expect(few).toBeLessThanOrEqual(25);
  if (few < 25) await expect(more).toBeHidden();
  await field(page, 'Name or language').fill('UI');
  await expect(rows).toHaveCount(25);
});

test('NOORG-018 No organization is listed', async ({ page }) => {
  await page.unroute('**/rest/v1/rpc/listed_organizations*');
  await page.route('**/rest/v1/rpc/listed_organizations*', (route) => route.fulfill({ json: [] }));
  await openFresh(page, world(), 'NOORG');
  await onJoinYourTeam(page);
  await text(page, 'Find your organization').click();
  await expect(text(page, 'No organizations are listed yet. Ask someone on your team to show you their code.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Ask .+ to let you in$/ })).toHaveCount(0);
});

test('NOORG-019 Asking from Explore, with a message', async ({ page }) => {
  const fresh = await newAccount(world(), 'Ana Explorer');
  await onlyThisWorld(page);
  await openNew(page, world(), fresh);
  await onJoinYourTeam(page);
  await button(page, 'Look around first').click();
  await page.getByRole('button', { name: /^Alpha, / }).locator('visible=true').first().click({ timeout: 30_000 });
  await expect(text(page, `Ask ${org()}`)).toBeVisible();
  await expect(text(page, "They'll let you in, and you'll go straight to your work.")).toBeVisible();
  await expect(page.getByPlaceholder('Who you are, and which team', { exact: true })).toBeVisible();
  await field(page, 'Say something (optional)').fill('I am Ana, from the Alpha team in Juba');
  await expect(primary(page)).toHaveAccessibleName('Ask to join');
  await primary(page).click();
  await expect(text(page, `Asked ${org()}`)).toBeVisible();
  await button(page, 'Done').click();
  await expect(text(page, `Asked ${org()}`).first()).toBeVisible();
  await expect.poll(async () => (await requestsFor(fresh))[0]?.message, { timeout: 30_000 }).toBe('I am Ana, from the Alpha team in Juba');
});

test('NOORG-020 A request that is not sent', async ({ page }) => {
  const fresh = await newAccount(world(), 'Lou Longwind');
  await onlyThisWorld(page);
  await openNew(page, world(), fresh);
  await onJoinYourTeam(page);
  await button(page, 'Look around first').click();
  await page.getByRole('button', { name: /^Alpha, / }).locator('visible=true').first().click({ timeout: 30_000 });
  await field(page, 'Say something (optional)').fill('x'.repeat(2001));
  await primary(page).click();
  await expect(text(page, 'Not sent')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'Request not sent')).toBeVisible();
  await expect(text(page, 'The message is too long.')).toBeVisible();
  await expect(button(page, 'Done')).toHaveCount(0);
  await button(page, 'Back').click();
  await expect(text(page, 'Join your team')).toBeVisible();
  await expect(text(page, /^Asked /)).toBeHidden();
});

// ---- When an admin answers ---------------------------------------------------------------

/** Open "{name} wants to join" on an admin's My Work, behind "n more for you" when other requests come first. */
async function openRequest(page: Page, name: string) {
  const row = text(page, `${name} wants to join`);
  const more = text(page, /^\d+ more for you$/);
  await expect(row.or(more)).toBeVisible({ timeout: 90_000 });
  if (!await row.isVisible()) await more.click();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

/** A fresh account that asked this world's organization from the list, on Join your team. */
async function asked(page: Page, name: string): Promise<Fresh> {
  const fresh = await newAccount(world(), name);
  await openNew(page, world(), fresh);
  await onJoinYourTeam(page);
  await askFromList(page);
  await expect(text(page, "You'll go straight in when they say yes. You can close the app; we'll let you know.")).toBeVisible({ timeout: 60_000 });
  return fresh;
}

test('NOORG-021 An admin lets the person in from My Work @p0', async ({ page, browser }) => {
  const fresh = await asked(page, 'Ivy Invited');
  const context = await newDevice(browser);
  try {
    const coord = await context.newPage();
    await openFresh(coord, world(), 'COORD');
    const row = await openRequest(coord, 'Ivy Invited');
    await expect(text(coord, 'Asked just now')).toBeVisible();
    await row.click();
    await expect(text(coord, 'Ivy Invited wants to join')).toBeVisible();
    for (const choice of ['Translate', 'Check recordings', 'Back-translate', 'Help run the team']) await expect(text(coord, choice, false)).toBeVisible();
    await expect(button(coord, 'Say no')).toBeVisible();
    await text(coord, 'Translate').click();
    await text(coord, 'Alpha').click();
    await button(coord, /^Let Ivy( Invited)? in$/).click();
    await expectToast(coord, 'Ivy Invited is in, as Translator in Alpha.');
    await expect(text(coord, 'Ivy Invited wants to join')).toBeHidden();
  } finally {
    await context.close();
  }
  // Device 1 opens the organization by itself, within a minute.
  await expect.poll(() => screenText(page), { timeout: 75_000 }).toContain(`You're a Translator on the Alpha team at ${org()}.`);
  await expect(text(page, 'Welcome, Ivy')).toBeVisible();
  expect(await tabsShown(page)).toEqual([]);
  await expect(text(page, 'Record passages in your language.')).toBeVisible();
  await button(page, 'Get started').click();
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => tabsShown(page)).toEqual(['work', 'map', 'me']);
  const { data } = await fresh.sb.rpc('my_organizations');
  expect((data as { org_id: string }[]).map((o) => o.org_id)).toEqual([world().orgId]);
});

test('NOORG-023 An admin turns the request down from the Inbox', async ({ page, browser }) => {
  const fresh = await asked(page, 'Dee Declined');
  const context = await newDevice(browser);
  try {
    const admin = await context.newPage();
    await openFresh(admin, world(), 'ADMIN');
    await expect(tab(admin, 'work')).toBeVisible({ timeout: 60_000 });
    await admin.getByRole('button', { name: /Inbox|updates|bell/i }).locator('visible=true').first().click();
    const update = text(admin, /^Dee Declined asked to join /);
    await expect(update).toBeVisible({ timeout: 90_000 });
    await update.click();
    await button(admin, 'Decline').click();
    await expectToast(admin, 'Declined. They were not given access.');
    await expect(update).toBeHidden();
  } finally {
    await context.close();
  }
  await expect(text(page, `${org()} didn't add you`)).toBeVisible({ timeout: 75_000 });
  await expect(text(page, 'An admin there turned down your request. You can ask again below, or ask someone there to show you their code.')).toBeVisible();
  await expect(text(page, 'Join your team')).toBeVisible();
  await expect(text(page, 'Meanwhile')).toBeVisible();
  for (const card of CARDS) await expect(text(page, card)).toBeVisible();
  await askFromList(page);
  await expect.poll(() => requestsFor(fresh).then((r) => r.length), { timeout: 30_000 }).toBe(1);
});

test('NOORG-024 Saying no from the request screen', async ({ page, browser }) => {
  await asked(page, 'Nate Nope');
  const context = await newDevice(browser);
  try {
    const coord = await context.newPage();
    await openFresh(coord, world(), 'COORD');
    const row = await openRequest(coord, 'Nate Nope');
    await row.click();
    await button(coord, 'Say no').click();
    await expectToast(coord, 'You said no to Nate Nope.');
    await expect(text(coord, 'Nate Nope wants to join')).toBeHidden();
  } finally {
    await context.close();
  }
  await expect(text(page, `${org()} didn't add you`)).toBeVisible({ timeout: 75_000 });
});

for (const key of ['TRANS', 'VIEW'] as const) {
  test(`NOORG-025 ${key} Someone who cannot let people in sees no request`, async ({ browser }) => {
    // A request waiting, sent the way the app's account outbox sends it.
    const fresh = await newAccount(world(), 'Penny Pending');
    const sent = await fresh.sb.rpc('create_join_request', { p_org: world().orgId, p_request_id: crypto.randomUUID(), p_message: '' });
    expect(sent.error).toBeNull();
    const context = await newDevice(browser);
    try {
      const page = await context.newPage();
      await openFresh(page, world(), key);
      if (key === 'TRANS') await expect(text(page, 'My Work')).toBeVisible({ timeout: 60_000 });
      else { await tab(page, 'inbox').click({ timeout: 60_000 }); await expect(text(page, 'Inbox').first()).toBeVisible(); }
      await expectSyncIdle(page);
      const body = await screenText(page);
      expect(body).not.toContain('Penny Pending wants to join');
      expect(body).not.toContain('Join request');
      // The requests themselves are not readable to them.
      const { sb } = await signIn(world(), key);
      const { data } = await sb.from('join_requests').select('id').eq('org_id', world().orgId);
      expect(data ?? []).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('NOORG-026 An invite while asking', async ({ page }) => {
  const fresh = await asked(page, 'Iris Both');
  const invite = await issueInvite(world(), base());
  await text(page, 'Scan their code').click();
  await paste(page, 'Or paste the code or link', invite.link);
  await button(page, 'Join as Iris Both').click();
  await expect.poll(() => screenText(page), { timeout: 60_000 }).toContain(`You're a Translator on the Alpha team at ${org()}.`);
  // COORD lets them in by the old request too: nothing breaks, and they are a member once.
  const { sb } = await signIn(world(), 'COORD');
  const reqs = await requestsFor(fresh);
  if (reqs[0]) {
    await sb.rpc('decide_join_request_v2', { p_request_id: reqs[0].id, p_accepted: true, p_role_id: 'translator', p_scope: { level: 'language', languageId: world().languages.A.languageId } });
  }
  const { data } = await fresh.sb.rpc('my_organizations');
  expect((data as { org_id: string }[]).filter((o) => o.org_id === world().orgId)).toHaveLength(1);
  await expect(text(page, 'Welcome, Iris')).toBeVisible();
});
