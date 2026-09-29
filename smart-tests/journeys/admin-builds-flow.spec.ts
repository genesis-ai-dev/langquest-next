// Avatar P, J-CFG-3/J-CFG-4: an admin builds a language's review flow with
// two kinds together in one step and a consultant checkpoint, and saves it.
// Judged on the device log and the server: v2.WorkflowStepSet events.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { buildFlow } from '../goals';
import { accountForDriver, judgeFlow } from '../outcome';
import { openAs, seedTranslatorWorld } from '../world';

// The editor grows with every step; a tall viewport keeps Save and the picker in Jev's reach.
test.use({ viewport: { width: 430, height: 1600 } });

test('admin builds a flow with two kinds together and a checkpoint', async ({ page }) => {
  const world = await seedTranslatorWorld();
  await openAs(page, world, world.owner);

  const run = await runJev(page, buildFlow(), { timeoutMs: 150_000, maxDecisions: 45 });

  const contract = { adminId: world.owner.id, laneId: world.laneId };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.projectId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.projectId)
  }), (e) => judgeFlow(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeFlow(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never saved a flow; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
