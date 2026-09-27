// Avatar P, J-REC-10 (existing facts): a coordinator opens a passage nobody
// has recorded, asks the translator to record it with a due date, and sends.
// Judged on the device log and the server: a RequestMade (what record) with
// an ISO dueDate, not withdrawn. Phase 2b replaced the AssignmentMade ask.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { askToRecord } from '../goals';
import { accountForDriver, judgeRequest } from '../outcome';
import { openAs, seedTranslatorWorld } from '../world';

test('coordinator asks the translator to record, with a due date', async ({ page }) => {
  const world = await seedTranslatorWorld({ coordinator: true });
  const coordinator = world.coordinator!;
  await openAs(page, world, coordinator);

  const run = await runJev(page, askToRecord(world.unassigned.label, 'translator'), { timeoutMs: 90_000, maxDecisions: 30 });

  const contract = { askerId: coordinator.id, unitId: world.unassigned.unitId, laneId: world.laneId,
    assigneeId: world.translator.id, what: 'record' as const };
  const evidence = await settle(async () => ({
    device: await deviceLog(page, world.orgId, world.projectId),
    blobsAfter: await deviceBlobs(page),
    server: await serverEvents(world.projectId)
  }), (e) => judgeRequest(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeRequest(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never sent an ask; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
