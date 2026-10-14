// PEOPLE-032 to PEOPLE-044 (docs/ui-test-suite/10-people-and-roles.md):
// roles, and a check's people (decision 91 replaced review teams). Its own
// world, so the role counts are the fixture's.
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { alphaMembers, alphaPage, deviceAs, memberships, orgHome, quietReloads } from './people-helpers';
import { clientAs, send } from './fixture';
import { back, button, expect, expectToast, field, openAs, primary, screenText, test, text, undoToast, useWorld } from './support';

const world = useWorld();
const run = () => world().run;

test.beforeEach(async ({ page }) => { await quietReloads(page); });
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`SCREEN ${info.title}:`, await screenText(page).catch(() => '(closed)'));
});

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (page: Page) => (l: ReturnType<Page['getByRole']>) => l.locator('visible=true');
/** A role's switch, by its words. */
const switchNamed = (page: Page, name: string) => visible(page)(page.getByRole('switch', { name, exact: true })).first();
/** A row that opens something (a Row with onPress is a button). */
const rowButton = (page: Page, name: string) => visible(page)(page.getByRole('button', { name: new RegExp(esc(name)) })).first();
/** The text between two headings (case ignored: section labels are drawn in capitals). */
async function between(page: Page, from: string, to: string | null): Promise<string> {
  const all = await screenText(page);
  const lower = all.toLowerCase();
  const i = lower.indexOf(from.toLowerCase());
  if (i < 0) return '';
  const start = i + from.length;
  const j = to ? lower.indexOf(to.toLowerCase(), start) : -1;
  return j < 0 ? all.slice(start) : all.slice(start, j);
}

/** Org home → Setup → Roles. */
async function rolesHome(page: Page): Promise<void> {
  await orgHome(page, world());
  await text(page, 'Setup').click();
  await text(page, 'Roles').click();
  await expect(text(page, 'Defined at Organization')).toBeVisible();
}

/** Every switch's words and whether it is on, in order. */
async function switches(page: Page): Promise<[string, boolean][]> {
  return visible(page)(page.getByRole('switch')).evaluateAll((els) => els.map((e) => [e.getAttribute('aria-label') ?? '', e.getAttribute('aria-checked') === 'true'] as [string, boolean]));
}

const ALL_SWITCHES = ['Record', 'Add notes and key words', 'Ask for checks', 'Check recordings', 'See everyone’s work', 'Invite people', 'Set up languages',
  'Choose Bibles and guides', 'Choose who checks', 'Assign work', 'Let work past a locked check', 'Make and change roles'];

// ---- Roles ---------------------------------------------------------------------------------

test('PEOPLE-032 Roles, for an organization admin', async ({ page }) => {
  const w = world();
  // A retired role is not listed.
  const org = await clientAs(w, 'ADMIN', 'org');
  const retired = `role-${randomUUID()}`;
  await org.appendMany([
    { type: 'v1.RoleDefined', payload: { roleId: retired, name: `Retired ${run()}`, privileges: ['view_status'] } },
    { type: 'v1.RoleRetired', payload: { roleId: retired } }
  ] as never);
  await send(org as never, 'a retired role');

  await openAs(page, w, 'ADMIN');
  await rolesHome(page);
  await expect(text(page, 'Roles')).toBeVisible();
  await expect(text(page, 'Organization')).toBeVisible();
  await expect(button(page, 'Role')).toBeVisible();
  await expect(text(page, 'Roles are privilege sets without a fixed scope. Scope is chosen when assigning a role to a member. Roles created here can be assigned at any level.')).toBeVisible();
  // The seed roles first, then the organization's own by name; Translator has Review since decision 91.
  // The heading draws before the rows and their member counts, so the list is read until it settles.
  await expect.poll(async () => (await between(page, 'Defined at Organization', null)).trim()).toBe([
    'Organization Admin 1 member · 15 privileges', 'Coordinator 1 member · 14 privileges', 'Translator 2 members · 5 privileges',
    'Reviewer 1 member · 2 privileges', 'Viewer 1 member · 1 privilege', 'Language Lead 1 member · 13 privileges', 'Translator-Reviewer 1 member · 5 privileges'
  ].join(' '));
  expect(await screenText(page)).not.toContain(`Retired ${run()}`);
});

