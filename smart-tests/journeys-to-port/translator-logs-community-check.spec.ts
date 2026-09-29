// Avatar P, J-REC-11: a translator logs a community check that happened
// outside the app, for two passages played in the same session. Judged on
// the device log and the server: one v1.CheckLogged per passage version,
// credited to the listeners (never an in-app review by the typist).
import { expect, test } from '@playwright/test';
import { catalogKindId } from '@langquest-next/core';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { logCommunityCheck } from '../goals';
import { accountForDriver, judgeLoggedCheck } from '../outcome';
import { openAs, seedSubmittedWorld } from '../world';

test.use({ viewport: { width: 430, height: 1600 } });

test('translator logs a community check for two passages', async ({ page }) => {
  const world = await seedSubmittedWorld({ flowId: 'oral_review_v2', secondVersion: true });
  const [first, second] = world.passages;
  await openAs(page, world, world.translator);

  const run = await runJev(page, logCommunityCheck(first!.label, second!.label, 'Bor church'), { timeoutMs: 120_000, maxDecisions: 40 });

  const contract = { loggerId: world.translator.id, kindId: catalogKindId('community'), outcome: 'looks_good' as const,
    takeIds: [world.version1.takeId, world.version1b!.takeId] };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.projectId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.projectId)
  }), (e) => judgeLoggedCheck(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeLoggedCheck(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never saved the log; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
