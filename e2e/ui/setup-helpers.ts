// Helpers for the language setup tests (docs/ui-test-suite/09-language-setup.md):
// getting to Org home, a language's page, its More card, and the setup
// screens behind them, by the words a person taps.
import type { Locator, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { browserStateFor, clientAs, localServer, send, signIn } from './fixture';
import { back, byId, deviceEvents, expect, primary, screenText, tab, text, waitForApp, type AccountKey, type UiWorld } from './support';

const visible = (l: Locator) => l.locator('visible=true');

/** Org home, from the Manage tab (ADMIN, COORD). */
export async function orgHome(page: Page, world: UiWorld): Promise<void> {
  await tab(page, 'manage').click();
  await expect(text(page, world.orgName)).toBeVisible();
}

/** A language's page, from Org home's Languages. */
export async function languagePage(page: Page, world: UiWorld, name: string): Promise<void> {
  await orgHome(page, world);
  await rowNamed(page, name).click();
  await expect(text(page, name)).toBeVisible();
}

/** A row (a Row, a card or a link) whose first line is exactly `label`. */
export function rowNamed(page: Page, label: string | RegExp): Locator {
  return text(page, label);
}

/** Open a closed disclosure ("More", "Setup") if it is closed. */
export async function openDisclosure(page: Page, title: string): Promise<void> {
  await text(page, title).click();
  // It says "Hide" once open; a second tap would close it.
  await expect(visible(page.getByText('Hide', { exact: true })).first()).toBeVisible();
}

/** The More card on a language's page, open. */
export async function more(page: Page): Promise<void> {
  if (await visible(page.getByText('Hide', { exact: true })).count()) return;
  await openDisclosure(page, 'More');
}

/** A language's own template view: They record › Each book's passages (decision 136). */
export async function eachBook(page: Page): Promise<void> {
  await text(page, 'They record').click();
  await text(page, 'Each book\'s passages').click();
}

/** A language's reference material: What helps them › Add more › Everything in your library (decision 136). */
export async function referenceLibrary(page: Page): Promise<void> {
  await text(page, 'What helps them').click();
  await text(page, 'Add more').click();
  await text(page, 'Everything in your library').click();
}

/** The organization's review flows, from its Setup, beside the language open on this device (decision 136). */
export async function reviewFlows(page: Page, w: World): Promise<void> {
  await orgHome(page, w);
  await setup(page);
  await text(page, 'Review Flows').click();
}

/** Setup on Org home, open. */
export async function setup(page: Page): Promise<void> {
  if (await visible(page.getByText('Hide', { exact: true })).count()) return;
  await openDisclosure(page, 'Setup');
}

/** The header's back arrow (or ✕), then wait for `then` to show. */
export async function goBack(page: Page, then?: string | RegExp): Promise<void> {
  await back(page).click();
  if (then) await expect(text(page, then)).toBeVisible();
}

/** A switch by its spoken name. */
export function switchNamed(page: Page, name: string | RegExp): Locator {
  // A Row with a switch is two switches on the web: the row, and the checkbox that carries its state.
  return visible(page.locator('input[role="switch"]').and(page.getByRole('switch', { name }))).first();
}

/** Wait until this device has sent everything it wrote to the organization's stream (G10.3). */
export async function expectOrgSent(page: Page, world: UiWorld, timeoutMs = 30_000): Promise<void> {
  await expect.poll(async () => (await deviceEvents(page, world.orgId, '_org')).filter((r) => r.status === 'pending').length,
    { timeout: timeoutMs, message: 'organization events waiting to upload' }).toBe(0);
}

/** Organization-stream events this device wrote that the server refused. */
export async function orgRefused(page: Page, world: UiWorld): Promise<{ type: string; rejectReason: string | null }[]> {
  return (await deviceEvents(page, world.orgId, '_org')).filter((r) => r.status === 'rejected');
}

/** The open sheet's text, for reading what a sheet says. */
export async function expectOnScreen(page: Page, ...lines: (string | RegExp)[]): Promise<void> {
  for (const l of lines) {
    if (typeof l === 'string') await expect(text(page, l, false)).toBeVisible();
    else await expect.poll(async () => screenText(page)).toMatch(l);
  }
}

/** Expect none of these on screen. */
export async function expectNotOnScreen(page: Page, ...lines: string[]): Promise<void> {
  const all = await screenText(page);
  for (const l of lines) expect(all, `"${l}" should not show`).not.toContain(l);
}

/** The kit's main action. */
export const main = primary;
export const toast = (page: Page) => byId(page, 'toast');

/**
 * Whether Explore lists a language, read as someone signed out reads it
 * (accountData.ts `publicLanguages`, the `public_languages` view). Explore
 * itself shows at most 100 by name, and every test world lists an "Alpha".
 */
export async function publiclyListed(world: UiWorld, key: 'A' | 'B' | 'C'): Promise<boolean> {
  const s = localServer();
  const l = world.languages[key];
  const res = await fetch(`${s.url}/rest/v1/public_languages?select=language_id&org_id=eq.${l.orgId}&language_id=eq.${l.languageId}`,
    { headers: { apikey: s.anon, Authorization: `Bearer ${s.anon}` } });
  if (!res.ok) throw new Error(`public_languages: ${res.status}`);
  return ((await res.json()) as unknown[]).length > 0;
}

/** Whether the organization has the language listed (`language_visibility`, as the app reads it), asked as `who`. */
export async function listingOf(world: UiWorld, key: 'A' | 'B' | 'C', who: 'ADMIN' | 'LADMIN' = 'ADMIN'): Promise<boolean> {
  const { sb } = await signIn(world, who);
  const l = world.languages[key];
  const { data, error } = await sb.from('language_visibility').select('listed').eq('org_id', l.orgId).eq('language_id', l.languageId).maybeSingle();
  if (error) throw new Error(`language_visibility: ${error.message}`);
  return (data as { listed?: boolean } | null)?.listed ?? false;
}

/** A language added to ORG with nothing chosen (as Bravo is), through the real server as ADMIN. Returns its id. */
export async function addBareLanguage(world: UiWorld, name: string, code: string): Promise<string> {
  const org = await clientAs(world, 'ADMIN', 'org');
  const languageId = `L-${code}-${randomUUID().replace(/-/g, '').slice(0, 6)}`;
  await (org as unknown as { appendMany(x: unknown[]): Promise<unknown> }).appendMany([
    { id: randomUUID(), type: 'v1.LanguageAdded', payload: { languageId, name, code, sourceCode: 'eng' } }
  ]);
  await send(org as never, `${name}: LanguageAdded`);
  return languageId;
}

/** Open the app as `who` with the language `languageId` of ORG open (browserStateFor, for a language the world did not make). */
export async function openAsIn(page: Page, world: UiWorld, who: AccountKey, languageId: string, path = '/'): Promise<void> {
  const state = browserStateFor(world, who, 'A');
  state[`language:${world.accounts[who].id}:${world.orgId}`] = languageId;
  await page.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, state);
  await page.goto(path);
  await waitForApp(page);
}

/** Close the open sheet with its ✕ (a sheet that has just opened may not take Escape yet). */
export async function closeSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close', exact: true }).locator('visible=true').last().click();
}