test('PEOPLE-033 A role is twelve switches in three groups', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await rolesHome(page);
  await text(page, 'Language Lead').click();
  await expect(text(page, '1 person')).toBeVisible();
  const all = (await screenText(page)).toLowerCase();
  const groups = ['do the work record add notes and key words ask for checks', 'check the work check recordings see everyone’s work',
    'run the team invite people set up languages choose bibles and guides choose who checks assign work let work past a locked check make and change roles'];
  for (const g of groups) expect(all).toContain(g);
  const lead = await switches(page);
  expect(lead.map(([n]) => n)).toEqual(ALL_SWITCHES);
  expect(lead.filter(([, on]) => !on).map(([n]) => n)).toEqual(['Let work past a locked check', 'Make and change roles']);
  await expect(text(page, 'Where a role applies is chosen for each person: the whole organization or one language, when they are invited or let in.')).toBeVisible();
  await back(page).click();
  await text(page, 'Translator').click();
  const translator = await switches(page);
  expect(translator.filter(([, on]) => on).map(([n]) => n)).toEqual(['Record', 'Add notes and key words', 'Ask for checks', 'Check recordings', 'See everyone’s work']);
});

test('PEOPLE-034 Make a new role', async ({ page, browser }) => {
  const w = world();
  const elder = `Elder ${run()}`;
  await openAs(page, w, 'ADMIN');
  await rolesHome(page);
  await button(page, 'Role').click();
  await expect(text(page, 'New role')).toBeVisible();
  await expect(text(page, 'A new role')).toBeVisible();
  const name = field(page, 'What is it called?');
  await expect(name).toHaveAttribute('placeholder', 'e.g. Back-translator');
  await expect(primary(page)).toBeDisabled();
  await name.fill(elder);
  await expect(primary(page)).toBeEnabled();
  await switchNamed(page, 'Check recordings').click();
  await switchNamed(page, 'Choose who checks').click();
  await primary(page).click();
  const t = await expectToast(page, `${elder} created.`);
  await expect(t.getByTestId('toast-undo')).toHaveCount(0);
  await expect(text(page, elder)).toBeVisible();
  expect(await between(page, elder, null)).toMatch(/^ 0 members · 3 privileges/);

  // Offered under "Other roles" wherever the inviter holds what it gives.
  for (const [who, lead] of [['ADMIN', false], ['COORD', false], ['LADMIN', true]] as const) {
    const d = who === 'ADMIN' ? { page, context: null } : await deviceAs(browser, w, who);
    if (who === 'ADMIN') await openAs(page, w, 'ADMIN');
    await alphaMembers(d.page, w, { lead });
    await button(d.page, 'Invite').click();
    await text(d.page, /^Other roles · \d+$/).click();
    await expect(text(d.page, elder)).toBeVisible();
    await d.context?.close();
  }
});

test('PEOPLE-035 Edit a role, partly-on switches, and Undo', async ({ page }) => {
  const w = world();
  const elder = `Elder ${run()}`;
  const elders = `Elders ${run()}`;
  await openAs(page, w, 'ADMIN');
  await rolesHome(page);
  if (!(await text(page, elder).count())) {
    // PEOPLE-034 did not run in this world: make the role as it does.
    const org = await clientAs(w, 'ADMIN', 'org');
    await org.appendMany([{ type: 'v1.RoleDefined', payload: { roleId: `role-${randomUUID()}`, name: elder, privileges: ['review', 'manage_flows', 'manage_teams'] } }] as never);
    await send(org as never, 'Elder role');
    await openAs(page, w, 'ADMIN');
    await rolesHome(page);
  }
  await text(page, elder).click();
  const choose = switchNamed(page, 'Choose who checks');
  await expect(choose).toHaveAttribute('aria-checked', 'true');
  await choose.click();
  await expect(choose).toHaveAttribute('aria-checked', 'false');
  await choose.click();
  await expect(choose).toHaveAttribute('aria-checked', 'true');
  await field(page, 'Its name').fill(elders);
  await primary(page).click();
  await expectToast(page, `${elders} saved.`);
  await expect(text(page, elders)).toBeVisible();
  // Off then on again sets every privilege it covers: still three.
  expect(await between(page, elders, null)).toMatch(/^ 0 members · 3 privileges/);
  await undoToast(page);
  await expectToast(page, 'Undone.');
  await expect(text(page, elder)).toBeVisible();
  await expect(text(page, elders)).toHaveCount(0);
});

