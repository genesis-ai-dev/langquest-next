# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> a new organization on the web, from sign-up to sign-out
- Location: smart-tests/web-smoke/smoke.spec.ts:102:1

# Error details

```
TimeoutError: locator.click: Timeout 60000ms exceeded.
Call log:
  - waiting for getByText('Like most English Bibles', { exact: true }).visible().first()

```

# Page snapshot

```yaml
- generic [ref=e8]:
  - generic [ref=e9]:
    - generic [ref=e10]:
      - generic [ref=e11]: Smoke Org
      - button "smoke-chromium-1791869538672. Show id" [ref=e13] [cursor=pointer]:
        - img [aria-hidden] [ref=e14]:
          - generic [ref=e16]: Sm
        - generic [ref=e17]: smoke-chromium-1791869538672
    - tablist [ref=e18]:
      - tab "Work" [ref=e19] [cursor=pointer]
      - tab "Map" [ref=e22] [cursor=pointer]
      - tab "Reports" [ref=e26] [cursor=pointer]
      - tab "Manage" [ref=e30] [cursor=pointer]
      - tab "Me" [ref=e35] [cursor=pointer]
    - link "Language explorer, opens in a new tab" [ref=e40] [cursor=pointer]:
      - generic [ref=e44]: Language explorer
  - generic [ref=e50]:
    - generic [ref=e53]:
      - button "Close" [ref=e54] [cursor=pointer]
      - generic [ref=e58]:
        - heading "New language" [level=1] [ref=e59]
        - generic [ref=e60]: Step 2 of 5
      - 'button "Help: explain this screen" [ref=e61] [cursor=pointer]'
    - generic [ref=e74]:
      - heading "Choose the numbering" [level=1] [ref=e75]
      - generic [ref=e76]: Connect to load the numberings.
    - button "Back" [ref=e81] [cursor=pointer]
```

# Test source

