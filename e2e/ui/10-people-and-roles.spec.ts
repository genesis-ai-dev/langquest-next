// PEOPLE-001 to PEOPLE-031 (docs/ui-test-suite/10-people-and-roles.md):
// members, inviting, looked-after people, join requests, editing a member
// and the limits on granting. The tests share one world and run in order;
// each says what it leaves behind. Roles, a check's people and what reaches
// a member's own phone are in 10-people-roles-checks and 10-people-on-their-phone.
import type { Page } from '@playwright/test';
import {
  alphaMembers, alphaPage, askToJoin, deviceAs, deviceForNew, inviteRole, inviteRow, issueInviteAs, joinAsNew, membersNamed, memberships, newPerson, orgHome, orgMembers,
  pasteCode, quietReloads, serviceClient, signedOutDevice, toTabs
} from './people-helpers';
import { clientAs, send, signIn } from './fixture';
import {
  back, button, byId, expect, expectSyncIdle, expectToast, field, openAs, primary, screenText, syncNow, tab, tabsShown, test, text,
  useWorld
} from './support';

const world = useWorld();

test.beforeEach(async ({ page }) => { await quietReloads(page); });

// What the screen said when a test failed, for the run's log.
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`SCREEN ${info.title}:`, await screenText(page).catch(() => '(closed)'));
});

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A row that opens something (a Row with onPress is a button). */
const rowButton = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(esc(name)) }).locator('visible=true').first();
/** Everything on screen, in order. Section labels are drawn in capitals, so case is ignored. */
async function expectInOrder(page: Page, ...parts: string[]): Promise<void> {
  await expect.poll(async () => {
    const all = (await screenText(page)).toLowerCase();
    let at = 0;
    for (const p of parts.map((x) => x.toLowerCase())) {
      const i = all.indexOf(p, at);
      if (i < 0) return `missing "${p}" after …${all.slice(Math.max(0, at - 40), at + 80)}…`;
      at = i + p.length;
    }
    return 'ok';
  }).toBe('ok');
}
/** The text between two headings on screen (headings matched ignoring case: section labels are drawn in capitals). */
async function between(page: Page, from: string, to: string | null): Promise<string> {
  const all = await screenText(page);
  const lower = all.toLowerCase();
  const i = lower.indexOf(from.toLowerCase());
  if (i < 0) return '';
  const start = i + from.length;
  const j = to ? lower.indexOf(to.toLowerCase(), start) : -1;
  return j < 0 ? all.slice(start) : all.slice(start, j);
}
/** Copy what "Share as a link" or "Share invite" gives (the web copies it when there is no share sheet). */
async function sharedLink(page: Page, label: 'Share as a link' | 'Share invite'): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await text(page, label).click();
  await expectToast(page, 'Invite link copied. Paste it into a message.');
  return page.evaluate(() => navigator.clipboard.readText());
}
/** The Invite someone screen's roles, "Other roles" opened. */
async function openOtherRoles(page: Page): Promise<void> {
  await text(page, /^Other roles · \d+$/).click();
}
/** A pending request's cleanup: turned down as ADMIN through the server. */
async function decline(requestId: string): Promise<void> {
  const { sb } = await signIn(world(), 'ADMIN');
  const { error } = await sb.rpc('decide_join_request_v2', { p_request_id: requestId, p_accepted: false, p_role_id: null, p_scope: { level: 'org' } });
  if (error) throw new Error(`decline ${requestId}: ${error.message}`);
}
/** A person's memberships in ORG, from the server. */
const membership = (profileId: string) => memberships(world().orgId, profileId);
/**
 * A person an earlier test brought in through the screens, brought in through
 * the server instead when that test did not run in this world (a failed test
 * restarts the worker, and the worker builds a new world).
 */
async function ensureJoined(name: string, roleId: string, opts: { group?: boolean } = {}): Promise<void> {
  const w = world();
  if ((await membersNamed(w.orgId, name)).length) return;
  const { sb } = await signIn(w, 'ADMIN');
  await joinAsNew(sb, w.orgId, roleId, { level: 'language', languageId: w.languages.A.languageId }, name, opts);
}

/** The group link PEOPLE-003 shared, which PEOPLE-004 uses again. */
let groupLink = '';
const run = () => world().run;
const joiner = () => `UI Joiner ${run()}`;
const nyibol = () => `Nyibol ${run()}`;

// ---- Members ------------------------------------------------------------------------------

test('PEOPLE-001 Members at organization level, and by language', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgMembers(page, w);
  await expect(text(page, 'Members')).toBeVisible();
  await expect(button(page, 'Invite')).toBeVisible();
  await expect(text(page, 'People whose role covers every language. Open a group below for each language’s own.')).toBeVisible();
  await expect(text(page, 'Organization members · 3')).toBeVisible();
  // ADMIN sees their own row as "You"; names arrive from the server.
  for (const [who, role] of [['You', 'Organization Admin'], [w.accounts.COORD.name, 'Coordinator'], [w.accounts.VIEW.name, 'Viewer']]) {
    await expect.poll(() => between(page, 'Organization members · 3', 'Expand by'))
      .toMatch(new RegExp(`${esc(who!)} ${esc(w.orgName)} · joined just now ${esc(role!)}`, 'i'));
  }
  // Each editable row opens its member (a chevron); ADMIN may edit everyone here.
  await expect(rowButton(page, w.accounts.VIEW.name)).toBeVisible();
  await expect(text(page, 'By language')).toBeVisible();
  await expect(text(page, '5 members')).toBeVisible();
  await text(page, 'By language').click();
  await expect(text(page, 'Alpha · 5')).toBeVisible();
  const alpha = await between(page, 'Alpha · 5', null);
  for (const k of ['LADMIN', 'TRANS', 'REV', 'TREV', 'KEPT'] as const) expect(alpha).toContain(w.accounts[k].name);

  // COORD: ADMIN's row is editable-looking too; the outranked check is on the member's page (PEOPLE-027).
  const coord = await deviceAs(browser, w, 'COORD');
  await orgMembers(coord.page, w);
  await expect(text(coord.page, 'Organization members · 3')).toBeVisible();
  await expect(rowButton(coord.page, w.accounts.ADMIN.name)).toBeVisible();
  await coord.context.close();
});

