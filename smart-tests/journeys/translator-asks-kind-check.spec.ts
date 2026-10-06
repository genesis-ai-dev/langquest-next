// Avatar P ask_someone from Avatar U passage_record, J-REC-10 on
// v1.RequestMade: the translator asks a reviewer for the Peer Review kind
// of their own version, due in a week (ADR-006: a translator may ask for
// their own review). Judged on the device log and the server: a RequestMade
// (what check, the step's kind, the reviewer) with an ISO due date,
// confirmed and not withdrawn.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { askForKindCheck } from '../goals';
import { accountForDriver, judgeRequest } from '../outcome';
import { openAs, seedSubmittedWorld } from '../world';

test.use({ viewport: { width: 430, height: 1600 } });

test('translator asks a reviewer for a kind check, due in a week', async ({ page }) => {
  const world = await seedSubmittedWorld({ v2Flow: true });
  const passage = world.passages[0]!;
  await openAs(page, world, world.translator);

  const run = await runJev(page, askForKindCheck(passage.label, 'the reviewer'), { timeoutMs: 90_000, maxDecisions: 30 });

  const contract = { askerId: world.translator.id, unitId: passage.unitId, laneId: world.laneId, assigneeId: world.reviewer.id,
    what: 'check' as const, ...(world.kindId ? { kindId: world.kindId } : {}) };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.partitionId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.partitionId)
  }), (e) => judgeRequest(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeRequest(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never sent an ask; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