```ts
  1   | // The web as a published platform (decisions.md 58), end to end against the
  2   | // release build the Worker serves: a new person makes an organization and a
  3   | // language, reads Reports, records a take that outlives a reload before it
  4   | // uploads, meets the one-tab rule, and signs out leaving nothing behind.
  5   | // Each run makes its own account and organization in the local database.
  6   | import AxeBuilder from '@axe-core/playwright';
  7   | import { expect, test, type BrowserContext, type Page } from '@playwright/test';
  8   | import { mkdtempSync, rmSync } from 'node:fs';
  9   | import { tmpdir } from 'node:os';
  10  | import path from 'node:path';
  11  | import { deviceBlobs, settle } from '../evidence';
  12  | 
  13  | const vis = (page: Page, selector: string) => page.locator(selector).locator('visible=true').first();
  14  | const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' }).locator('visible=true').last();
  15  | const body = (page: Page) => page.locator('body').innerText();
  16  | 
  17  | /** Every Content Security Policy refusal on the page, recorded from the start. */
  18  | async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  19  |   await page.addInitScript(() => {
  20  |     const w = window as unknown as { __csp: string[] };
  21  |     w.__csp = [];
  22  |     document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  23  |   });
  24  |   return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  25  | }
  26  | 
  27  | async function start(page: Page): Promise<void> {
  28  |   await page.goto('/', { waitUntil: 'networkidle' });
  29  |   await expect(page.getByText('Create Account', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  30  | }
  31  | 
  32  | async function createAccountAndOrg(page: Page, email: string): Promise<void> {
  33  |   await page.getByText('Create Account', { exact: true }).first().click();
  34  |   await vis(page, 'input[aria-label="Email"]').fill(email);
  35  |   await vis(page, 'input[aria-label="Password"]').fill('smoke-test-1234');
  36  |   await vis(page, 'input[aria-label="Confirm password"]').fill('smoke-test-1234');
  37  |   await button(page, 'Create Account').click();
  38  |   await page.getByText('Start a new one', { exact: true }).locator('visible=true').first().click({ timeout: 60_000 });
  39  |   await vis(page, `input[aria-label="What's it called?"]`).fill('Smoke Org');
  40  |   await button(page, 'Create Organization').click();
  41  |   await button(page, /Add a language/).click({ timeout: 60_000 });
  42  |   // New Language is five steps (decisions 71, 84): its name, what they record, who checks and the
  43  |   // language of its Bibles and guides (each with the suggestion picked), then inviting, which can wait.
  44  |   await vis(page, 'input[aria-label="Its name"]').fill('Dinka');
  45  |   await vis(page, 'input[aria-label="Its code, if it has one"]').fill('din');
  46  |   await button(page, 'Continue').click();
  47  |   // One question a screen (decision 80): the Bible, its numbering (from the list here), how it is divided.
  48  |   await button(page, 'Continue').click({ timeout: 60_000 });
  49  |   await button(page, 'Choose from the list').click({ timeout: 60_000 });
> 50  |   await page.getByText('Like most English Bibles', { exact: true }).locator('visible=true').first().click({ timeout: 60_000 });
      |                                                                                                     ^ TimeoutError: locator.click: Timeout 60000ms exceeded.
  51  |   await button(page, 'Continue').click({ timeout: 60_000 });
  52  |   await button(page, 'Continue').click({ timeout: 60_000 });
  53  |   await button(page, 'Continue').click({ timeout: 60_000 });
  54  |   // The language of its Bibles and study guides, on its own page (decision 84).
  55  |   await expect(page.getByText(/Bibles and study guides be in\?/).first()).toBeVisible({ timeout: 60_000 });
  56  |   await button(page, 'Continue').click({ timeout: 60_000 });
  57  |   await button(page, 'Later').click({ timeout: 60_000 });
  58  |   // A new language leads My Work with its Get ready card (decision 71): "Get Dinka ready · 1 of 4".
  59  |   await expect(page.getByText(/^Get Dinka ready/).first()).toBeVisible({ timeout: 60_000 });
  60  | }
  61  | 
  62  | /** Every file the app's own stores hold in this site's private files (apps/mobile/src/webFiles.ts). */
  63  | async function appFiles(page: Page): Promise<string[]> {
  64  |   return page.evaluate(async () => {
  65  |     type Dir = { entries(): AsyncIterable<[string, { kind: string }]>; getDirectoryHandle(n: string): Promise<Dir> };
  66  |     const out: string[] = [];
  67  |     const walk = async (dir: Dir, at: string) => {
  68  |       for await (const [name, entry] of dir.entries()) {
  69  |         if (entry.kind === 'directory') await walk(await dir.getDirectoryHandle(name), `${at}${name}/`);
  70  |         else out.push(`${at}${name}`);
  71  |       }
  72  |     };
  73  |     const root = (await navigator.storage.getDirectory()) as unknown as Dir;
  74  |     try { await walk(await root.getDirectoryHandle('langquest'), 'langquest/'); } catch { /* none at all */ }
  75  |     return out;
  76  |   });
  77  | }
  78  | 
  79  | async function blobStored(hash: string): Promise<boolean> {
  80  |   const url = process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
  81  |   const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  82  |   if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set (source smart-tests/env.sh).');
  83  |   const res = await fetch(`${url}/rest/v1/events?type=eq.v1.BlobStored&payload->>hash=eq.${hash}&select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  84  |   return res.ok && ((await res.json()) as unknown[]).length > 0;
  85  | }
  86  | 
  87  | /**
  88  |  * WebKit keeps a site's private files only in a profile on disk; in a
  89  |  * throwaway session (as in a private Safari window) the database cannot open,
  90  |  * and the app says so. So WebKit runs in a profile, as Safari does.
  91  |  */
  92  | async function openContext(browserName: string, open: () => Promise<BrowserContext>, persistent: (dir: string) => Promise<BrowserContext>): Promise<{ context: BrowserContext; done: () => Promise<void> }> {
  93  |   if (browserName !== 'webkit') {
  94  |     const context = await open();
  95  |     return { context, done: () => context.close() };
  96  |   }
  97  |   const dir = mkdtempSync(path.join(tmpdir(), 'lq-webkit-'));
  98  |   const context = await persistent(dir);
  99  |   return { context, done: async () => { await context.close(); rmSync(dir, { recursive: true, force: true }); } };
  100 | }
  101 | 
  102 | test('a new organization on the web, from sign-up to sign-out', async ({ browser, browserName, playwright }, info) => {
  103 |   const use = info.project.use;
  104 |   const { context, done } = await openContext(browserName,
  105 |     () => browser.newContext(use),
  106 |     (dir) => playwright.webkit.launchPersistentContext(dir, { ...use, baseURL: use.baseURL }));
  107 |   const page = await context.newPage();
  108 |   const phone = info.project.name === 'chromium-phone';
  109 |   const mic = info.project.name.startsWith('chromium') && !phone;
  110 |   const csp = await watchCsp(page);
  111 |   await start(page);
  112 |   await createAccountAndOrg(page, `smoke-${info.project.name}-${Date.now()}@example.org`);
  113 | 
  114 |   // Reports: a tab on a wide window only (decisions.md 57).
  115 |   const reportsTab = page.getByRole('tab', { name: 'Reports' });
  116 |   if (phone) {
  117 |     await expect(reportsTab).toHaveCount(0);
  118 |   } else {
  119 |     await reportsTab.click();
  120 |     await expect(page.getByText('Recordings on the server', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  121 |     for (const section of ['Languages', 'Geography', 'Monthly ledger', 'Alerts']) {
  122 |       await button(page, section).click();
  123 |       await expect(page.getByRole('heading', { name: section }).locator('visible=true').first()).toBeVisible();
  124 |     }
  125 |   }
  126 | 
  127 |   // The address names the section, a refresh comes back to it, the tab title
  128 |   // says where you are, and the browser's Back steps back inside the app.
  129 |   if (!phone) {
  130 |     await expect(page).toHaveURL(/\/reports$/);
  131 |     await expect(page).toHaveTitle('Reports · LangQuest');
  132 |     await page.reload({ waitUntil: 'networkidle' });
  133 |     await expect(page.getByRole('heading', { name: 'Overview' }).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
  134 |     await button(page, 'Languages').click();
  135 |     await page.getByRole('link', { name: 'Dinka' }).locator('visible=true').first().click();
  136 |     await expect(page).toHaveTitle('Language Report · LangQuest');
  137 |     await page.goBack();
  138 |     await expect(page).toHaveTitle('Reports · LangQuest');
  139 |   }
  140 | 
  141 |   // A take recorded, kept through a reload before it could upload, then uploaded.
  142 |   if (mic) {
  143 |     let block = true;
  144 |     await page.route('**/api/blobs/**', (route) => (block ? route.abort() : route.continue()));
  145 |     await page.getByRole('tab', { name: 'Map' }).click();
  146 |     await button(page, /^Dinka:/).click();
  147 |     await button(page, /^Matthew\./).click();
  148 |     await button(page, /^Chapter 3: Not recorded$/).click();
  149 |     // The passage's path: Record is its main button (decision 71).
  150 |     await button(page, 'Record').click();
```