test('PEOPLE-002 Members of one language, with higher levels view only', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await expect(text(page, 'People with a role in this language. Open a group below for the others.')).toBeVisible();
  await expect(text(page, 'Language members · 5')).toBeVisible();
  for (const [k, role] of [['LADMIN', 'Language Lead'], ['TRANS', 'Translator'], ['REV', 'Reviewer'], ['TREV', 'Translator-Reviewer'], ['KEPT', 'Translator']] as const) {
    await expect.poll(() => between(page, 'Language members · 5', 'Every language · view only'))
      .toMatch(new RegExp(`${esc(w.accounts[k].name)} Alpha · joined just now ${esc(role)}`, 'i'));
  }
  const higher = await between(page, 'Every language · view only', null);
  for (const who of ['You', w.accounts.COORD.name, w.accounts.VIEW.name]) expect(higher).toContain(who);
  // Higher levels are greyed with a lock: not buttons, and a tap does nothing.
  await expect(rowButton(page, w.accounts.VIEW.name)).toHaveCount(0);
  await text(page, w.accounts.VIEW.name).click();
  await expect(text(page, 'Language members · 5')).toBeVisible();
  await expect(text(page, 'Choose a role, then where it applies.')).toHaveCount(0);

  // LADMIN edits the language's own members.
  const lead = await deviceAs(browser, w, 'LADMIN');
  await alphaMembers(lead.page, w, { lead: true });
  for (const k of ['TRANS', 'REV', 'TREV', 'KEPT'] as const) await expect(rowButton(lead.page, w.accounts[k].name)).toBeVisible();
  await expect(rowButton(lead.page, w.accounts.COORD.name)).toHaveCount(0);
  await lead.context.close();
});

// ---- Inviting ------------------------------------------------------------------------------

test('PEOPLE-003 Invite by group code, and the person joins on a second device @p0', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await button(page, 'Invite').click();
  // Step 2: who, as a card per role with its own Invite, in which language; the group code is the first way offered (decisions 71, 146).
  await expect(text(page, 'Invite someone')).toBeVisible();
  await expect(text(page, 'Alpha')).toBeVisible();
  await expectInOrder(page, 'Who are you inviting?', 'Translators', 'Checkers', 'Back-translators', 'Team leads');
  // Back-translate gives Translator-Reviewer, so three roles are left over (Organization Admin, Viewer, Language Lead).
  await expect.soft(text(page, 'Other roles · 3')).toBeVisible();
  await expect(text(page, 'Something else: make a new role')).toBeVisible();
  await expectInOrder(page, 'In which language?', 'Alpha', 'Bravo');
  await expect(page.getByRole('radio')).toHaveCount(0);

  await inviteRole(page, 'Translators');
  await expect(text(page, 'Translators · Alpha')).toBeVisible();
  await expect(text(page, 'By email')).toBeVisible();
  await expect(text(page, 'One person, by name')).toBeVisible();
  await expect(text(page, 'Ask them to scan this')).toBeVisible();
  await expect(text(page, 'No password needed. Works for a whole group.')).toBeVisible();
  await expect(page.locator('svg').locator('visible=true').first()).toBeVisible();
  await expect(primary(page)).toHaveText(/Done/);
  await expect(text(page, 'Someone else')).toBeVisible();
  groupLink = await sharedLink(page, 'Share as a link');
  expect(groupLink).toMatch(/\/invite#org=.*&token=[0-9a-f]{64}$/);

  // The person joins on their own device, signed out.
  const d = await signedOutDevice(browser);
  await pasteCode(d.page, groupLink);
  await expect(text(d.page, 'Alpha team')).toBeVisible();
  await expect(text(d.page, new RegExp(`^Translator · Alpha · ${esc(w.orgName)}$`))).toBeVisible();
  await primary(d.page).click();
  await expect(text(d.page, 'Join with your invite')).toBeVisible();
  await expect(text(d.page, 'No email or password needed. Your team sees you by this name.')).toBeVisible();
  await d.page.locator('input:visible').first().fill(joiner());
  await primary(d.page).click();
  // The Welcome greets them by their first name.
  await expect(text(d.page, 'Welcome, UI')).toBeVisible({ timeout: 60_000 });
  await expect(text(d.page, `${w.accounts.ADMIN.name} invited you`)).toBeVisible();
  await expect(text(d.page, `You're a Translator on the Alpha team at ${w.orgName}.`)).toBeVisible();
  await expect(text(d.page, 'Nothing to remember')).toBeVisible();
  await text(d.page, 'Get started').click();
  await expect(tab(d.page, 'work')).toBeVisible();
  expect(await tabsShown(d.page)).toEqual(['work', 'map', 'me']);
  await d.context.close();

  // ADMIN: Done, then Members shows them once the organization's stream has synced.
  await primary(page).click();
  await expect(text(page, /^Language members · /)).toBeVisible();
  await syncNow(page);
  await expect(text(page, joiner())).toBeVisible({ timeout: 30_000 });
  expect(await between(page, 'Language members', 'Every language · view only')).toMatch(new RegExp(`${esc(joiner())} Alpha · joined just now Translator`, 'i'));
  await back(page).click();
  await expect(text(page, 'Ready · 4 translators')).toBeVisible();
});

test('PEOPLE-004 A group code works for up to 30 people, for 7 days', async ({ page, browser }) => {
  const w = world();
  if (!groupLink) {
    // PEOPLE-003 did not run in this world: share a group code the same way.
    await openAs(page, w, 'ADMIN');
    await alphaMembers(page, w);
    await button(page, 'Invite').click();
    await inviteRole(page, 'Translators');
    groupLink = await sharedLink(page, 'Share as a link');
    await ensureJoined(joiner(), 'translator', { group: true });
  }
  const d = await signedOutDevice(browser);
  await pasteCode(d.page, groupLink);
  await primary(d.page).click();
  await d.page.locator('input:visible').first().fill(`UI Second ${run()}`);
  await primary(d.page).click();
  await expect(text(d.page, `You're a Translator on the Alpha team at ${w.orgName}.`)).toBeVisible({ timeout: 60_000 });
  await d.context.close();

  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await syncNow(page);
  await expect(text(page, `UI Second ${run()}`)).toBeVisible({ timeout: 30_000 });
  await expect(text(page, joiner())).toBeVisible();

  const row = await inviteRow(groupLink);
  expect(row['max_uses']).toBe(30);
  expect(row['label']).toBe('Alpha team');
  const days = (Date.parse(String(row['expires_at'])) - Date.parse(String(row['created_at']))) / 86_400_000;
  expect(days).toBeGreaterThan(6.99);
  expect(days).toBeLessThan(7.01);
});

