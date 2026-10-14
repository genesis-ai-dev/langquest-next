// 17. Accessibility and field use on the web (docs/ui-test-suite/17-accessibility-and-field-use.md):
// target sizes, text sizes and axe on the key screens, the whole job by
// keyboard, every interface language, and the browser's language choosing
// the app's. The key screens are walked once (`keyScreens`) and measured for
// A11Y-009, A11Y-010 and axe together.
import { readFileSync } from 'node:fs';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { axeSerious, focused, noHotReload, pressables, smallText, type AxeFinding, type SmallText, type Target } from './17-a11y-helpers';
import { button, byId, expect, expectNothingRefused, expectSent, openAs, openPassage, openSignedOut, primary, tab, test, text, useWorld, waitForApp, type AccountKey, type UiWorld } from './support';

const world = useWorld();

test.beforeEach(async ({ context }) => { await noHotReload(context); });

const PHONE = { width: 430, height: 932 };
/** 1 CSS px is 1 pt at phone width; half a pixel is rounding. */
const MIN = 48 - 0.5;
const PRIMARY = 56 - 0.5;

async function device(browser: Browser, who: AccountKey | null, opts: { locale?: string } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: PHONE, permissions: ['microphone'], ...(opts.locale ? { locale: opts.locale } : {}) });
  await noHotReload(context);
  const page = await context.newPage();
  if (who) await openAs(page, world(), who);
  return { context, page };
}

/** Back to the role's home, as a reload does (the stack starts over; the language and sign-in stay). */
async function home(page: Page): Promise<void> {
  await page.goto('/');
  await waitForApp(page);
}

// ---- the key screens, walked once ---------------------------------------------------------

interface ScreenAudit { screen: string; who: string; targets: Target[]; small: SmallText[]; axe: AxeFinding[] }

/**
 * Controls whose hit area is bigger than their frame on a phone (`hitSlop` in
 * the source). React Native Web ignores hitSlop, so the web measures the
 * frame; these are listed, not failed, when frame + slop reaches 48.
 */
const HIT_SLOP: { match: (t: Target) => boolean; slop: number; where: string }[] = [
  { match: (t) => t.testId === 'toast-undo', slop: 10, where: 'kit.tsx Toast (hitSlop 10)' },
  { match: (t) => /^Hear /.test(t.name) && t.w >= 40, slop: 4, where: 'simple/reference.tsx key word Hear (hitSlop 4)' }
];

let walked: Promise<ScreenAudit[]> | null = null;

/** Every key screen reachable without recording, measured once for this file. */
function keyScreens(browser: Browser): Promise<ScreenAudit[]> {
  walked ??= walk(browser, world());
  return walked;
}