test('PEOPLE-036 Invite someone as a role, and the people who hold it', async ({ page, browser }) => {
  const w = world();
  for (const who of ['ADMIN', 'COORD'] as const) {
    const d = who === 'ADMIN' ? { page, context: null } : await deviceAs(browser, w, who);
    if (who === 'ADMIN') await openAs(page, w, 'ADMIN');
    const p = d.page;
    await rolesHome(p);
    await text(p, 'Translator').click();
    await expect(text(p, 'People with this role')).toBeVisible();
    for (const k of ['TRANS', 'KEPT'] as const) await expect.poll(async () => between(p, 'People with this role', 'Where a role applies')).toContain(`${w.accounts[k].name} Alpha`);
    await text(p, w.accounts.TRANS.name).click();
    await expect(text(p, 'Translator · Alpha')).toBeVisible();
    await back(p).click();
    await text(p, 'Invite someone as Translator').click();
    await expect(text(p, 'Invite by QR')).toBeVisible();
    await expect(text(p, 'Step 2 of 3 — Name')).toBeVisible();
    await expect(text(p, 'Translator')).toBeVisible();
    await d.context?.close();
  }
  // Nobody holds a role made with no members.
  await openAs(page, w, 'ADMIN');
  await rolesHome(page);
  const elder = `Elder ${run()}`;
  if (await text(page, elder).count()) {
    await text(page, elder).click();
    await expect(text(page, 'Nobody has this role yet.')).toBeVisible();
  }
});

test('PEOPLE-037 A coordinator cannot make or change roles', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await rolesHome(page);
  await expect(button(page, 'Role')).toHaveCount(0);
  await text(page, 'Translator').click();
  await expect(text(page, 'View only')).toBeVisible();
  await expect(text(page, 'You do not have permission to edit this role.')).toBeVisible();
  const record = switchNamed(page, 'Record');
  await expect(record).toBeDisabled();
  await record.click({ force: true });
  await expect(record).toHaveAttribute('aria-checked', 'true');
  await expect(text(page, 'Save')).toHaveCount(0);
  await expect(text(page, 'Invite someone as Translator')).toBeVisible();
  await expect(text(page, 'People with this role')).toBeVisible();
  await openAs(page, w, 'COORD');
  await orgHome(page, w);
  await text(page, 'Invite people').click();
  await text(page, /^Other roles · \d+$/).click();
  await expect(text(page, 'Something else: make a new role')).toHaveCount(0);
  await text(page, 'One person, by name').click();
  await back(page).click();
  await expect(text(page, 'Step 1 of 3 — Role')).toBeVisible();
  await expect(text(page, 'Create a new role')).toHaveCount(0);
});

test('PEOPLE-038 Roles at a language are view only', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'LADMIN');
  await alphaPage(page, w, { lead: true });
  await text(page, 'More').click();
  await text(page, 'Roles').click();
  await expect(text(page, 'Language')).toBeVisible();
  await expect(text(page, /Roles are defined for the whole organization, so here they are view only\. Edit them from Organization Home\.$/)).toBeVisible();
  const list = await between(page, 'Defined at Organization', null);
  for (const r of ['Organization Admin', 'Coordinator', 'Translator', 'Reviewer', 'Viewer', 'Language Lead', 'Translator-Reviewer']) {
    expect(list).toContain(`${r} View only · edit from the level where it was defined View only`);
  }
  await text(page, 'Language Lead').click();
  await expect(text(page, 'View only')).toBeVisible();
  await expect(text(page, 'Defined at the organization level. Edit it from Organization Home.')).toBeVisible();
  await expect(text(page, 'Save')).toHaveCount(0);
});

// ---- A check's people (decision 91) ------------------------------------------------------------

/** Alpha's page → Checks → one check. */
async function openCheck(page: Page, check: string, opts: { lead?: boolean } = {}): Promise<void> {
  await alphaPage(page, world(), opts);
  await text(page, 'Checks').click();
  await expect(text(page, 'Add a check')).toBeVisible();
  await text(page, check).click();
  await expect(text(page, /^Check \d+ · Alpha$/)).toBeVisible();
}
/** The names under a check's People, as the screen lists them. */
const peopleOn = (page: Page) => between(page, 'People', 'Questions');