test('PEOPLE-005 Invite by email', async ({ page }) => {
  const w = world();
  const address = `ui-${run()}-mail@example.org`;
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await button(page, 'Invite').click();
  await inviteRole(page, 'Translators');
  await text(page, 'By email').click();
  await expect(text(page, 'Invite by email')).toBeVisible();
  await expect(text(page, 'Translator · Alpha')).toBeVisible();
  const email = field(page, 'Email address');
  await expect(email).toHaveAttribute('placeholder', 'name@example.com');
  const sendBtn = button(page, 'Send the invite');
  await expect(sendBtn).toBeDisabled();
  await email.fill('not-an-address');
  await expect(sendBtn).toBeDisabled();
  await email.fill(address);
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();
  // With email set up it goes and the screen goes back; without, it says so.
  const sent = byId(page, 'toast').filter({ hasText: `Invite sent to ${address} as Translator` });
  const notSetUp = text(page, 'Email is not set up yet. Share the code or the invite link instead.');
  await expect(sent.or(notSetUp).first()).toBeVisible({ timeout: 30_000 });
  if (await notSetUp.isVisible()) {
    await expect(text(page, 'The invite was not sent')).toBeVisible();
    // Offline: the invite itself is not made.
    await page.context().setOffline(true);
    await sendBtn.click();
    await expect(text(page, 'Try again when connected.')).toBeVisible();
    await expect(text(page, 'The invite was not sent')).toBeVisible();
    await page.context().setOffline(false);
  } else {
    await expect(text(page, /^Language members · /)).toBeVisible();
  }
});

test('PEOPLE-006 Invite one person by name, and they join @p0', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await button(page, 'Invite').click();
  await inviteRole(page, 'Checkers');
  await text(page, 'One person, by name').click();
  // The role is carried over, so step 1 is skipped.
  await expect(text(page, 'Invite by QR')).toBeVisible();
  await expect(text(page, 'Reviewer')).toBeVisible();
  await expect(text(page, 'Step 2 of 3 — Name')).toBeVisible();
  await expectInOrder(page, 'One person', 'The code works once', 'A group', 'Up to 30 people share one code, for a workshop',
    'Their name is shown to them when they scan, so they know the code is theirs, and offered as their name.');
  await field(page, 'Name').fill(nyibol());
  await primary(page).click();
  await expect(text(page, 'Step 3 of 3 — QR code')).toBeVisible();
  await expect(text(page, nyibol())).toBeVisible();
  // Where the code applies is named (PEOPLE-008).
  await expect(text(page, 'Reviewer · Alpha')).toBeVisible();
  await expect(text(page, 'Hold this up for them to scan. Tap Done when it has been scanned.')).toBeVisible();
  await expect(text(page, 'Or type this code')).toBeVisible();
  await expect(text(page, /^Shown once: leaving this screen loses the code\. It can be used once, until .+\.$/)).toBeVisible();
  await expect(text(page, 'Share invite')).toBeVisible();
  const token = (await text(page, /^[0-9a-f]{64}$/).textContent())!.trim();

  const d = await signedOutDevice(browser);
  await pasteCode(d.page, token);
  await expect(primary(d.page)).toHaveText(/Join as Nyibol/);
  await primary(d.page).click();
  await expect(text(d.page, `You're a Reviewer on the Alpha team at ${w.orgName}.`)).toBeVisible({ timeout: 60_000 });
  await d.context.close();

  await primary(page).click();
  await expect(text(page, /^Language members · /)).toBeVisible();
  await syncNow(page);
  await expect.poll(async () => between(page, 'Language members', 'Every language · view only'), { timeout: 30_000 })
    .toMatch(new RegExp(`${esc(nyibol())} Alpha · joined just now Reviewer`, 'i'));

  // The same code again, on a third device: used.
  const third = await signedOutDevice(browser);
  await pasteCode(third.page, token);
  await expect(text(third.page, `This invite has already been used. Ask ${w.accounts.ADMIN.name} for a new one.`)).toBeVisible();
  await third.context.close();
});

/** Org home → Setup → Roles → a role. */
async function openRole(page: Page, name: string): Promise<void> {
  await orgHome(page, world());
  await text(page, 'Setup').click();
  await text(page, 'Roles').click();
  await expect(text(page, 'Defined at Organization')).toBeVisible();
  await text(page, name).click();
  await expect(text(page, 'People with this role')).toBeVisible();
}

test('PEOPLE-007 Invite by QR from the start: role first, then a group', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await openRole(page, 'Translator');
  await text(page, 'Invite someone as Translator').click();
  await expect(text(page, 'Step 2 of 3 — Name')).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Step 1 of 3 — Role')).toBeVisible();
  await expect(text(page, "Pick the role this person should have. You don't need their email.")).toBeVisible();
  await expect(text(page, 'Already on the team, with a new device?')).toBeVisible();
  await expect(text(page, 'Open them in Members and tap Help them sign in. A new invite would make a second account.')).toBeVisible();
  for (const [role, n] of [['Organization Admin', 15], ['Coordinator', 14], ['Language Lead', 13], ['Translator', 5], ['Reviewer', 2]] as const) {
    await expect(page.getByRole('radio', { name: new RegExp(`^${esc(role)} ${n} permissions`) })).toBeVisible();
  }
  await expect(page.getByRole('radio', { name: /^Viewer 1 permission/ })).toBeVisible();
  await expect(text(page, 'Create a new role')).toBeVisible();
  await page.getByRole('radio', { name: /^Viewer/ }).click();
  await primary(page).click();
  await text(page, 'A group').click();
  const group = field(page, 'Group name');
  await expect(group).toHaveAttribute('placeholder', 'e.g. Juba workshop');
  await group.fill('Juba workshop');
  await primary(page).click();
  await expect(text(page, /^Shown once: leaving this screen loses the code\. Up to 30 people can use it, until .+\.$/)).toBeVisible();
  await expect(text(page, 'Juba workshop')).toBeVisible();
  // Leaving step 3 loses the code, so Back asks first (finding 96); coming back starts again.
  await back(page).click();
  await expect(text(page, 'Leave the code?')).toBeVisible();
  await expect(text(page, 'The code for Juba workshop can’t be shown again. If they haven’t scanned it, make a new one.')).toBeVisible();
  await text(page, 'Stay on the code').click();
  await expect(text(page, 'Juba workshop')).toBeVisible();
  await back(page).click();
  await text(page, 'Leave').click();
  await expect(text(page, 'People with this role')).toBeVisible();
  await text(page, 'Invite someone as Translator').click();
  await expect(text(page, 'Step 2 of 3 — Name')).toBeVisible();
  await expect(field(page, 'Name')).toHaveValue('');
});

test('PEOPLE-008 Invite by QR targets the language chosen on Invite someone', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await text(page, 'Invite people').click();
  await expect(text(page, 'In which language?')).toBeVisible();
  await page.getByRole('button', { name: 'Bravo', exact: true }).locator('visible=true').first().click();
  // A role's card, then its code, where the other ways to invite are (decision 146).
  await inviteRole(page, 'Translators');
  await expect(text(page, 'Translators · Bravo')).toBeVisible();
  await text(page, 'One person, by name').click();
  await expect(text(page, 'Step 2 of 3 — Name')).toBeVisible();
  await field(page, 'Name').fill(`Bravo person ${run()}`);
  await primary(page).click();
  await expect(text(page, 'Translator · Bravo')).toBeVisible();
  const token = (await text(page, /^[0-9a-f]{64}$/).textContent())!.trim();
  expect((await inviteRow(token))['scope']).toEqual({ level: 'language', languageId: w.languages.B.languageId });
});