/** Wait until the page stops moving: every test-id'd element's box is the same on two reads, a frame apart. */
async function settled(page: Page): Promise<void> {
  const boxes = () => page.evaluate(() => new Promise<string>((resolve) => requestAnimationFrame(() => resolve(
    [...document.querySelectorAll('[data-testid]')].map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`; }).join('|')
  ))));
  let last = '';
  await expect.poll(async () => { const now = await boxes(); const same = now === last; last = now; return same; }, { timeout: 10_000, intervals: [100] }).toBe(true);
}

async function walk(browser: Browser, w: UiWorld): Promise<ScreenAudit[]> {
  const out: ScreenAudit[] = [];
  const audit = async (page: Page, screen: string, who: string) => {
    // Let sheets and screens finish sliding in: the page's layout is the same on two reads, a frame apart.
    await settled(page);
    out.push({ screen, who, targets: await pressables(page), small: await smallText(page), axe: await axeSerious(page) });
  };

  {
    const { context, page } = await device(browser, null);
    await openSignedOut(page);
    await expect(primary(page)).toHaveText('Sign In');
    await audit(page, 'Sign In', 'GUEST');
    await context.close();
  }
  {
    const { context, page } = await device(browser, 'NOORG');
    await expect(text(page, 'Join your team')).toBeVisible({ timeout: 60_000 });
    await audit(page, 'Join your team', 'NOORG');
    await context.close();
  }
  {
    const { context, page } = await device(browser, 'TRANS');
    await expect(text(page, 'Next for you')).toBeVisible({ timeout: 60_000 });
    await audit(page, 'My Work', 'TRANS');
    await tab(page, 'map').click();
    await expect(button(page, /^Luke\./)).toBeVisible();
    await audit(page, 'the language map', 'TRANS');
    await button(page, /^Luke\./).click();
    await expect(text(page, /of 97 passages/)).toBeVisible();
    await audit(page, "Luke's chapters", 'TRANS');
    await openPassage(page, w, 'P-NEW');
    await expect(primary(page)).toHaveText('Record');
    await audit(page, 'the passage record (P-NEW)', 'TRANS');
    await primary(page).click();
    await expect(byId(page, 'record-button')).toBeVisible();
    await audit(page, 'the recording workspace (P-NEW)', 'TRANS');
    await home(page);
    await openPassage(page, w, 'P-DRAFT');
    await primary(page).click();
    await expect(byId(page, 'record-button')).toBeVisible();
    await expect(button(page, /^Play Part 1$/)).toBeVisible();
    await audit(page, 'the recording workspace with two parts (P-DRAFT)', 'TRANS');
    await byId(page, 'publish-button').click();
    await expect(primary(page)).toHaveText('Publish Version 1');
    await audit(page, 'Publish (P-DRAFT)', 'TRANS');
    await home(page);
    // An unstarted passage nobody was asked to record (PASS-028).
    await openPassage(page, w, 'P-S');
    await button(page, 'Something else?').click();
    await expect(text(page, 'Someone else should do this')).toBeVisible();
    await audit(page, 'Something else? (P-S)', 'TRANS');
    await text(page, 'Someone else should do this').click();
    await expect(text(page, 'Ask someone to record')).toBeVisible();
    await audit(page, 'Ask someone (P-S)', 'TRANS');
    await home(page);
    await tab(page, 'me').click();
    await expect(text(page, 'More settings')).toBeVisible();
    await audit(page, 'Me', 'TRANS');
    await context.close();
  }
  {
    const { context, page } = await device(browser, 'REV');
    await openPassage(page, w, 'P-SUBMITTED');
    await primary(page).click();
    await expect(primary(page)).toHaveText('Next: decide');
    await audit(page, 'Review it: Listen (P-SUBMITTED)', 'REV');
    await primary(page).click();
    await expect(button(page, 'Looks good')).toBeVisible();
    await audit(page, 'Review it: Decide (P-SUBMITTED)', 'REV');
    await home(page);
    await openPassage(page, w, 'P-CHECK');
    await primary(page).click();
    await expect(primary(page)).toHaveText('Next: questions');
    await audit(page, 'Review it: Listen, consultant check (P-CHECK)', 'REV');
    await primary(page).click();
    await expect(primary(page)).toHaveText('Next question');
    await audit(page, 'Review it: Questions (P-CHECK)', 'REV');
    await home(page);
    await openPassage(page, w, 'P-BT');
    await primary(page).click();
    await expect(button(page, /^Record part 1/)).toBeVisible();
    await audit(page, 'back translation (P-BT)', 'REV');
    await context.close();
  }
  {
    const { context, page } = await device(browser, 'COORD');
    await tab(page, 'manage').click();
    await text(page, 'Alpha').click();
    await expect(text(page, /^Ready ·/)).toBeVisible();
    await audit(page, 'the language page (Alpha)', 'COORD');
    await tab(page, 'manage').click();
    await text(page, 'Members').click();
    await expect(button(page, 'Invite')).toBeVisible();
    await audit(page, 'Members', 'COORD');
    await button(page, 'Invite').click();
    await expect(text(page, 'What will they do?')).toBeVisible();
    await audit(page, 'Members → Invite', 'COORD');
    await context.close();
  }
  return out;
}

const size = (t: Target) => `${t.w}×${t.h}`;
const named = (t: Target) => `"${t.name || '(no name)'}" ${t.role}${t.testId ? ` #${t.testId}` : ''}`;

/** Pairs of targets that overlap without one holding the other. */
function overlaps(ts: Target[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i]!, b = ts[j]!;
      // A fixed footer over a list, or a pane beside another, can be scrolled apart.
      if (a.scroller !== b.scroller) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix <= 1 || iy <= 1) continue;
      const inside = (p: Target, q: Target) => p.x >= q.x - 1 && p.y >= q.y - 1 && p.x + p.w <= q.x + q.w + 1 && p.y + p.h <= q.y + q.h + 1;
      if (inside(a, b) || inside(b, a)) continue;
      out.push(`${named(a)} ${size(a)} and ${named(b)} ${size(b)} overlap by ${Math.round(ix)}×${Math.round(iy)}`);
    }
  }
  return out;
}

// ---- tests ----------------------------------------------------------------------------------

test('A11Y-009 touch targets meet 48 pt, and primary actions 56 pt @p0', async ({ browser }, info) => {
  test.setTimeout(600_000); // ceiling: audits every key screen in one test
  const screens = await keyScreens(browser);
  const small: string[] = [];
  const slopped: string[] = [];
  const mains: string[] = [];
  const overlapping: string[] = [];
  for (const s of screens) {
    for (const t of s.targets) {
      if (t.w >= MIN && t.h >= MIN) continue;
      const slop = HIT_SLOP.find((h) => h.match(t));
      if (slop && t.w + 2 * slop.slop >= MIN && t.h + 2 * slop.slop >= MIN) slopped.push(`${s.screen}: ${named(t)} ${size(t)}, ${slop.where}`);
      else small.push(`${s.screen} (${s.who}): ${named(t)} is ${size(t)}`);
    }
    // The screen's main action, and the record button (72 in the footer).
    for (const t of s.targets.filter((x) => x.testId === 'primary-action' || x.testId === 'record-button' || /^(Looks good|Needs changes|Send feedback|Publish Version \d+|Create Organization|Record part \d+)$/.test(x.name))) {
      if (t.h < PRIMARY || (t.testId === 'record-button' && t.w < PRIMARY)) mains.push(`${s.screen}: ${named(t)} is ${size(t)}`);
    }
    overlapping.push(...overlaps(s.targets).map((o) => `${s.screen}: ${o}`));
  }
  const counted = screens.map((s) => `${s.screen}: ${s.targets.length}`).join('; ');
  info.annotations.push({ type: 'screens measured', description: counted });
  if (slopped.length) info.annotations.push({ type: 'under 48 on the web, made up by hitSlop on phones', description: slopped.join('\n') });
  // Every main action and the record button were found on the screens that have them.
  expect(screens.filter((s) => s.targets.some((t) => t.testId === 'primary-action')).length, 'screens with a main action measured').toBeGreaterThanOrEqual(10);
  expect.soft(small, 'pressables under 48×48 (screen, name, size in CSS px = pt)').toEqual([]);
  expect.soft(mains, 'main actions under 56 high').toEqual([]);
  expect.soft(overlapping, 'adjacent targets that overlap').toEqual([]);
});

test('A11Y-010 text never falls below 13 pt', async ({ browser }) => {
  test.setTimeout(600_000); // ceiling: audits every key screen in one test
  const screens = await keyScreens(browser);
  const small = screens.flatMap((s) => s.small.map((x) => `${s.screen} (${s.who}): "${x.text}" at ${x.size}px`));
  expect(small, 'text under 13 px (screen, text, size)').toEqual([]);
});

// ---- keyboard ----------------------------------------------------------------------------

interface Trail { steps: string[]; noRing: string[] }

/** Press Tab (or Shift+Tab) until the focused control's name matches; every stop must show a focus ring. */
async function tabTo(page: Page, trail: Trail, name: RegExp, opts: { back?: boolean; max?: number } = {}): Promise<void> {
  for (let i = 0; i < (opts.max ?? 80); i++) {
    await page.keyboard.press(opts.back ? 'Shift+Tab' : 'Tab');
    const f = await focused(page);
    if (!f) continue;
    if (!f.ring) trail.noRing.push(`${f.role} "${f.name}"`);
    if (name.test(f.name)) { trail.steps.push(f.name); return; }
  }
  throw new Error(`Tab never reached ${name}; went through: ${trail.steps.slice(-3).join(' → ')}`);
}

/** Sign in from Sign In with the keyboard alone. */
async function keyboardSignIn(page: Page, trail: Trail, who: AccountKey): Promise<void> {
  const account = world().accounts[who];
  await openSignedOut(page);
  await tabTo(page, trail, /^Email or sign-in name$/);
  await page.keyboard.type(account.email);
  await tabTo(page, trail, /^Password$/);
  await page.keyboard.type(account.password!);
  // Enter in the password field does not sign in (entry.tsx has no onSubmitEditing); the button does.
  await tabTo(page, trail, /^Sign In$/);
  await page.keyboard.press('Enter');
  // A first sign-in in this browser may show Welcome (once per account); it is left by keyboard too.
  const welcome = page.getByRole('button', { name: /^(Get started|Skip for now)$/ }).locator('visible=true');
  await expect(welcome.first().or(page.getByTestId('tab-work').or(page.getByTestId('tab-map')).locator('visible=true').first())).toBeVisible({ timeout: 60_000 });
  if (await welcome.count()) {
    await tabTo(page, trail, /^(Get started|Skip for now)$/);
    await page.keyboard.press('Enter');
  }
}

test('A11Y-015 the web app works by keyboard alone', async ({ browser }) => {
  test.setTimeout(600_000); // ceiling: audits every key screen in one test
  const w = world();
  const trail: Trail = { steps: [], noRing: [] };
  const adjustable: string[] = [];

  // TRANS: sign in, My Work, then P-SUBMITTED.
  {
    const { context, page } = await device(browser, null);
    await keyboardSignIn(page, trail, 'TRANS');
    await expect(text(page, 'Next for you')).toBeVisible({ timeout: 60_000 });
    await tabTo(page, trail, /^Waiting on others/);
    await page.keyboard.press('Enter');
    await tabTo(page, trail, new RegExp(`^${w.passages['P-SUBMITTED'].label}`));
    await page.keyboard.press('Enter');
    await expect(text(page, 'Version 1 · 0:09', false)).toBeVisible();
    await expect(byId(page, 'header-back')).toBeVisible();
    // The workspace's divider answers the arrow keys.
    await home(page);
    await openPassage(page, w, 'P-NEW');
    await primary(page).focus();
    await page.keyboard.press('Enter');
    await expect(byId(page, 'record-button')).toBeVisible();
    adjustable.push(...await arrowCheck(page, 'Divider between reference and your recording', 'the workspace divider'));
    await context.close();
  }

  // REV: sign in, open the peer check from My Work, listen, and say it looks good.
  {
    const { context, page } = await device(browser, null);
    await keyboardSignIn(page, trail, 'REV');
    await expect(text(page, 'Next for you')).toBeVisible({ timeout: 60_000 });
    await tabTo(page, trail, new RegExp(`^Check ${w.passages['P-SUBMITTED'].label}`));
    await page.keyboard.press('Enter');
    await expect(primary(page)).toHaveText('Next: decide');
    adjustable.push(...await arrowCheck(page, /^Where you are in Version 1/, 'the review timeline'));
    await tabTo(page, trail, /^Play Version 1/);
    await page.keyboard.press('Enter');
    await expect(button(page, 'Pause')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(button(page, /^Play Version 1/)).toBeVisible();
    await tabTo(page, trail, /^Next: decide$/);
    await page.keyboard.press('Enter');
    await expect(button(page, 'Looks good')).toBeVisible();
    await tabTo(page, trail, /^Looks good$/);
    await page.keyboard.press('Space');
    // The verdict is on the passage's path, and it reached the server (the toast may come and go first).
    await expect(button(page, /^Peer check, looks good/)).toBeVisible();
    await expectSent(page, w);
    await expectNothingRefused(page, w);
    await context.close();
  }

  // COORD: Manage → Members → Invite.
  {
    const { context, page } = await device(browser, 'COORD');
    await expect(tab(page, 'manage')).toBeVisible({ timeout: 60_000 });
    await tabTo(page, trail, /^Manage$/);
    await page.keyboard.press('Enter');
    await expect(text(page, 'Members')).toBeVisible();
    await tabTo(page, trail, /^Members\b/);
    await page.keyboard.press('Enter');
    await expect(button(page, 'Invite')).toBeVisible();
    await tabTo(page, trail, /^Invite$/);
    await page.keyboard.press('Enter');
    await expect(text(page, 'What will they do?')).toBeVisible();
    await context.close();
  }

  expect.soft([...new Set(trail.noRing)], 'focused controls without a visible focus ring').toEqual([]);
  expect.soft(adjustable, 'adjustable controls that do not answer Tab and the arrow keys').toEqual([]);
});

/**
 * An adjustable control is reached by Tab and moves with the arrow keys:
 * its value (aria-valuetext / aria-valuenow) changes on ArrowUp or ArrowRight.
 */
async function arrowCheck(page: Page, name: string | RegExp, what: string): Promise<string[]> {
  const slider = page.getByRole('slider', { name, exact: typeof name === 'string' }).locator('visible=true').first();
  await expect(slider, what).toBeVisible();
  const reachable = await slider.evaluate((el) => (el as HTMLElement).tabIndex >= 0);
  if (!reachable) return [`${what} ("${typeof name === 'string' ? name : name.source}") is not reachable by Tab (no tabindex)`];
  const value = () => slider.evaluate((el) => `${el.getAttribute('aria-valuetext') ?? ''}|${el.getAttribute('aria-valuenow') ?? ''}`);
  await slider.focus();
  const before = await value();
  for (const key of ['ArrowUp', 'ArrowRight', 'End', 'Home']) {
    await page.keyboard.press(key);
    if (await value() !== before) return [];
  }
  return [`${what} is reached by Tab but its value does not change with ArrowUp, ArrowRight, End or Home`];
}

// ---- interface languages -----------------------------------------------------------------

const CODES = ['en', 'es', 'pt', 'fr', 'ar', 'sw', 'ha', 'am', 'hi', 'bn', 'ne', 'id', 'zh-Hans', 'th', 'my'] as const;
type Code = (typeof CODES)[number];

function flatten(o: Record<string, unknown>, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flatten(v as Record<string, unknown>, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = String(v);
  }
  return out;
}

const catalogs = new Map<Code, Record<string, string>>();
function catalog(code: Code): Record<string, string> {
  if (!catalogs.has(code)) catalogs.set(code, flatten(JSON.parse(readFileSync(new URL(`../../apps/mobile/src/i18n/${code}.json`, import.meta.url), 'utf8')) as Record<string, unknown>));
  return catalogs.get(code)!;
}

/** The languages' own names, as the picker lists them (i18n/languages.ts). */
const OWN_NAME: Record<Code, string> = {
  en: 'English', es: 'Español', pt: 'Português (Brasil)', fr: 'Français', ar: 'العربية', sw: 'Kiswahili', ha: 'Hausa', am: 'አማርኛ',
  hi: 'हिन्दी', bn: 'বাংলা', ne: 'नेपाली', id: 'Bahasa Indonesia', 'zh-Hans': '简体中文', th: 'ไทย', my: 'မြန်မာ'
};

/** English words that would only show if a word is missing from `code`'s catalog or written straight into the code. */
function englishOnly(code: Code): Set<string> {
  const en = catalog('en');
  const other = catalog(code);
  const same = new Set(Object.keys(en).filter((k) => other[k] === en[k]).map((k) => en[k]));
  return new Set(Object.values(en).filter((v) => !v.includes('{{') && /[A-Za-z]{3}/.test(v) && v.length >= 4 && !same.has(v)));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RAW_KEY = /\b[a-z]+(\.[a-zA-Z0-9_]+){2,}\b/g;

/** Raw keys and English left over on the screen showing. */
async function gaps(page: Page, code: Code, screen: string): Promise<string[]> {
  const nodes = await page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = (n.textContent ?? '').trim();
      const el = n.parentElement;
      if (!v || !el || el.closest('script,style')) continue;
      if (!(el as HTMLElement).offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push(v);
    }
    // Spoken names count too: a raw key in a label is read out.
    for (const el of document.querySelectorAll('[aria-label]')) if ((el as HTMLElement).offsetParent) out.push(el.getAttribute('aria-label')!);
    return out;
  });
  const found: string[] = [];
  for (const v of nodes) for (const m of v.matchAll(RAW_KEY)) if (!/^(www|https?)\b/.test(m[0]) && !/\.(org|com|net|json)$/.test(m[0])) found.push(`${code} ${screen}: raw key "${m[0]}"`);
  if (code !== 'en') {
    const english = englishOnly(code);
    for (const v of new Set(nodes)) if (english.has(v)) found.push(`${code} ${screen}: English "${v}"`);
  }
  return found;
}

test('A11Y-019 every interface language fills the key screens without gaps', async ({ page, browser }) => {
  test.setTimeout(1_200_000); // ceiling: loads every interface language in one test
  const w = world();
  const problems: string[] = [];
  const consoleGaps: string[] = [];
  let showing: Code = 'en';
  page.on('console', (m) => {
    if (/missingKey|missing key/i.test(m.text())) consoleGaps.push(`${showing}: ${m.text().slice(0, 160)}`);
    if (m.type() === 'error') console.log(`[${showing}] console error: ${m.text().slice(0, 600)}`);
  });
  page.on('pageerror', (e) => console.log(`[${showing}] page error: ${e.message}\n${e.stack?.slice(0, 800)}`));
  await openAs(page, w, 'TRANS');
  // REV's back translation, on a second device that is told the language directly.
  const rev = await device(browser, 'REV');
  rev.page.on('console', (m) => { if (/missingKey|missing key/i.test(m.text())) consoleGaps.push(`${showing} (REV): ${m.text().slice(0, 160)}`); });

  for (const code of CODES) {
    const words = catalog(code);
    if (code !== showing) {
      // Me → Language → the language, by its own name; the browser restarts the app in it.
      const was = catalog(showing);
      await tab(page, 'me').click();
      await button(page, new RegExp(`^${esc(was['uiLanguage.row']!)}\\s*${esc(OWN_NAME[showing])}`)).click();
      const reloaded = page.waitForEvent('load');
      await page.getByRole('radio', { name: new RegExp(`^${esc(OWN_NAME[code])}`) }).locator('visible=true').first().click();
      await reloaded;
      await waitForApp(page);
      showing = code;
    }
    await expect(tab(page, 'me'), `${code}: the Me tab in the language`).toHaveText(words['account.tabs.me']!, { timeout: 60_000 });
    // English is where the app starts, following the browser; the others are chosen and kept.
    if (code !== 'en') expect(await page.evaluate(() => localStorage.getItem('ui-language:v1')), `${code}: the choice is kept`).toBe(code);

    // The reload comes back on Me (the address says /settings); let it settle there first.
    if (code !== 'en') await expect(button(page, new RegExp(`^${esc(words['uiLanguage.row']!)}\\s*${esc(OWN_NAME[code])}`))).toBeVisible();
    await tab(page, 'work').click();
    await expect(page).toHaveURL(/\/work$/);
    await expect(text(page, words['work.lead.nextForYou']!, false), `${code}: My Work`).toBeVisible();
    problems.push(...await gaps(page, code, 'My Work'));
    await primary(page).click();
    await expect(byId(page, 'header-back')).toBeVisible();
    await expect(primary(page)).toBeVisible();
    problems.push(...await gaps(page, code, 'the passage record'));
    await primary(page).click();
    await expect(byId(page, 'record-button')).toBeVisible();
    problems.push(...await gaps(page, code, 'the recording workspace'));
    await home(page);
    await tab(page, 'me').click();
    await expect(button(page, new RegExp(`^${esc(words['uiLanguage.row']!)}`))).toBeVisible();
    problems.push(...await gaps(page, code, 'Me'));

    await rev.page.evaluate((c) => localStorage.setItem('ui-language:v1', c), code);
    await home(rev.page);
    await expect(tab(rev.page, 'me')).toHaveText(words['account.tabs.me']!, { timeout: 60_000 });
    await primary(rev.page).click();
    await expect(byId(rev.page, 'header-close')).toBeVisible();
    await expect(rev.page.getByRole('slider').locator('visible=true').first()).toBeVisible();
    problems.push(...await gaps(rev.page, code, 'back translation (REV)'));
  }
  await rev.context.close();
  expect.soft(consoleGaps, 'missing keys reported by i18next').toEqual([]);
  expect(problems, 'raw keys or English left on screen (language, screen, text)').toEqual([]);
});

test('A11Y-020 the browser language picks the app language', async ({ browser }) => {
  const sw = catalog('sw');
  {
    const { context, page } = await device(browser, null, { locale: 'sw' });
    await page.goto('/');
    await expect(primary(page)).toHaveText(sw['entry.signIn.button']!, { timeout: 120_000 });
    const chip = button(page, sw['uiLanguage.chipLabel']!.replace('{{language}}', 'Kiswahili'));
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Kiswahili');
    await context.close();
  }
  {
    // zh-Hant has no catalog: English, and the sheet offers following the browser.
    const { context, page } = await device(browser, null, { locale: 'zh-TW' });
    await page.goto('/');
    await expect(primary(page)).toHaveText('Sign In', { timeout: 120_000 });
    await button(page, 'Language: English. Change it').click();
    const follow = page.getByRole('radio', { name: /^Same as this browser/ }).locator('visible=true').first();
    await expect(follow).toBeVisible();
    await expect(follow).toContainText('Now English');
    // Which row is chosen shows as a check mark; react-native-web drops accessibilityState, so
    // aria-checked is missing on the web (reported with A11Y-axe), and it is not asserted here.
    await context.close();
  }
});

test('A11Y-axe the key screens have no serious or critical axe violations', async ({ browser }) => {
  test.setTimeout(600_000); // ceiling: audits every key screen in one test
  const screens = await keyScreens(browser);
  const found = screens.flatMap((s) => s.axe.map((a) => `${s.screen} (${s.who}): ${a.rule} [${a.impact}] ×${a.count} — ${a.sample}`));
  expect(found, 'axe serious/critical (WCAG 2 A, AA)').toEqual([]);
});
