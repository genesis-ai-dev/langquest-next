// Avatar U, J-REC-3: a reviewer asked for changes on Version 1. The
// translator opens the passage record, records a fix in the workspace and
// saves Version 2 with a "what changed" note. Judged on the device log and
// the server: a new submitted take, and a response naming Version 1.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { answerFeedback } from '../goals';
import { accountForDriver, judgeSavedVersion } from '../outcome';
import { openAs, seedSubmittedWorld } from '../world';

// Jev scrolls only the document, and React Native web scrolls inside a view:
// with the feedback card above the parts, the workspace outgrows a phone
// viewport. A tall viewport shows the whole screen; nothing else changes.
test.use({ viewport: { width: 430, height: 1600 } });

test('translator answers feedback with Version 2', async ({ page }) => {
  const world = await seedSubmittedWorld({ feedback: 'Say Theophilus more slowly' });
  const passage = world.passages[0]!;
  await openAs(page, world, world.translator);

  const run = await runJev(page, answerFeedback(passage.label, 'Slowed down the name Theophilus'), { timeoutMs: 120_000, maxDecisions: 35 });

  const contract = { actorId: world.translator.id, unitId: passage.unitId,
    priorTakeIds: [world.version1.takeId], priorHashes: [world.version1.hash], respondsToTakeId: world.version1.takeId };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.languageId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.languageId)
  }), (e) => judgeSavedVersion(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeSavedVersion(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never saved a new version; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