test('PEOPLE-009 ADMIN Make a new role while inviting', async ({ page }) => {
  const w = world();
  const role = `Storyteller ${run()}`;
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await button(page, 'Invite').click();
  await expect(text(page, /^Other roles · \d+$/)).toBeVisible();
  await text(page, 'Something else: make a new role').click();
  await expect(field(page, 'What is it called?')).toBeVisible();
  await field(page, 'What is it called?').fill(role);
  await page.getByRole('switch', { name: 'Record' }).locator('visible=true').first().click();
  await page.getByRole('switch', { name: 'Ask for checks' }).locator('visible=true').first().click();
  await primary(page).click();
  await expectToast(page, `${role} created.`);
  await expect(text(page, 'Invite someone')).toBeVisible();
  // The role made from here comes back open, with the other roles shown (design principle 12): what it lets them do.
  await expect(text(page, role)).toBeVisible();
  await expectInOrder(page, role, 'What they may do', 'Record', 'Ask for checks');
  await expect(text(page, /^Other roles · \d+$/)).toHaveCount(0);
  await inviteRole(page, role);
  await expect(text(page, `${role} · Alpha`)).toBeVisible();
  await expect(text(page, 'Ask them to scan this')).toBeVisible();
  await expect(text(page, 'No password needed. Works for a whole group.')).toBeVisible();

});

// COORD and LADMIN may not make roles.
for (const [who, lead] of [['COORD', false], ['LADMIN', true]] as const) {
  test(`PEOPLE-009 ${who} May not make a new role while inviting`, async ({ browser }) => {
    const w = world();
    const d = await deviceAs(browser, w, who);
    await alphaMembers(d.page, w, { lead });
    await button(d.page, 'Invite').click();
    await expect(text(d.page, 'Who are you inviting?')).toBeVisible();
    await expect(text(d.page, 'Something else: make a new role')).toHaveCount(0);
    await d.context.close();
  });
}

test('PEOPLE-010 No code is made offline', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await button(page, 'Invite').click();
  await expect(text(page, 'Who are you inviting?')).toBeVisible();
  await page.context().setOffline(true);
  await page.getByTestId('invite-role-Translators').locator('visible=true').first().getByRole('button', { name: 'Invite', exact: true }).click();
  await primary(page).click();
  await expect(text(page, 'No code was made. Try again when connected.')).toBeVisible();
  await text(page, 'One person, by name').click();
  await field(page, 'Name').fill('Offline person');
  await primary(page).click();
  await expect(text(page, 'No code was made')).toBeVisible();
  await expect(text(page, 'Try again when connected.')).toBeVisible();
  await expect(text(page, 'Step 2 of 3 — Name')).toBeVisible();
  await expect(text(page, 'This screen could not open')).toHaveCount(0);
  await page.context().setOffline(false);
});

test('PEOPLE-011 A signed-in account joins by invite', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await button(page, 'Invite').click();
  await inviteRole(page, 'Translators');
  const link = await sharedLink(page, 'Share as a link');

  const noorg = await deviceAs(browser, w, 'NOORG');
  await expect(text(noorg.page, 'Scan their code')).toBeVisible({ timeout: 60_000 });
  await text(noorg.page, 'Scan their code').click();
  await noorg.page.getByPlaceholder('Invite or sign-in code').locator('visible=true').first().fill(link);
  const name = w.accounts.NOORG.name;
  await expect(primary(noorg.page)).toHaveText(new RegExp(`Join as (you|${esc(name)})`));
  await expect(text(noorg.page, new RegExp(`^Not (you|${esc(name)})\\? Sign out first$`))).toBeVisible();
  await primary(noorg.page).click();
  // The Welcome, then My Work with Alpha's map.
  const welcome = text(noorg.page, 'Get started');
  await expect(welcome.or(tab(noorg.page, 'work')).first()).toBeVisible({ timeout: 60_000 });
  if (await welcome.isVisible()) await welcome.click();
  await expect(tab(noorg.page, 'work')).toBeVisible();
  await tab(noorg.page, 'map').click();
  await expect(text(noorg.page, 'Alpha', false)).toBeVisible();
  await noorg.context.close();

  // The same account, not a second one.
  expect((await membership(w.accounts.NOORG.id)).filter((m) => !m.removed)).toEqual([
    { role_id: 'translator', scope: { level: 'language', languageId: w.languages.A.languageId }, removed: false }
  ]);
  await back(page).click().catch(() => {});
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await syncNow(page);
  await expect(text(page, name)).toBeVisible({ timeout: 30_000 });
});

// ---- Looked-after people --------------------------------------------------------------------

test('PEOPLE-014 Who may help someone sign in', async ({ page, browser }) => {
  const w = world();
  await ensureJoined(nyibol(), 'reviewer');
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await text(page, w.accounts.TRANS.name).click();
  await expect(text(page, 'Choose a role, then where it applies.')).toBeVisible();
  // Let the server's answer arrive before saying it is not there.
  await expectSyncIdle(page);
  await expect(text(page, /^Help .* sign in on a new device$/)).toHaveCount(0);
  await back(page).click();

  // A row that opens a sheet, so Save stays the page's one filled button (finding 99).
  const card = async (p: Page, who: string, first: string) => {
    await text(p, who).click();
    await text(p, `Help ${first} sign in on a new device`).click();
    await expect(text(p, `${first} has no email. On a new device, show them a sign-in code.`)).toBeVisible();
    await expect(text(p, 'Their old device is lost or stolen: sign it out')).toBeVisible();
    await expect(text(p, 'Help them sign in')).toBeVisible();
    await byId(p, 'sheet-close').click();
    await back(p).click();
  };
  await card(page, nyibol(), 'Nyibol');
  const lead = await deviceAs(browser, w, 'LADMIN');
  await alphaMembers(lead.page, w, { lead: true });
  await card(lead.page, w.accounts.KEPT.name, 'Kept');
  await card(lead.page, nyibol(), 'Nyibol');
  await lead.context.close();
  const coord = await deviceAs(browser, w, 'COORD');
  await alphaMembers(coord.page, w);
  await card(coord.page, nyibol(), 'Nyibol');
  await coord.context.close();
});

// ---- Join requests ----------------------------------------------------------------------------

/** The Inbox row's words for a join request ("… · {date}" follows). */
const asked = (name: string) => new RegExp(`^${esc(name)} asked to join ${esc(world().orgName)}\\. Assign a role to give them access\\.`);


/** Open My Work's bell (the Inbox), from wherever the page is. */
async function openInbox(page: Page): Promise<void> {
  await toTabs(page);
  await tab(page, 'work').click();
  await page.getByRole('button', { name: /^Updates/ }).locator('visible=true').first().click();
  await expect(text(page, 'Inbox')).toBeVisible();
}

