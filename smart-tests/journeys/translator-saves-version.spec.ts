// Avatar U, J-WORK → J-REC → workspace: a translator starts from My Work,
// records their passage and saves it as Version 1 for review. Judged on the
// device log and the server: a new take composed and submitted, confirmed.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { saveFirstVersion } from '../goals';
import { accountForDriver, judgeSavedVersion } from '../outcome';
import { openAs, seedTranslatorWorld } from '../world';

test('translator saves Version 1 from My Work', async ({ page }) => {
  const world = await seedTranslatorWorld();
  const passage = world.passages[0]!;
  await openAs(page, world, world.translator);

  const run = await runJev(page, saveFirstVersion(passage.label), { timeoutMs: 90_000, maxDecisions: 30 });

  const contract = { actorId: world.translator.id, unitId: passage.unitId, laneId: world.laneId, priorTakeIds: [] };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.projectId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.projectId)
  }), (e) => judgeSavedVersion(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeSavedVersion(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  console.log(`[screen] ${new URL(page.url()).pathname}`);
  expect(outcome.verdict, 'inconclusive means Jev never saved a version; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
