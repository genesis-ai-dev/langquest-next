// Avatar U, J-REC-5: the translator sets aside a suggested step on a v2 flow
// with a reason from the reference ReasonSheet. Judged on the device log and
// the server: a v1.StepSetAside for the passage and step that says why,
// confirmed, and not brought back.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { setAsideStep } from '../goals';
import { accountForDriver, judgeSetAside } from '../outcome';
import { openAs, seedSubmittedWorld } from '../world';

test.use({ viewport: { width: 430, height: 1600 } });

test('translator sets a step aside with a reason', async ({ page }) => {
  const world = await seedSubmittedWorld({ v2Flow: true });
  const passage = world.passages[0]!;
  await openAs(page, world, world.translator);

  const run = await runJev(page, setAsideStep(passage.label), { timeoutMs: 90_000, maxDecisions: 30 });

  const contract = { actorId: world.translator.id, unitId: passage.unitId, laneId: world.laneId, stepId: world.stepId,
    ...(world.kindId ? { kindId: world.kindId } : {}) };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.partitionId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.partitionId)
  }), (e) => judgeSetAside(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeSetAside(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never set anything aside; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