test('PEOPLE-015 Accept a join request from the Inbox @p0', async ({ page, browser }) => {
  const w = world();
  const person = await newPerson(w, `Akol Asker ${run()}`);
  const theirs = await deviceForNew(browser, w, person, { asks: 'Translator from Alpha village' });
  await expect(text(theirs.page, `Asked ${w.orgName}`)).toBeVisible({ timeout: 60_000 });

  await openAs(page, w, 'ADMIN');
  await expect(page.getByRole('button', { name: /^Updates, \d+ new$/ }).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
  await openInbox(page);
  await expect(text(page, 'Join request')).toBeVisible();
  await expect(text(page, asked(person.name))).toBeVisible();
  await text(page, 'Join request').click();
  await expect(button(page, 'Assign role & accept')).toBeVisible();
  await expect(button(page, 'Decline')).toBeVisible();
  await button(page, 'Assign role & accept').click();

  await expect(text(page, `${person.name} wants to join`)).toBeVisible();
  await expect(text(page, /^Asked (just now|\d+ minutes? ago)$/)).toBeVisible();
  await expect(text(page, '“Translator from Alpha village”')).toBeVisible();
  await expect(text(page, 'What will they do?')).toBeVisible();
  await expectInOrder(page, 'In which language?', 'Alpha', 'Bravo', 'All of them');
  await expect(text(page, 'Say no')).toBeVisible();
  await expect(primary(page)).toHaveText(/Let Akol in/);
  await primary(page).click();
  await expectToast(page, `${person.name} is in, as Translator in Alpha.`);
  await expect(text(page, 'Inbox')).toBeVisible();
  await expect(text(page, asked(person.name))).toHaveCount(0);
  await tab(page, 'work').click();
  await expect(text(page, `${person.name} wants to join`)).toHaveCount(0);

  // Their device goes in, as a Translator at Alpha.
  await theirs.page.bringToFront();
  await theirs.page.reload();
  await expect(tab(theirs.page, 'work').or(text(theirs.page, 'Get started')).first()).toBeVisible({ timeout: 90_000 });
  await theirs.context.close();
  expect((await membership(person.id)).filter((m) => !m.removed)).toEqual([
    { role_id: 'translator', scope: { level: 'language', languageId: w.languages.A.languageId }, removed: false }
  ]);
});

test('PEOPLE-016 Join requests on My Work and on the language page', async ({ page }) => {
  const w = world();
  const person = await newPerson(w, `Deng Second ${run()}`);
  await askToJoin(person, w.orgId, 'I check recordings');
  await openAs(page, w, 'COORD');
  await expect(text(page, `${person.name} wants to join`)).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'I check recordings')).toBeVisible();
  await alphaPage(page, w);
  await expect(text(page, `${person.name} wants to join`)).toBeVisible();
  await expect(rowButton(page, `${person.name} wants to join Tap to let them in 1`)).toBeVisible();
  await text(page, `${person.name} wants to join`).click();
  await text(page, 'Check recordings').click();
  await text(page, 'All of them').click();
  await primary(page).click();
  await expectToast(page, `${person.name} is in, as Reviewer.`);
  await orgMembers(page, w);
  await syncNow(page);
  await expect.poll(async () => between(page, 'Organization members', 'Expand by'), { timeout: 30_000 }).toContain(person.name);
  expect(await between(page, 'Organization members', 'Expand by')).toMatch(new RegExp(`${esc(person.name)} .* Reviewer`));
});

test('PEOPLE-017 Several requests, and pending rows in Members', async ({ page }) => {
  const w = world();
  const a = await newPerson(w, `Ayen First ${run()}`);
  const b = await newPerson(w, `Bol Second ${run()}`);
  const ra = await askToJoin(a, w.orgId, 'From the Alpha school');
  const rb = await askToJoin(b, w.orgId, '');
  try {
    await openAs(page, w, 'ADMIN');
    await alphaPage(page, w);
    await expect(rowButton(page, '2 people want to join Tap to let them in 2')).toBeVisible({ timeout: 60_000 });
    await text(page, '2 people want to join').click();
    await expect(text(page, /^Language members · /)).toBeVisible();
    // Both first, each with an amber Pending; one says its message, the other that they asked.
    await expect.poll(() => between(page, 'Language members · ', 'Every language · view only'))
      .toMatch(new RegExp(`^\\d+ \\S+ ${esc(a.name)} From the Alpha school Pending \\S+ ${esc(b.name)} Asked to join Pending`));
    const count = Number(/Language members · (\d+)/i.exec(await screenText(page))![1]);
    const atAlpha = (await serviceClient().from('org_memberships').select('profile_id').eq('org_id', w.orgId).eq('removed', false)
      .eq('language_id', w.languages.A.languageId)).data!.length;
    expect(count).toBe(atAlpha + 2);
    await text(page, a.name).click();
    await expect(text(page, `${a.name} wants to join`)).toBeVisible();
  } finally {
    await decline(ra);
    await decline(rb);
  }
});

test('PEOPLE-018 Decline a request from the Inbox', async ({ page, browser }) => {
  const w = world();
  const person = await newPerson(w, `Garang Third ${run()}`);
  const theirs = await deviceForNew(browser, w, person, { asks: 'Please' });
  await expect(text(theirs.page, `Asked ${w.orgName}`)).toBeVisible({ timeout: 60_000 });
  await openAs(page, w, 'ADMIN');
  await openInbox(page);
  await text(page, 'Join request').click();
  await button(page, 'Decline').click();
  await expectToast(page, 'Declined. They were not given access.');
  await expect(text(page, asked(person.name))).toHaveCount(0);

  // Brought to the front: the app asks again.
  await theirs.page.reload();
  await expect(text(theirs.page, `${w.orgName} didn't add you`)).toBeVisible({ timeout: 60_000 });
  await expect(text(theirs.page, 'An admin there turned down your request. You can ask again below, or ask someone there to show you their code.')).toBeVisible();
  await theirs.context.close();

  // Offline, a second request is not declined.
  const other = await newPerson(w, `Nyandeng Fourth ${run()}`);
  const ro = await askToJoin(other, w.orgId, '');
  try {
    await page.reload();
    await openInbox(page);
    await expect(text(page, asked(other.name))).toBeVisible();
    await text(page, 'Join request').click();
    await page.context().setOffline(true);
    await button(page, 'Decline').click();
    await expectToast(page, 'Not declined. Check your connection and try again.');
    await page.context().setOffline(false);
  } finally {
    await page.context().setOffline(false);
    await decline(ro);
  }
});

