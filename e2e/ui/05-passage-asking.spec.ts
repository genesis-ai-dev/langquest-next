// 05 The passage record (docs/ui-test-suite/05-passage-record.md): publishing
// and then asking, sending a check to its people, Ask someone, and
// withdrawing. These change passages, so this file has a world of its own.
// Recording itself belongs to 06 REC: here one part is recorded with
// Chrome's fake microphone (06-recording-helpers) only to reach the page
// publishing opens.
import type { Browser, Page } from '@playwright/test';
import { button, byId, expect, field, screenText, tab, test, text, type AccountKey } from './support';
import { useRunWorld } from './reviewing-helpers';

import {
  actAs, closeSheet, expand, header, id, mainButton, myWork, openTeamRow, pageFor, passageAs, pathStep, recordAs, recordOnePart,
  refreshRecord, sheet, sheetButtons, somethingElse, sparePassages, teamRow, versionsPage, type Passage
} from './05-passage-helpers';

// One world for the run, kept when a failed test restarts the worker (reviewing-helpers.ts useRunWorld).
const world = useRunWorld('05-asking');
const nameOf = (who: AccountKey) => world().accounts[who].name;
const label = (p: Passage) => (typeof p === 'string' ? world().passages[p].label : p.label);

/** In the workspace: Done, the last look with the next check ready to ask (decision 127). */
async function openDone(page: Page): Promise<void> {
  await expect(byId(page, 'publish-button')).toHaveText('Done');
  await byId(page, 'publish-button').click();
  await expect(text(page, 'Next check')).toBeVisible({ timeout: 30_000 });
}

/** Done, then Send later: Version `n` is published and nobody is asked yet. */
async function publishLater(page: Page, n = 1): Promise<void> {
  await openDone(page);
  await button(page, 'Send later').click();
  await toast(page, `Version ${n} published.`);
}

/** From the record's main button (Record or Continue recording): record one part, unless the draft has some, then Done. */
async function recordAndDone(page: Page, opts: { record?: boolean } = {}): Promise<void> {
  await byId(page, 'primary-action').click();
  await expect(byId(page, 'record-button')).toBeVisible();
  if (opts.record !== false) await recordOnePart(page);
  await openDone(page);
}

async function toast(page: Page, message: string | RegExp): Promise<void> {
  await expect(byId(page, 'toast')).toBeVisible();
  await expect(byId(page, 'toast')).toContainText(message);
}

/** My Work's whole text, after pulling from the server. */

/**
 * P-DRAFT as PASS-012 leaves it: Version 1, with nothing asked of the Peer
 * check (`peerTo` asks it of someone first). A test that runs on a fresh
 * world (Playwright starts one after a failure) sets it up through the
 * server, as TRANS, instead of depending on the tests before it.
 */
async function draftPublished(peerTo?: AccountKey): Promise<void> {
  const w = world();
  const unitId = w.passages['P-DRAFT'].unitId;
  const p = await passageAs(w, 'TRANS', 'P-DRAFT');
  if (!p.recorded) {
    const cards = p.drafts[0]!.cardHashes;
    await actAs(w, 'TRANS', (c) => c.publishVersion({ commandId: id(), unitId, cardHashes: cards, actorId: w.accounts.TRANS.id }), 'TRANS publishes P-DRAFT');
  }
  const open = (await passageAs(w, 'TRANS', 'P-DRAFT')).openRequests.filter((r) => r.kindId === 'peer');
  if (!peerTo && open.length) await actAs(w, 'TRANS', (c) => open.flatMap((r) => c.withdrawRequest({ commandId: id(), requestId: r.id })), 'withdraw');
  if (peerTo && !open.some((r) => r.profileId === w.accounts[peerTo].id)) {
    await actAs(w, 'TRANS', (c) => c.ask({ commandId: id(), unitId, what: 'review', kindId: 'peer', profileId: w.accounts[peerTo].id }), 'ask');
  }
}

// ---- doing what the main button says --------------------------------------------------------

