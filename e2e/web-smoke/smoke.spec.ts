// The web as a published platform (decisions.md 58), end to end against the
// release build the Worker serves: a new person makes an organization and a
// language, reads Reports, records a take that outlives a reload before it
// uploads, meets the one-tab rule, and signs out leaving nothing behind.
// Each run makes its own account and organization in the local database.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deviceBlobs, settle } from '../evidence';

const vis = (page: Page, selector: string) => page.locator(selector).locator('visible=true').first();
const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' }).locator('visible=true').last();
const body = (page: Page) => page.locator('body').innerText();

/** Every Content Security Policy refusal on the page, recorded from the start. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

async function start(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText('Create Account', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
}

async function createAccountAndOrg(page: Page, email: string): Promise<void> {
  await page.getByText('Create Account', { exact: true }).first().click();
  await vis(page, 'input[aria-label="Email"]').fill(email);
  await vis(page, 'input[aria-label="Password"]').fill('smoke-test-1234');
  await vis(page, 'input[aria-label="Confirm password"]').fill('smoke-test-1234');
  await button(page, 'Create Account').click();
  await page.getByText('Start a new one', { exact: true }).locator('visible=true').first().click({ timeout: 60_000 });
  await vis(page, `input[aria-label="What's it called?"]`).fill('Smoke Org');
  await button(page, 'Create Organization').click();
  await button(page, /Add a language/).click({ timeout: 60_000 });
  // New Language shows its six steps first (decision 146): its name and the languages its translators
  // use (decision 193), what they record and how it is broken up, what they will have in those languages,
  // its review flow and its checks (each with the suggestion picked), then inviting, which can wait.
  await button(page, 'Start').click({ timeout: 60_000 });
  await vis(page, 'input[aria-label="Its name"]').fill('Dinka');
  await vis(page, 'input[aria-label="Its code, if it has one"]').fill('din');
  await button(page, 'Continue').click();
  await expect(page.getByText(/translators use\?/).first()).toBeVisible({ timeout: 60_000 });
  await button(page, 'Continue').click({ timeout: 60_000 });
  // One question a screen (decision 80): the Bible, its numbering (from the list here), how it is divided.
  await button(page, 'Continue').click({ timeout: 60_000 });
  await button(page, 'Choose from the list').click({ timeout: 60_000 });
  await page.getByText('Like most English Bibles', { exact: true }).locator('visible=true').first().click({ timeout: 60_000 });
  await button(page, 'Continue').click({ timeout: 60_000 });
  await button(page, 'Continue').click({ timeout: 60_000 });
  // What they will have, in the languages its translators use.
  await expect(page.getByText(/What will help .*team\?/).first()).toBeVisible({ timeout: 60_000 });
  await button(page, 'Continue').click({ timeout: 60_000 });
  // Its review flow, then its checks; adding it ends on inviting.
  await expect(page.getByText('How will recordings get checked?').first()).toBeVisible({ timeout: 60_000 });
  await button(page, 'Continue').click({ timeout: 60_000 });
  await button(page, 'Add Dinka').click({ timeout: 60_000 });
  await button(page, 'Later').click({ timeout: 60_000 });
  // A new language leads My Work with its Get ready card (decision 71): "Get Dinka ready · 1 of 4".
  await expect(page.getByText(/^Get Dinka ready/).first()).toBeVisible({ timeout: 60_000 });
}

/** Every file the app's own stores hold in this site's private files (apps/mobile/src/web/webFiles.ts). */
async function appFiles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    type Dir = { entries(): AsyncIterable<[string, { kind: string }]>; getDirectoryHandle(n: string): Promise<Dir> };
    const out: string[] = [];
    const walk = async (dir: Dir, at: string) => {
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind === 'directory') await walk(await dir.getDirectoryHandle(name), `${at}${name}/`);
        else out.push(`${at}${name}`);
      }
    };
    const root = (await navigator.storage.getDirectory()) as unknown as Dir;
    try { await walk(await root.getDirectoryHandle('langquest'), 'langquest/'); } catch { /* none at all */ }
    return out;
  });
}

