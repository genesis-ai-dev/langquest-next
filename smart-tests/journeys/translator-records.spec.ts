// Avatar U, the core action: a translator records their assigned passage.
// The seed builds the world through the real server; Jev drives the UI with
// no selectors; the oracle judges only the event log, the blob store and the
// server. Jev reporting "done" is never a pass.
import { expect, test } from '@playwright/test';
import { runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { judgeRecording } from '../outcome';
import { browserStateFor, seedTranslatorWorld } from '../world';

test('translator records their assigned passage', async ({ page }) => {
  const world = await seedTranslatorWorld();
  const passage = world.passages[0]!;
  const state = browserStateFor(world, world.translator);
  // Only on first load: the app refreshes the session itself afterwards.
  await page.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, state);
  await page.goto('/');
  await page.waitForFunction(() => !!(globalThis as { __langquestLog?: unknown }).__langquestLog, undefined, { timeout: 60_000 });
  const blobsBefore = await deviceBlobs(page);

  const run = await runJev(page,
    `You are a translator. Open your assigned passage "${passage.label}" and record your spoken translation of it. ` +
    'Your microphone is already hearing you speak. Once recording, keep it running and wait until the app shows ' +
    'a saved take of this passage; only then stop recording. Stop when the saved take is visible.',
    { timeoutMs: 150_000, maxDecisions: 40 });

  const contract = { actorId: world.translator.id, unitIds: [passage.unitId], laneId: world.laneId };
  // Give the device time to sync the take and upload its audio, as it would on a phone.
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.projectId),
    blobsBefore,
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.projectId)
  }), (e) => judgeRecording(contract, e).verdict === 'passed', 45_000);
  const outcome = judgeRecording(contract, evidence);

  await test.info().attach('outcome.json', { contentType: 'application/json', body: JSON.stringify({
    jev: { status: run.status, actions: run.actions, elapsedMs: run.elapsedMs, modelCalls: run.modelCalls.length },
    outcome
  }, null, 2) });
  console.log(`[outcome] ${outcome.verdict} (jev: ${run.status}, ${run.actions.length} actions)`);
  for (const c of outcome.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  console.log(`[jev actions] ${run.actions.map((a) => `${a.kind}:${a.label}`).join(' → ')}`);
  console.log(`[final screen] ${await page.title()} · ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  // Inconclusive is not a pass: nothing about the product was shown.
  expect(outcome.verdict, 'inconclusive means Jev never recorded; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
