// Avatar U, J-REC-4: a reviewer asked for changes; the translator keeps the
// version and says why ("Keep it, say why") instead of recording a fix.
// Judged on the device log and the server: a v1.FeedbackKept naming that
// review (legacy target: take, step, reviewer) with a reason, confirmed,
// and no new version saved.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { keepAfterFeedback } from '../goals';
import { accountForDriver, judgeKept } from '../outcome';
import { openAs, seedSubmittedWorld } from '../world';

test.use({ viewport: { width: 430, height: 1600 } });

test('translator keeps the version and says why', async ({ page }) => {
  const world = await seedSubmittedWorld({ feedback: 'Slow down in the second verse.' });
  const passage = world.passages[0]!;
  await openAs(page, world, world.translator);

  const run = await runJev(page, keepAfterFeedback(passage.label), { timeoutMs: 90_000, maxDecisions: 30 });

  const contract = { authorId: world.translator.id, target: { takeId: world.version1.takeId, stepId: world.stepId, reviewerId: world.reviewer.id } };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.partitionId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.partitionId)
  }), (e) => judgeKept(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeKept(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never kept the version; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