async function blobStored(hash: string): Promise<boolean> {
  const url = process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set (source e2e/env.sh).');
  const res = await fetch(`${url}/rest/v1/events?type=eq.v1.BlobStored&payload->>hash=eq.${hash}&select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  return res.ok && ((await res.json()) as unknown[]).length > 0;
}

/**
 * WebKit keeps a site's private files only in a profile on disk; in a
 * throwaway session (as in a private Safari window) the database cannot open,
 * and the app says so. So WebKit runs in a profile, as Safari does.
 */
async function openContext(browserName: string, open: () => Promise<BrowserContext>, persistent: (dir: string) => Promise<BrowserContext>): Promise<{ context: BrowserContext; done: () => Promise<void> }> {
  if (browserName !== 'webkit') {
    const context = await open();
    return { context, done: () => context.close() };
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'lq-webkit-'));
  const context = await persistent(dir);
  return { context, done: async () => { await context.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('a new organization on the web, from sign-up to sign-out', async ({ browser, browserName, playwright }, info) => {
  const use = info.project.use;
  const { context, done } = await openContext(browserName,
    () => browser.newContext(use),
    (dir) => playwright.webkit.launchPersistentContext(dir, { ...use, baseURL: use.baseURL }));
  const page = await context.newPage();
  const phone = info.project.name === 'chromium-phone';
  const mic = info.project.name.startsWith('chromium') && !phone;
  const csp = await watchCsp(page);
  await start(page);
  await createAccountAndOrg(page, `smoke-${info.project.name}-${Date.now()}@example.org`);

  // Reports: a tab on a wide window only (decisions.md 57).
  const reportsTab = page.getByRole('tab', { name: 'Reports' });
  if (phone) {
    await expect(reportsTab).toHaveCount(0);
  } else {
    await reportsTab.click();
    await expect(page.getByText('Recordings on the server', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    for (const section of ['Languages', 'Geography', 'Monthly ledger', 'Alerts']) {
      await button(page, section).click();
      await expect(page.getByRole('heading', { name: section }).locator('visible=true').first()).toBeVisible();
    }
  }

  // The address names the section, a refresh comes back to it, the tab title
  // says where you are, and the browser's Back steps back inside the app.
  if (!phone) {
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page).toHaveTitle('Reports · LangQuest');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Overview' }).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    await button(page, 'Languages').click();
    await page.getByRole('link', { name: 'Dinka' }).locator('visible=true').first().click();
    await expect(page).toHaveTitle('Language Report · LangQuest');
    await page.goBack();
    await expect(page).toHaveTitle('Reports · LangQuest');
  }

  // A take recorded, kept through a reload before it could upload, then uploaded.
  if (mic) {
    let block = true;
    await page.route('**/api/blobs/**', (route) => (block ? route.abort() : route.continue()));
    // An organization with one language: the Map tab opens that language's map (UI audit, finding 82).
    await page.getByRole('tab', { name: 'Map' }).click();
    await button(page, /^Matthew\./).click();
    // A book of FIA passages lists them as rows (decisions.md 166).
    await button(page, /^Matthew 3:1–17\. Not started/).click();
    // The passage's path: Record is its main button (decision 71).
    await button(page, 'Record').click();
    // The workspace's big red button (decision 71).
    await expect(page.getByText(/Recording Version 1/).locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
    await button(page, 'Record').click();
    await page.waitForTimeout(5_000);
    await page.getByRole('button', { name: 'Stop recording', exact: true }).locator('visible=true').last().click({ force: true });
    // Stopped, the session is still open (decision 128): the recording view's Done keeps its parts.
    await page.getByRole('button', { name: 'Done', exact: true }).locator('visible=true').first().click();
    // One part kept: the next one to record is Part 2.
    await expect(page.getByText('Part 2', { exact: true }).locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
    const [hash] = await settle(() => deviceBlobs(page), (b) => b.length > 0, 20_000);
    expect(hash, 'the take is in the browser\'s files').toBeTruthy();
    await page.reload({ waitUntil: 'networkidle' });
    expect(await deviceBlobs(page), 'still there after a reload').toContain(hash);
    block = false;
    await page.unroute('**/api/blobs/**');
    expect(await settle(() => blobStored(hash!), Boolean, 90_000), 'uploaded after the reload').toBe(true);
  }

  // One tab at a time; "Use it here" moves it.
  const second = await context.newPage();
  await second.goto('/', { waitUntil: 'networkidle' });
  await expect(second.getByText('LangQuest is open in another tab')).toBeVisible({ timeout: 30_000 });
  await second.getByRole('button', { name: 'Use it here' }).click();
  await expect(page.getByText('LangQuest moved to another tab')).toBeVisible({ timeout: 30_000 });
  await expect(second.getByText('Smoke Org').first()).toBeVisible({ timeout: 60_000 });

  // No serious accessibility problems on a working screen.
  const axe = await new AxeBuilder({ page: second }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of serious) for (const n of v.nodes.slice(0, 6)) console.log(`[axe] ${v.id} ${n.target.join(' ')} :: ${n.failureSummary?.split('\n').slice(1, 2).join(' ')} :: ${n.html.slice(0, 120)}`);
  expect(serious.map((v) => `${v.id}: ${v.nodes.length}`), 'axe: serious or critical').toEqual([]);

  // Sign out: this browser keeps nothing (decisions.md 11, amended).
  await second.getByRole('tab', { name: 'Me' }).click();
  await button(second, /^Sign out/i).click();
  // Forgetting ends with a fresh page. The signed-out screen shows before
  // that, while the databases are still being deleted (slow in WebKit).
  const forgotten = second.waitForEvent('load', { timeout: 60_000 });
  await button(second, 'Sign Out').click();
  await forgotten;
  await expect(second.getByText('Create Account', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await second.evaluate(() => localStorage.length)).toBe(0);
  expect(await appFiles(second), 'recordings and documents left in this browser').toEqual([]);
  expect(await (await body(second)).includes('Smoke Org')).toBe(false);

  // The privacy policy and deletion page the stores link to open without signing in (decisions.md 46, amended).
  for (const [path, heading] of [['/privacy', 'LangQuest Next Privacy Policy'], ['/delete-account', 'Delete Your LangQuest Next Account']] as const) {
    const res = await second.request.get(path);
    expect(res.status(), path).toBe(200);
    expect(await res.text(), path).toContain(`<h1>${heading}</h1>`);
  }

  expect(await csp(), 'Content Security Policy refusals').toEqual([]);
  await done();
});

// A private Safari window cannot keep LangQuest's files. The storage screen
// says so with one code to pass on; reporting the failure must not fail
// again and give it a new code over and over.
test('storage that will not open shows one code that stays', async ({ page }) => {
  const reports: string[] = [];
  page.on('console', (m) => { if (m.text().includes('] open storage:')) reports.push(m.text()); });
  // The SQLite worker refuses every open, a task later, as a browser without an origin file system does.
  await page.addInitScript(() => {
    class NoStorage extends EventTarget {
      postMessage(m: { id: number }) {
        setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { id: m.id, error: 'UnknownError: no origin file system' } })));
      }
      terminate() {}
    }
    (window as unknown as { Worker: unknown }).Worker = NoStorage;
  });
  await page.goto('/');
  const code = page.getByText(/^Code for your team: /);
  await expect(code).toBeVisible({ timeout: 60_000 });
  const first = await code.innerText();
  // Each failed open answers a task later: let a few dozen tasks go by, so a repeat would have shown.
  await page.evaluate(() => new Promise<void>((resolve) => {
    let n = 0;
    const next = () => (++n < 50 ? setTimeout(next) : resolve());
    next();
  }));
  expect(await code.innerText()).toBe(first);
  expect(reports).toHaveLength(1);
});
