// Avatar U, J-STUDY-2: a translator pauses the "Setting the Stage" audio
// and adds a note at that moment. Judged on the device log and the server:
// a v1.ContextItemAdded with a study anchor whose atMs is whole ms, never
// the old one-note guideline field.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { addStudyNoteAtMoment } from '../goals';
import { accountForDriver, judgeStudyNote } from '../outcome';
import { openAs, seedStudyWorld } from '../world';

test.use({ viewport: { width: 430, height: 1600 } });

test('translator adds a study note at a moment', async ({ page }) => {
  const world = await seedStudyWorld();
  const passage = world.passages[0]!;
  const text = 'Ask who is in the crowd';
  await openAs(page, world, world.translator);

  const run = await runJev(page, addStudyNoteAtMoment(passage.label, text), { timeoutMs: 120_000, maxDecisions: 40 });

  const contract = { authorId: world.translator.id, unitId: passage.unitId, laneId: world.laneId,
    materialId: world.studyMaterialId, stepId: world.stepId, text };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.partitionId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.partitionId)
  }), (e) => judgeStudyNote(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeStudyNote(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never saved a note; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