test('PEOPLE-019 Say no from the request screen', async ({ page }) => {
  const w = world();
  const person = await newPerson(w, `Achol Fifth ${run()}`);
  await askToJoin(person, w.orgId, 'Hello');
  await openAs(page, w, 'COORD');
  await text(page, `${person.name} wants to join`).click();
  await expect(text(page, 'Say no')).toBeVisible();
  await text(page, 'Say no').click();
  await expectToast(page, `You said no to ${person.name}.`);
  await expect(text(page, `${person.name} wants to join`)).toHaveCount(0);
  await alphaMembers(page, w);
  await expectSyncIdle(page);
  await expect(text(page, person.name)).toHaveCount(0);
  await openInbox(page);
  await expect(text(page, asked(person.name))).toHaveCount(0);
});

test('PEOPLE-020 A language-scope admin never sees join requests', async ({ page, browser }) => {
  const w = world();
  const person = await newPerson(w, `Ladu Sixth ${run()}`);
  const rid = await askToJoin(person, w.orgId, 'Hello lead');
  try {
    // ADMIN sees it.
    const admin = await deviceAs(browser, w, 'ADMIN');
    await expect(text(admin.page, `${person.name} wants to join`)).toBeVisible({ timeout: 60_000 });
    await admin.context.close();

    await openAs(page, w, 'LADMIN');
    await expect(tab(page, 'work')).toBeVisible();
    await expectSyncIdle(page);
    expect(await screenText(page)).not.toContain(person.name);
    await expect(page.getByRole('button', { name: /^Updates, \d+ new$/ })).toHaveCount(0);
    await openInbox(page);
    expect(await screenText(page)).not.toContain('Join request');
    await alphaMembers(page, w, { lead: true });
    await expectSyncIdle(page);
    expect(await screenText(page)).not.toContain(person.name);
    expect(await screenText(page)).not.toContain('Pending');
    await back(page).click();
    expect(await screenText(page)).not.toContain('wants to join');
  } finally {
    await decline(rid);
  }
});

test('PEOPLE-021 The request screen offers only roles you may grant', async ({ page }) => {
  const w = world();
  const person = await newPerson(w, `Kuol Seventh ${run()}`);
  const rid = await askToJoin(person, w.orgId, '');
  try {
    await openAs(page, w, 'COORD');
    await text(page, `${person.name} wants to join`).click();
    await expect(text(page, 'What will they do?')).toBeVisible();
    for (const where of ['Alpha', 'All of them']) {
      await page.getByRole('button', { name: where, exact: true }).locator('visible=true').first().click();
      const other = text(page, /^Other roles · \d+$/);
      if (await other.count()) await other.click();
      await expect(text(page, 'Viewer')).toBeVisible();
      await expect(text(page, 'Organization Admin')).toHaveCount(0);
    }
  } finally {
    await decline(rid);
  }
});

test('PEOPLE-022 Join requests offline', async ({ page }) => {
  const w = world();
  const person = await newPerson(w, `Majok Eighth ${run()}`);
  const rid = await askToJoin(person, w.orgId, 'Offline please');
  try {
    await openAs(page, w, 'ADMIN');
    await expect(text(page, `${person.name} wants to join`)).toBeVisible({ timeout: 60_000 });
    const bell = page.getByRole('button', { name: /^Updates, \d+ new$/ }).locator('visible=true').first();
    await expect(bell).toBeVisible();
    const before = await bell.getAttribute('aria-label');
    await openInbox(page);
    await expect(text(page, asked(person.name))).toBeVisible();
    await page.context().setOffline(true);
    await text(page, 'Join request').click();
    await button(page, 'Assign role & accept').click();
    await expect(text(page, `${person.name} wants to join`)).toBeVisible();
    await primary(page).click();
    await expect(text(page, 'Not saved')).toBeVisible();
    await back(page).click();
    // Offline, Members and My Work keep the request last read, as the bell keeps its count (UI audit, finding 85);
    // letting them in waits for a connection.
    await toTabs(page);
    await orgMembers(page, w);
    await expectSyncIdle(page);
    expect(await screenText(page)).toContain(person.name);
    await toTabs(page);
    await tab(page, 'work').click();
    await expect(text(page, `${person.name} wants to join`)).toBeVisible();
    await expect(text(page, 'Connect to let them in')).toBeVisible();
    await expect(bell).toHaveAttribute('aria-label', before!);
    expect((await membership(person.id)).length).toBe(0);
  } finally {
    await page.context().setOffline(false);
    await decline(rid);
  }
});

// ---- Editing a member -----------------------------------------------------------------------

for (const who of ['ADMIN', 'COORD'] as const) {
  test(`PEOPLE-023 ${who} Change a member's role @p0`, async ({ page, browser }) => {
    const w = world();
    const rev = w.accounts.REV.name;
    const d = who === 'ADMIN' ? { page } : await deviceAs(browser, w, who);
    if (who === 'ADMIN') await openAs(page, w, 'ADMIN');
    const p = d.page;
    await alphaMembers(p, w);
    await text(p, rev).click();
    await expect(text(p, 'Reviewer · Alpha')).toBeVisible();
    await expect(text(p, 'Choose a role, then where it applies.')).toBeVisible();
    const roles = await between(p, 'What will they do?', 'Where?');
    for (const r of ['Coordinator', 'Language Lead', 'Translator', 'Translator-Reviewer', 'Reviewer', 'Viewer']) expect(roles).toContain(r);
    if (who === 'COORD') expect(roles).not.toContain('Organization Admin');
    // At the language's view the grant is at the language (Organization is offered from the organization's view).
    await expectInOrder(p, 'Where?', 'Language', 'Where this person can do what the role lets them do.', 'Language', 'Alpha');
    // Alpha is the language chosen (the web does not expose a radio's state yet; the save below keeps Alpha).
    await expect(p.getByRole('radio', { name: 'Alpha' }).locator('visible=true').first()).toBeVisible();
    await expect(primary(p)).toBeDisabled();
    await p.getByRole('radio', { name: 'Translator-Reviewer' }).locator('visible=true').first().click();
    await expect(primary(p)).toBeEnabled();
    await primary(p).click();
    await expectToast(p, `${rev} is now Translator-Reviewer`);
    // No toast offers Undo (decision 134): the role is changed back the same way.
    await text(p, rev).click();
    await p.getByRole('radio', { name: 'Reviewer', exact: true }).locator('visible=true').first().click();
    await primary(p).click();
    await expectToast(p, `${rev} is now Reviewer`);
    // The change and the change back are written on this device and upload on its next sync: wait
    // for them to be sent before reading the server, and before COORD's device is closed with them.
    await expectSyncIdle(p);
    if (who === 'COORD') await (d as { context: import('@playwright/test').BrowserContext }).context.close();
    await expect.poll(async () => (await membership(w.accounts.REV.id)).find((m) => !m.removed)?.role_id, { timeout: 30_000 }).toBe('reviewer');
  });
}

