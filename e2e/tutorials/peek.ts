// Looks at the app as one of the filmed world's people, to write a script:
// a picture and the screen's outline (Playwright's aria snapshot) after it
// opens, and after each tap named on the command line.
//
//   [PEEK_AS=<tutorial id>] [PEEK_WIDE=1] npx tsx e2e/tutorials/peek.ts <out-dir> <ACCOUNT> ['text to tap' | '#test-id' | 'role:Name' ...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildWorld, browserStateFor, type AccountKey } from '../ui/fixture';
import { TUTORIALS } from './all';

const [out = 'e2e/results/peek', as = 'TRANS', ...taps] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
// PEEK_AS=<tutorial id>: that tutorial's names, and what it adds to the world.
const like = TUTORIALS[process.env['PEEK_AS'] ?? 'record-a-passage']!;
const world = await buildWorld({ keptByInvite: true, names: like.names });
await like.prepare?.(world);
writeFileSync(path.join(out, 'world.json'), JSON.stringify(world));
const browser = await chromium.launch();
// PEEK_WIDE=1: a computer's window, for what is done on the web.
const context = await browser.newContext({ viewport: process.env['PEEK_WIDE'] ? { width: 1280, height: 800 } : { width: 430, height: 932 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.addInitScript((entries) => {
  for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
}, browserStateFor(world, as as AccountKey, 'A'));
await page.goto(`http://localhost:${process.env['UI_PORT'] ?? '8787'}`);
await page.waitForFunction(() => !!(globalThis as { __langquestLog?: unknown }).__langquestLog, undefined, { timeout: 120_000 });
await page.waitForTimeout(5000);
const keep = async (n: number) => {
  await page.screenshot({ path: path.join(out, `${n}.png`) });
  writeFileSync(path.join(out, `${n}.txt`), await page.locator('body').ariaSnapshot());
};
await keep(0);
for (const [i, t] of taps.entries()) {
  const target = t.startsWith('#') ? page.getByTestId(t.slice(1)) : t.startsWith('role:') ? page.getByRole('button', { name: t.slice(5) }) : page.getByText(t, { exact: true });
  await target.locator('visible=true').first().click();
  await page.waitForTimeout(2500);
  await keep(i + 1);
}
await browser.close();
console.log(`peeked → ${out}`);
