// Avatar P, decision 63: an org admin adds a language. Judged on the device
// logs (the organization's stream and the new language's) and the server:
// a LanguageAdded with the name and code asked for, and the language's own
// stream started with a template and a flow.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceLog, serverEvents, settle } from '../evidence';
import { createLanguage } from '../goals';
import { accountForDriver, addedLanguageId, judgeNewLanguage } from '../outcome';
import { openAs, seedTranslatorWorld } from '../world';

test('admin adds a language with its template and flow', async ({ page }) => {
  const world = await seedTranslatorWorld();
  await openAs(page, world, world.owner);
  const contract = { adminId: world.owner.id, name: 'Mark in Dinka', code: 'din' };

  const run = await runJev(page, createLanguage(contract.name, contract.code), { timeoutMs: 120_000, maxDecisions: 30 });

  const read = async () => {
    const org = await deviceLog(page, world.orgId, '_org');
    const languageId = addedLanguageId(contract, org);
    return {
      org,
      device: languageId ? await deviceLog(page, world.orgId, languageId) : [],
      // Not yet on the server reads as empty: judged as not synced, never as a pass.
      server: languageId ? await serverEvents(languageId).catch(() => []) : []
    };
  };
  const evidence = await settle(read, (e) => judgeNewLanguage(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeNewLanguage(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never added a language; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
