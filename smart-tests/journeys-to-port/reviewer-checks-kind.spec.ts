// Avatar U, J-REV-1 on a v2 flow: a reviewer opens the version they were
// asked to check from My Work, plays it, answers the required question and
// sends "looks good". Judged on the device log and the server: a
// v1.CheckRecorded of the step's kind (not a legacy ReviewSubmitted).
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { checkKindLooksGood } from '../goals';
import { accountForDriver, judgeCheck } from '../outcome';
import { openAs, seedSubmittedWorld } from '../world';

test.use({ viewport: { width: 430, height: 1600 } });

test('reviewer checks a kind on a v2 flow', async ({ page }) => {
  const world = await seedSubmittedWorld({ v2Flow: true });
  const passage = world.passages[0]!;
  await openAs(page, world, world.reviewer);

  const run = await runJev(page, checkKindLooksGood(passage.label), { timeoutMs: 90_000, maxDecisions: 30 });

  const contract = { reviewerId: world.reviewer.id, takeId: world.version1.takeId, kindId: world.kindId!,
    outcome: 'looks_good' as const, requiredQuestionIds: world.requiredQuestionIds };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.partitionId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.partitionId)
  }), (e) => judgeCheck(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeCheck(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never sent a check; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