test('PEOPLE-024 Move a membership between organization and language scope', async ({ page }) => {
  const w = world();
  const view = w.accounts.VIEW.name;
  await openAs(page, w, 'ADMIN');
  await orgMembers(page, w);
  // Other tests in this file add organization members; count from what is here now.
  const heading = text(page, /^Organization members · \d+$/);
  await expect(heading).toBeVisible();
  const atOrg = Number(/(\d+)$/.exec(await heading.innerText())![1]);
  await text(page, view).click();
  await expect(text(page, `Viewer · ${w.orgName}`)).toBeVisible();
  await page.getByRole('button', { name: 'Language', exact: true }).locator('visible=true').first().click();
  await page.getByRole('radio', { name: 'Alpha' }).locator('visible=true').first().click();
  await primary(page).click();
  await expectToast(page, `${view} is now Viewer`);
  await expect(text(page, `Organization members · ${atOrg - 1}`)).toBeVisible();
  await text(page, 'By language').click();
  expect(await between(page, 'Alpha · ', null)).toContain(view);
  await expect.poll(async () => (await membership(w.accounts.VIEW.id)).filter((m) => !m.removed).map((m) => m.scope), { timeout: 30_000 })
    .toEqual([{ level: 'language', languageId: w.languages.A.languageId }]);
  // No toast offers Undo (decision 134): moved back the same way, from its row under Alpha.
  await text(page, view).click();
  await expect(text(page, 'Viewer · Alpha')).toBeVisible();
  await page.getByRole('button', { name: 'Organization', exact: true }).locator('visible=true').first().click();
  await primary(page).click();
  await expectToast(page, `${view} is now Viewer`);
  await expect(text(page, `Organization members · ${atOrg}`)).toBeVisible();
  await expect.poll(async () => (await membership(w.accounts.VIEW.id)).filter((m) => !m.removed).map((m) => m.scope), { timeout: 30_000 })
    .toEqual([{ level: 'org' }]);
});

test('PEOPLE-025 Remove a member', async ({ page }) => {
  const w = world();
  await ensureJoined(joiner(), 'translator', { group: true });
  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await text(page, joiner()).click();
  const remove = text(page, 'Remove from language');
  await expect(remove).toBeVisible();
  // Red, under the form, away from Save role (in the footer).
  const colour = await remove.evaluate((e) => getComputedStyle(e).color);
  const [r, g, b] = colour.match(/\d+/g)!.map(Number);
  expect(r!).toBeGreaterThan(g! + 60);
  expect(r!).toBeGreaterThan(b! + 60);
  // Under the form; Save role is in the footer, apart from it.
  await expectInOrder(page, 'Which language the role is for.', 'Remove from language');
  await expect(primary(page)).toHaveText('Save role');
  expect(await remove.evaluate((e, save) => !!save && save.contains(e), await primary(page).elementHandle())).toBe(false);
  // It asks first (decision 134): nothing puts a member back afterwards. Cancel keeps them.
  const ask = page.getByTestId('sheet').locator('visible=true').last();
  await remove.click();
  await expect(ask).toContainText(`Remove ${joiner()}?`);
  await expect(ask).toContainText('Translator · Alpha');
  await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(remove).toBeVisible();
  // The sheet's button has the link's words. The person stays removed for the rest of this file.
  await remove.click();
  await ask.getByRole('button', { name: 'Remove from language', exact: true }).click();
  await expectToast(page, `${joiner()} no longer has a role in this language`);
  await expect(text(page, /^Language members · /)).toBeVisible();
  await expect(text(page, joiner())).toHaveCount(0);
  // An organization member's link and sheet name the organization.
  await back(page).click();
  await back(page).click();
  await orgMembers(page, w);
  await text(page, w.accounts.VIEW.name).click();
  await text(page, 'Remove from organization').click();
  await expect(ask).toContainText(`Remove ${w.accounts.VIEW.name}?`);
  await expect(ask.getByRole('button', { name: 'Remove from organization', exact: true })).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
  await back(page).click();
});

test('PEOPLE-026 The only one who can manage roles keeps that role', async ({ page }) => {
  // Decided (2026-10-13): an organization always keeps someone who can manage roles; the server refuses
  // the change (_grant_refusal, server/grantsSmoke.sql 11) and the member page says why first.
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgMembers(page, w);
  // ADMIN's own row is "You".
  await text(page, 'You').first().click();
  await expect(text(page, 'You are the only one who can manage roles')).toBeVisible();
  await expect(text(page, 'Give someone else a role with Manage roles first. Then this role can change, or be removed.')).toBeVisible();
  await expect(text(page, 'Remove from organization')).toHaveCount(0);
  // A role without Manage roles cannot be saved.
  await page.getByRole('radio', { name: 'Coordinator', exact: true }).locator('visible=true').first().click();
  await expect(primary(page)).toBeDisabled();
  await page.getByRole('radio', { name: 'Organization Admin', exact: true }).locator('visible=true').first().click();
  await expect(primary(page)).toBeDisabled();
});

test('PEOPLE-027 A member who holds more than you is view only', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await orgMembers(page, w);
  await text(page, w.accounts.ADMIN.name).click();
  await expect(text(page, 'View only')).toBeVisible();
  await expect(text(page, `${w.accounts.ADMIN.name} holds more here than you do, so only someone who holds as much can change this.`)).toBeVisible();
  await expect(text(page, 'What will they do?')).toHaveCount(0);
  await expect(text(page, 'Save role')).toHaveCount(0);
  await expect(text(page, 'Remove from organization')).toHaveCount(0);
});

for (const who of ['VIEW', 'TRANS'] as const) {
  test(`PEOPLE-028 ${who} Opening a member page you may not edit`, async ({ browser }) => {
    const w = world();
    const d = await deviceAs(browser, w, who);
    const p = d.page;
    await expect(tab(p, 'me')).toBeVisible({ timeout: 60_000 });
    expect(await tabsShown(p)).not.toContain('manage');
    // The web's address for the organization's home.
    await p.goto('/manage');
    await expect(tab(p, 'me')).toBeVisible({ timeout: 60_000 });
    await expectSyncIdle(p);
    const all = await screenText(p);
    expect(all).not.toContain('This screen could not open');
    expect(all).not.toMatch(/Organization members · |Language members · /);
    expect(all).not.toContain('Invite people');
    await d.context.close();
  });
}

// ---- The limits on granting --------------------------------------------------------------------