test('PEOPLE-040 A check\'s people, for a language', async ({ page, browser }) => {
  const w = world();
  for (const who of ['ADMIN', 'LADMIN'] as const) {
    const d = who === 'ADMIN' ? { page, context: null } : await deviceAs(browser, w, who);
    if (who === 'ADMIN') await openAs(page, w, 'ADMIN');
    const p = d.page;
    await alphaPage(p, w, { lead: who === 'LADMIN' });
    await text(p, 'Checks').click();
    await expect(text(p, 'Add a check')).toBeVisible();
    // The list names each check's people; a check with none says "Anyone".
    const [rev, trev] = [esc(w.accounts.REV.name), esc(w.accounts.TREV.name)];
    await expect.poll(async () => between(p, 'Peer check', 'Back translation')).toMatch(new RegExp(`${rev}, ${trev}|${trev}, ${rev}`));
    expect(await between(p, 'Community check', 'Consultant check')).toContain('Anyone');
    await text(p, 'Peer check').click();
    await expect(text(p, 'Check 1 · Alpha')).toBeVisible();
    await expect.poll(() => peopleOn(p)).toContain(`${w.accounts.TREV.name} Translator-Reviewer`);
    expect(await peopleOn(p)).toContain(`${w.accounts.REV.name} Reviewer`);
    await expect(text(p, 'Add people')).toBeVisible();
    await d.context?.close();
  }
});

test('PEOPLE-041 Put someone on a check', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await openCheck(page, 'Consultant check');
  await text(page, 'Add people').click();
  await expect(text(page, 'Done')).toBeVisible();
  await page.getByRole('checkbox', { name: new RegExp(`^${esc(w.accounts.TRANS.name)}`) }).locator('visible=true').first().click();
  await primary(page).click();
  await expectToast(page, 'Consultant check: 1 person');
  await expect.poll(() => peopleOn(page)).toContain(`${w.accounts.TRANS.name} Translator`);
  await back(page).click();
  await expect.poll(async () => between(page, 'Consultant check', 'Final approval')).toContain(w.accounts.TRANS.name);
});

test('PEOPLE-042 Take someone off a check, and Undo', async ({ page, browser }) => {
  const w = world();
  for (const who of ['ADMIN', 'LADMIN'] as const) {
    const d = who === 'ADMIN' ? { page, context: null } : await deviceAs(browser, w, who);
    if (who === 'ADMIN') await openAs(page, w, 'ADMIN');
    const p = d.page;
    await openCheck(p, 'Peer check', { lead: who === 'LADMIN' });
    await expect.poll(() => peopleOn(p)).toContain(w.accounts.TREV.name);
    await p.getByRole('button', { name: `Take ${w.accounts.TREV.name} off this check` }).locator('visible=true').first().click();
    await expectToast(p, 'Peer check: 1 person');
    await expect.poll(() => peopleOn(p)).not.toContain(w.accounts.TREV.name);
    await undoToast(p);
    await expect.poll(() => peopleOn(p)).toContain(w.accounts.TREV.name);
    expect(await peopleOn(p)).toContain(w.accounts.REV.name);
    await d.context?.close();
  }
});

test('PEOPLE-044 Only people with Review at the language can be put on a check', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await openCheck(page, 'Final approval');
  await text(page, 'Add people').click();
  await expect(text(page, 'Done')).toBeVisible();
  // Names arrive from the server; until then people show as colours and shapes.
  const offered = async () => (await page.getByRole('checkbox').locator('visible=true').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  await expect.poll(async () => (await offered()).join('|')).toContain(w.accounts.KEPT.name);
  const names = await offered();
  // Translators have Review since decision 91; organization-scope reviewers are offered too; a viewer is not.
  for (const k of ['REV', 'TREV', 'TRANS', 'KEPT', 'LADMIN', 'COORD'] as const) expect(names.some((n) => n.includes(w.accounts[k].name))).toBe(true);
  expect(names.some((n) => n.includes('You'))).toBe(true);
  expect(names.some((n) => n.includes(w.accounts.VIEW.name))).toBe(false);
  // And on the server, a viewer holds no Review at Alpha.
  expect((await memberships(w.orgId, w.accounts.VIEW.id)).filter((m) => !m.removed).map((m) => m.role_id)).toEqual(['viewer']);
});