test('PASS-011 Record opens the workspace, and the record updates after publishing @p0', async ({ browser }) => {
  const L = label('P-Q1');
  const page = await recordAs(browser, world(), 'TRANS', 'P-Q1');
  expect(await mainButton(page)).toBe('Record');
  await byId(page, 'primary-action').click();
  await expect(byId(page, 'record-button')).toBeVisible();
  await expect(header(page)).toHaveText(L);
  await recordOnePart(page);
  await publishLater(page);
  await expect(header(page)).toHaveText(L);
  expect(await pathStep(page, 'Record').getAttribute('aria-label')).toMatch(/^\d\. Record\. Version 1 · \d+:\d\d$/);
  expect(await pathStep(page, 'Done').getAttribute('aria-label')).toMatch(/^\d\. Done\. Published (Just now|just now)$/);
  // My Work no longer asks TRANS to record it.
  expect(await myWork(page)).not.toContain(`${L} Record`);
});

test('PASS-012 Done, then asking: the check\'s people are picked @p0', async ({ browser }) => {
  const L = label('P-DRAFT');
  const page = await recordAs(browser, world(), 'TRANS', 'P-DRAFT');
  expect(await mainButton(page)).toBe('Continue recording');
  await recordAndDone(page, { record: false });
  // The last look: the next check and its people, before anything is published.
  const all = await screenText(page);
  expect(all).toContain('NEXT CHECK Peer check');
  expect(all).toMatch(/Peer check (\w\w )*(Rita Reviewer, Trevor Both|Trevor Both, Rita Reviewer) Back translation/);
  await expect(byId(page, 'primary-action')).toHaveText('Ask the Peer check team');
  await expect(button(page, 'Someone else')).toBeVisible();
  await expect(button(page, 'Send later')).toBeVisible();
  // One tap publishes Version 1 and asks.
  await byId(page, 'primary-action').click();
  await toast(page, 'Sent to the Peer check team — anyone on it will see it on My Work');
  await expect(header(page)).toHaveText(L);
  expect(await teamRow(page, 'Peer check').getAttribute('aria-label')).toBe('Peer check, asked the Peer check team');
  // The toast has no Undo (decision 134): History's Withdraw takes the request back.
  await versionsPage(page);
  await expand(page, 'History', /^Version \d+ published$|^Asked /);
  await button(page, 'Withdraw').click();
  await toast(page, 'Request withdrawn');
  await byId(page, 'header-close').click();
  await expect(teamRow(page, 'Peer check')).toHaveAttribute('aria-label', 'Peer check, next');
  // REV's My Work does not hold it.
  const rev = await pageFor(browser, world(), 'REV');
  expect(await myWork(rev)).not.toContain(L);
});

test('PASS-013 Done, then asking someone else', async ({ browser }) => {
  const L = label('P-Q2');
  const page = await recordAs(browser, world(), 'TRANS', 'P-Q2');
  await recordAndDone(page);
  await button(page, 'Someone else').click();
  await expect(header(page)).toHaveText('Ask for Peer check');
  expect(await screenText(page)).toContain(`Ask for Peer check ${L} · Alpha`);
  await byId(page, 'header-close').click();
  await expect(header(page)).toHaveText(L);
  await expect(page.getByRole('heading', { name: 'Version 1 published' })).toHaveCount(0);
});

test('PASS-014 Done, then send later', async ({ browser }) => {
  const L = label('P-Q3');
  const page = await recordAs(browser, world(), 'TRANS', 'P-Q3');
  await recordAndDone(page);
  await button(page, 'Send later').click();
  await toast(page, 'Version 1 published.');
  await expect(header(page)).toHaveText(L);
  expect(await mainButton(page)).toBe('Ask for the peer check');
  await byId(page, 'primary-action').click();
  await expect(header(page)).toHaveText('Ask for a check');
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Version 1 published' })).toHaveCount(0);
});

test('PASS-015 Ask for the check from the main button', async ({ browser }) => {
  const L = label('P-SUBMITTED');
  const page = await recordAs(browser, world(), 'TRANS', 'P-SUBMITTED');
  expect(await mainButton(page)).toBe('Ask for the back translation');
  await byId(page, 'primary-action').click();
  await expect(header(page)).toHaveText('Ask for a check');
  await expect(byId(page, 'header-close')).toBeVisible();
  const all = await screenText(page);
  expect(all).toContain(`Ask for a check ${L} NEXT, ASK FOR A CHECK Back translation`);
  expect(all).toMatch(/Back translation (\w\w )*(Rita Reviewer, Trevor Both|Trevor Both, Rita Reviewer)/);
  await expect(byId(page, 'primary-action')).toHaveText('Ask the Back translation team');
  await button(page, 'Someone else').click();
  await expect(header(page)).toHaveText('Ask for Back translation');
});

