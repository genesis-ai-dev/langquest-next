// Avatar U, J-BT-2 in an ordinary lane: someone with Review permission
// back-translates the version from the passage record. Judged on the device
// log and the server: a v1.ContentProduced from Version 1 with its audio,
// and no TakeComposed in the source lane (old clients would show that as
// the translator's newest version).
import { expect, test } from '@playwright/test';
import { catalogKindId } from '@langquest-next/core';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { backTranslatePassage } from '../goals';
import { accountForDriver, judgeBackTranslation } from '../outcome';
import { openAs, seedSubmittedWorld } from '../world';

test.use({ viewport: { width: 430, height: 1600 } });

test('reviewer back-translates in an ordinary lane', async ({ page }) => {
  const world = await seedSubmittedWorld({ flowId: 'standard_bible_v2' });
  const passage = world.passages[0]!;
  await openAs(page, world, world.reviewer);

  const run = await runJev(page, backTranslatePassage(passage.label), { timeoutMs: 120_000, maxDecisions: 40 });

  const contract = { makerId: world.reviewer.id, unitId: passage.unitId, laneId: world.laneId,
    fromTakeId: world.version1.takeId, kindId: catalogKindId('back_translation') };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.projectId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.projectId)
  }), (e) => judgeBackTranslation(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeBackTranslation(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never saved a back translation; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
