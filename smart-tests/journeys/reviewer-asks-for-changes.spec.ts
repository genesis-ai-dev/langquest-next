// Avatar U, J-REV-1/2: a reviewer opens the version they were asked to
// review from My Work, plays it, answers the required questions and asks
// for changes with typed feedback. Judged on the device log and the server.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { reviewNeedsChanges } from '../goals';
import { accountForDriver, judgeReview } from '../outcome';
import { openAs, seedSubmittedWorld } from '../world';

// Jev scrolls only the document, and React Native web scrolls inside a view:
// on a phone-height viewport the feedback box sits below the fold where Jev
// cannot reach it. A tall viewport shows the whole screen; nothing else changes.
test.use({ viewport: { width: 430, height: 1600 } });

test('reviewer asks for changes on a submitted version', async ({ page }) => {
  const world = await seedSubmittedWorld();
  const passage = world.passages[0]!;
  await openAs(page, world, world.reviewer);

  const run = await runJev(page, reviewNeedsChanges(passage.label, 'Say Theophilus more slowly'), { timeoutMs: 90_000, maxDecisions: 30 });

  const contract = { reviewerId: world.reviewer.id, takeId: world.version1.takeId, stepId: world.stepId,
    decision: 'suggest_changes' as const, requiredQuestionIds: world.requiredQuestionIds };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.partitionId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.partitionId)
  }), (e) => judgeReview(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeReview(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never sent that decision; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