// ---- the step sheet ----------------------------------------------------------------------------

test('PASS-022 Send to the check\'s people in one tap', async ({ browser }) => {
  const L = label('P-DRAFT');
  await draftPublished();
  const page = await recordAs(browser, world(), 'TRANS', 'P-DRAFT');
  await openTeamRow(page, 'Peer check');
  await button(page, 'Send to the Peer check team').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await toast(page, 'Sent to the Peer check team — anyone on it will see it on My Work');
  await expect(teamRow(page, 'Peer check')).toHaveAttribute('aria-label', 'Peer check, asked the Peer check team');
  for (const who of ['REV', 'TREV'] as AccountKey[]) {
    const all = await myWork(await pageFor(browser, world(), who), `asked by ${nameOf('TRANS')}`);
    expect(all, who).toContain(L);
    expect(all, who).toContain(`asked by ${nameOf('TRANS')}`);
  }
  const mine = await myWork(page);
  expect(mine).toMatch(/Waiting on others/);
  // Resets: withdraw it from History, so PASS-037 finds the Peer check not asked.
  await refreshRecord(page, world(), 'P-DRAFT');
  await versionsPage(page);
  await expand(page, 'History', /^Version \d+ published$|^Asked /);
  await button(page, 'Withdraw').click();
  await toast(page, 'Request withdrawn');
});

// ---- Ask someone -------------------------------------------------------------------------------

test('PASS-037 Ask someone for a check: who is listed first @p0', async ({ browser }) => {
  const L = label('P-DRAFT');
  await draftPublished();
  const page = await recordAs(browser, world(), 'TRANS', 'P-DRAFT');
  await openTeamRow(page, 'Peer check');
  // The Peer check's own, the first in the sheet.
  await sheet(page).getByRole('button', { name: 'Send to someone else', exact: true }).first().click();
  await expect(header(page)).toHaveText('Ask for Peer check');
  const all = await screenText(page);
  expect(all).toContain(`Ask for Peer check ${L} · Alpha`);
  await expect(byId(page, 'header-close')).toBeVisible();
  expect(await tab(page, 'map').isVisible()).toBe(false);
  await expect(button(page, 'Someone on the team')).toBeVisible();
  await expect(button(page, 'Someone without the app')).toBeVisible();
  const radios = await page.getByRole('radio').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null)
    // Without the avatars' initials ("Ri", "Tr").
    .map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').replace(/(^| )([A-Z][a-z] )+/g, '$1').trim()));
  // The check's team first, then its people, then everyone else who holds Review here, by name.
  expect(radios[0]).toMatch(/^The Peer check team (Rita Reviewer, Trevor Both|Trevor Both, Rita Reviewer)$/);
  const people = radios.slice(1);
  expect(people).toEqual([
    `${nameOf('REV')} Reviewer`, `${nameOf('TREV')} Translator-Reviewer`,
    ...(['ADMIN', 'COORD', 'KEPT', 'LADMIN'] as AccountKey[]).map(nameOf).sort().map((n) => expect.stringMatching(new RegExp(`^${n} `)))
  ]);
  expect(all.toLowerCase()).toContain('everyone else');
  expect(all).not.toContain(nameOf('VIEW'));
  await expect(byId(page, 'primary-action')).toHaveText('Ask the Peer check team');
});