test('PEOPLE-029 A coordinator cannot grant Organization Admin @p0', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await orgHome(page, w);
  await text(page, 'Invite people').click();
  await expectInOrder(page, 'Who are you inviting?', 'Translators', 'Checkers', 'Back-translators', 'Team leads');
  await openOtherRoles(page);
  // "In which language?" sits above the roles (UI audit, finding 93): the other roles run to the end.
  const others = await between(page, 'Team leads', null);
  expect(others).toContain('Viewer');
  expect(others).toContain('Language Lead');
  expect(others).not.toContain('Organization Admin');
  // "Team leads" gives Coordinator.
  await inviteRole(page, 'Team leads');
  const link = await sharedLink(page, 'Share as a link');
  expect((await inviteRow(link))['role_id']).toBe('coordinator');
  await text(page, 'One person, by name').click();
  await back(page).click();
  await expect(text(page, 'Step 1 of 3 — Role')).toBeVisible();
  const qrRoles = await page.getByRole('radio').locator('visible=true').allInnerTexts();
  expect(qrRoles.join('|')).not.toContain('Organization Admin');
  for (const r of ['Coordinator', 'Language Lead', 'Translator', 'Translator-Reviewer', 'Reviewer', 'Viewer']) expect(qrRoles.join('|')).toContain(r);

  await openAs(page, w, 'COORD');
  await orgMembers(page, w);
  await text(page, w.accounts.VIEW.name).click();
  const editable = await between(page, 'What will they do?', 'Where?');
  expect(editable).not.toContain('Organization Admin');
  expect(editable).toContain('Coordinator');

  // The server refuses it when forced, as an invite and as a membership.
  const { sb } = await signIn(w, 'COORD');
  await expect(issueInviteAs(sb, w.orgId, 'org_admin', { level: 'org' })).rejects.toThrow(/may only (invite people to|grant) a role whose privileges you hold/);
  const org = await clientAs(w, 'COORD', 'org');
  await org.appendMany([{ type: 'v1.MemberAdded', payload: { profileId: w.accounts.VIEW.id, roleId: 'org_admin', scope: { level: 'org' } } }] as never);
  await expect(send(org as never, 'COORD makes VIEW an admin')).rejects.toThrow(/refused/);
});

test('PEOPLE-030 A language lead grants only what they hold, only at their language @p0', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'LADMIN');
  await alphaMembers(page, w, { lead: true });
  await button(page, 'Invite').click();
  await expect(text(page, 'Invite someone')).toBeVisible();
  await expect(text(page, 'Alpha')).toBeVisible();
  await expect(text(page, 'In which language?')).toHaveCount(0);
  await expect(text(page, 'All of them')).toHaveCount(0);
  await expectInOrder(page, 'Translators', 'Checkers', 'Back-translators', 'Team leads');
  await expect(text(page, 'Something else: make a new role')).toHaveCount(0);
  await openOtherRoles(page);
  const others = await between(page, 'Team leads', null);
  expect(others).toContain('Viewer');
  for (const no of ['Coordinator', 'Organization Admin']) expect(others).not.toContain(no);
  await inviteRole(page, 'Team leads');
  await expect(text(page, 'Team leads', true)).toBeVisible();
  await expect(text(page, 'Team leads · Alpha')).toHaveCount(0);
  const link = await sharedLink(page, 'Share as a link');
  const row = await inviteRow(link);
  expect(row['role_id']).toBe(w.roles.languageLead);
  expect(row['scope']).toEqual({ level: 'language', languageId: w.languages.A.languageId });
  await text(page, 'One person, by name').click();
  await back(page).click();
  await expect(text(page, 'Step 1 of 3 — Role')).toBeVisible();
  const qrRoles = (await page.getByRole('radio').locator('visible=true').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  for (const [r, n] of [['Language Lead', 13], ['Translator', 5], ['Translator-Reviewer', 5], ['Reviewer', 2], ['Viewer', 1]] as const) {
    expect(qrRoles.some((x) => x.startsWith(`${r} ${n} permission`))).toBe(true);
  }
  for (const no of ['Coordinator', 'Organization Admin']) expect(qrRoles.some((x) => x.startsWith(no))).toBe(false);

  await openAs(page, w, 'LADMIN');
  await alphaMembers(page, w, { lead: true });
  await text(page, w.accounts.TRANS.name).click();
  const roles = await between(page, 'What will they do?', 'Where?');
  for (const no of ['Coordinator', 'Organization Admin']) expect(roles).not.toContain(no);
  for (const r of ['Language Lead', 'Translator', 'Reviewer', 'Viewer']) expect(roles).toContain(r);
  expect(await between(page, 'Where?', "Where this person can use")).not.toContain('Organization');
  await page.getByRole('radio', { name: 'Reviewer', exact: true }).locator('visible=true').first().click();
  await primary(page).click();
  await expectToast(page, `${w.accounts.TRANS.name} is now Reviewer`);
  // No toast offers Undo (decision 134): TRANS's role is changed back the same way.
  await text(page, w.accounts.TRANS.name).click();
  await page.getByRole('radio', { name: 'Translator', exact: true }).locator('visible=true').first().click();
  await primary(page).click();
  await expectToast(page, `${w.accounts.TRANS.name} is now Translator`);
  await expect.poll(async () => (await membership(w.accounts.TRANS.id)).find((m) => !m.removed)?.role_id, { timeout: 30_000 }).toBe('translator');

  // The server refuses what the screens do not offer: Coordinator at Alpha, anything at the organization.
  const { sb } = await signIn(w, 'LADMIN');
  await expect(issueInviteAs(sb, w.orgId, 'coordinator', { level: 'language', languageId: w.languages.A.languageId })).rejects.toThrow(/privileges you hold/);
  await expect(issueInviteAs(sb, w.orgId, 'viewer', { level: 'org' })).rejects.toThrow(/issue_invite_v3/);
  const org = await clientAs(w, 'LADMIN', 'org');
  await org.appendMany([{ type: 'v1.MemberAdded', payload: { profileId: w.accounts.TRANS.id, roleId: 'coordinator', scope: { level: 'language', languageId: w.languages.A.languageId } } }] as never);
  await expect(send(org as never, 'LADMIN makes TRANS a coordinator')).rejects.toThrow(/refused/);
});

test('PEOPLE-031 A language lead cannot act at organization scope', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'LADMIN');
  await alphaPage(page, w, { lead: true });
  await byId(page, 'header-up').click();
  await expect(text(page, 'Invite people')).toBeVisible();
  await text(page, 'Invite people').click();
  await expect(text(page, 'Invite someone')).toBeVisible();
  await expect(text(page, 'All of them')).toHaveCount(0);
  await expect(text(page, 'Bravo')).toHaveCount(0);
  // Each role's card has its own Invite (decision 146); there is no role chosen to start with, nor a Continue.
  await inviteRole(page, 'Translators');
  const link = await sharedLink(page, 'Share as a link');
  expect((await inviteRow(link))['scope']).toEqual({ level: 'language', languageId: w.languages.A.languageId });
  await primary(page).click();
  await text(page, 'Members').click();
  await expect(text(page, /^Organization members · /)).toBeVisible();
  await expect(rowButton(page, w.accounts.COORD.name)).toHaveCount(0);
  await text(page, w.accounts.COORD.name).click();
  await expect(text(page, /^Organization members · /)).toBeVisible();
  await expect(text(page, 'Save role')).toHaveCount(0);
});
