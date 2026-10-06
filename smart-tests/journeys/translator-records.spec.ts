// Avatar U, the core action: a translator records their assigned passage.
// The seed builds the world through the real server; Jev drives the UI with
// no selectors; the oracle judges only the event log, the blob store and the
// server. Jev reporting "done" is never a pass.
import { expect, test } from '@playwright/test';
import { runJev } from '../driver';
import { recordPassage } from '../goals';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { accountForDriver, judgeRecording } from '../outcome';
import { openAs, seedTranslatorWorld } from '../world';

test('translator records their assigned passage', async ({ page }) => {
  const world = await seedTranslatorWorld();
  const passage = world.passages[0]!;
  await openAs(page, world, world.translator);
  const blobsBefore = await deviceBlobs(page);

  const run = await runJev(page, recordPassage(passage.label), { timeoutMs: 60_000, maxDecisions: 25 });

  const contract = { actorId: world.translator.id, unitIds: [passage.unitId] };
  // Give the device time to sync the take and upload its audio, as it would on a phone.
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.languageId),
    blobsBefore,
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.languageId)
  }), (e) => judgeRecording(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeRecording(contract, evidence), run.status);

  await test.info().attach('outcome.json', { contentType: 'application/json', body: JSON.stringify({
    jev: { status: run.status, actions: run.actions, elapsedMs: run.elapsedMs, modelCalls: run.modelCalls.length },
    outcome
  }, null, 2) });
  console.log(`[outcome] ${outcome.verdict} (jev: ${run.status}, ${run.actions.length} actions)`);
  for (const c of outcome.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  console.log(`[jev actions] ${run.actions.map((a) => `${a.kind}:${a.label}`).join(' → ')}`);
  for (const step of run.steps.filter((x) => x['operation'] === 'ERROR')) console.log(`[jev error] ${step['error']}: ${step['reason']}`);
  console.log(`[final screen] ${await page.title()} · ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  // Inconclusive is not a pass: nothing about the product was shown.
  expect(outcome.verdict, 'inconclusive means Jev never recorded; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