test('PASS-038 Ask a person, with directions and a question, and no due date @p0', async ({ browser }) => {
  const L = label('P-DRAFT');
  const trev = nameOf('TREV');
  await draftPublished();
  const page = await recordAs(browser, world(), 'TRANS', 'P-DRAFT');
  await openTeamRow(page, 'Peer check');
  // The Peer check's own, the first in the sheet.
  await sheet(page).getByRole('button', { name: 'Send to someone else', exact: true }).first().click();
  await page.getByRole('radio', { name: new RegExp(`^${trev}`) }).locator('visible=true').first().click();
  await expect(byId(page, 'primary-action')).toHaveText('Ask Trevor');
  await field(page, 'Or type them').fill("Listen for the parable's ending");
  await field(page, 'Ask something specific').fill("Is the host's anger clear?");
  await button(page, 'Add question').click();
  const listed = await screenText(page);
  expect(listed.toLowerCase()).toContain("they’ll answer");
  expect(listed).toContain("Is the host's anger clear? Yes/No");
  await expect(button(page, 'Remove question')).toBeVisible();
  // Due dates are gone (decision 126): no By when, no date to type.
  expect((await screenText(page)).toLowerCase()).not.toMatch(/by when|\bdue\b/);
  await expect(field(page, /^Or a date, like /)).toHaveCount(0);
  await byId(page, 'primary-action').click();
  await toast(page, `${trev} will see it on their My Work`);
  await expect(header(page)).toHaveText(L);
  await expect(teamRow(page, 'Peer check')).toHaveAttribute('aria-label', `Peer check, asked ${trev}`);
  await versionsPage(page);
  await expand(page, 'History', /^Version \d+ published$|^Asked /);
  expect(await screenText(page)).toMatch(new RegExp(`Asked ${trev} for Peer check You · .+ — open Withdraw`));
  const all = await myWork(await pageFor(browser, world(), 'TREV'), `asked by ${nameOf('TRANS')}`);
  expect(all).toContain(L);
  expect(all).toContain(`asked by ${nameOf('TRANS')}`);
  expect(all).not.toMatch(/\bdue\b/);
});

/** PASS-039 for one role: asks Kept to record a spare passage (`at` picks the passage), then withdraws it from History. */
async function askToRecordThenWithdraw(browser: Browser, who: AccountKey, at: number): Promise<void> {
  const p = (await sparePassages(world(), 2))[at]!;
  const kept = nameOf('KEPT');
  const page = await recordAs(browser, world(), who, p);
  await somethingElse(page);
  await button(page, /^Someone else should do this/).click();
  await page.getByRole('radio', { name: new RegExp(`^${kept}`) }).locator('visible=true').first().click();
  await expect(byId(page, 'primary-action')).toHaveText('Ask Kept');
  await byId(page, 'primary-action').click();
  await toast(page, `${kept} will see it on their My Work`);
  await expect(header(page), who).toHaveText(p.label);
  expect(await pathStep(page, 'Record').getAttribute('aria-label'), who).toMatch(new RegExp(`Record\\. You asked ${kept}\\. Tell it`));
  // The toast has no Undo (decision 134): History's Withdraw takes the request back.
  await versionsPage(page);
  await expand(page, 'History', /^Version \d+ published$|^Asked /);
  await button(page, 'Withdraw').click();
  await toast(page, 'Request withdrawn');
  await expect.poll(() => screenText(page), { message: who }).toMatch(new RegExp(`Asked ${kept} to record .*withdrawn`));
  await byId(page, 'header-close').click();
  await expect.poll(async () => pathStep(page, 'Record').getAttribute('aria-label'), { message: who }).not.toContain('asked');
}

test('PASS-039 COORD Ask someone to record, then withdraw it', async ({ browser }) => {
  await askToRecordThenWithdraw(browser, 'COORD', 0);
});

test('PASS-039 LADMIN Ask someone to record, then withdraw it', async ({ browser }) => {
  await askToRecordThenWithdraw(browser, 'LADMIN', 1);
});

/** Ask someone for the Back translation of P-DRAFT, from its step sheet. */
async function askForBt(page: Page): Promise<void> {
  await openTeamRow(page, 'Back translation');
  // The Back translation's row is the sheet's last.
  await sheet(page).getByRole('button', { name: /^(Send to someone else|Ask someone)$/ }).last().click();
  await expect(header(page)).toHaveText('Ask for Back translation');
}

test('PASS-041 Your own questions', async ({ browser }) => {
  await draftPublished();
  const page = await recordAs(browser, world(), 'TRANS', 'P-DRAFT');
  await askForBt(page);
  await expect(button(page, 'Add question')).toBeDisabled();
  const type = page.getByRole('button', { name: /^Answer: / }).locator('visible=true').first();
  await expect(type).toHaveText('Answer: Yes/No');
  for (const next of ['Answer: Text', 'Answer: 1–5', 'Answer: Yes/No']) { await type.click(); await expect(type).toHaveText(next); }
  const ask = field(page, 'Ask something specific');
  await ask.fill('First question?');
  await button(page, 'Add question').click();
  await ask.fill('Second question?');
  await button(page, 'Add question').click();
  await page.getByRole('button', { name: 'Remove question' }).locator('visible=true').first().click();
  const all = await screenText(page);
  expect(all).not.toContain('First question?');
  expect(all).toContain('Second question?');
});

test('PASS-042 Ask someone without the app: a link, with nothing to fill in first', async ({ browser }) => {
  // decisions.md 158: no name or phone number; whoever opens the link types their own name.
  await draftPublished();
  const page = await recordAs(browser, world(), 'TRANS', 'P-DRAFT');
  await askForBt(page);
  await button(page, 'Someone without the app').click();
  expect(await screenText(page)).not.toContain('Phone number');
  await expect(byId(page, 'primary-action')).toHaveText('Make a link');
  await byId(page, 'primary-action').click();
  await expect(byId(page, 'ask-link')).toContainText('/r/');
  await expect(byId(page, 'primary-action')).toHaveText('Share link');
});

/** COORD's request to record P-Q4 (the fixture's): the roles that may withdraw it, and those that may not. */
async function withdrawRequestOnQ4(browser: Browser, who: AccountKey, mayWithdraw: boolean): Promise<void> {
  const p = await recordAs(browser, world(), who, 'P-Q4');
  await versionsPage(p);
  await expand(p, 'History', /^Version \d+ published$|^Asked /);
  expect(await button(p, 'Withdraw').isVisible().catch(() => false), who).toBe(mayWithdraw);
  if (who === 'LADMIN') {
    await button(p, 'Withdraw').click();
    await toast(p, 'Request withdrawn');
  }
}

test('PASS-044 TRANS Withdraw a request from History', async ({ browser }) => {
  // TRANS withdraws its own request to a guest, made through the server when this world has none
  // (requests to a guest by phone predate review links, decisions.md 158, and older phones still make them).
  await draftPublished();
  const open = (await passageAs(world(), 'TRANS', 'P-DRAFT')).openRequests.filter((r) => r.guest);
  if (!open.length) {
    await actAs(world(), 'TRANS', (c) => c.ask({ commandId: id(), unitId: world().passages['P-DRAFT'].unitId, what: 'review', kindId: 'bt',
      guest: { name: 'Pastor Garang', channel: 'sms', contact: '+211 555 0100' } }), 'ask Pastor Garang');
  }
  const page = await recordAs(browser, world(), 'TRANS', 'P-DRAFT');
  await versionsPage(page);
  await expand(page, 'History', /^Version \d+ published$|^Asked /);
  const row = page.getByRole('button', { name: /^Asked Pastor Garang for Back Translation/ }).locator('visible=true').first();
  await expect(row.or(text(page, /Asked Pastor Garang for/, false)).first()).toBeVisible();
  await button(page, 'Withdraw').click();
  await toast(page, 'Request withdrawn');
  await expect.poll(() => screenText(page)).toMatch(/Asked Pastor Garang for .*withdrawn/);
});

// COORD's request to record P-Q4: not TRANS's or TREV's to withdraw; COORD and LADMIN (Assign work) may. LADMIN goes last: it withdraws it.
test('PASS-044 TRANS cannot withdraw COORD\'s request', async ({ browser }) => { await withdrawRequestOnQ4(browser, 'TRANS', false); });
test('PASS-044 TREV cannot withdraw COORD\'s request', async ({ browser }) => { await withdrawRequestOnQ4(browser, 'TREV', false); });
test('PASS-044 COORD may withdraw its request', async ({ browser }) => { await withdrawRequestOnQ4(browser, 'COORD', true); });
test('PASS-044 LADMIN may withdraw COORD\'s request', async ({ browser }) => {
  await withdrawRequestOnQ4(browser, 'LADMIN', true);
  expect(await myWork(await pageFor(browser, world(), 'TRANS'))).not.toContain(label('P-Q4'));
  void sheetButtons;
});
