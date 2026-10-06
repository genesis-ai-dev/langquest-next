// Avatar P, decision 28: an org admin creates a partition, which is one
// language. Judged on the device logs (org and the new partition) and the
// server: one PartitionRegistered, a PartitionCreated and exactly one LaneAdded.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceLog, serverEvents, settle } from '../evidence';
import { createLanguage } from '../goals';
import { accountForDriver, judgeNewLanguage, registeredPartitionId } from '../outcome';
import { openAs, seedTranslatorWorld } from '../world';

test('admin creates a partition with its one language', async ({ page }) => {
  const world = await seedTranslatorWorld();
  await openAs(page, world, world.owner);
  const contract = { adminId: world.owner.id, name: 'Mark in Dinka', languoidId: 'din' };

  const run = await runJev(page, createLanguage(contract.name, contract.languoidId), { timeoutMs: 120_000, maxDecisions: 30 });

  const read = async () => {
    const org = await deviceLog(page, world.orgId, '_org');
    const partitionId = registeredPartitionId(contract, org);
    return {
      org,
      device: partitionId ? await deviceLog(page, world.orgId, partitionId) : [],
      // Not yet on the server reads as empty: judged as not synced, never as a pass.
      server: partitionId ? await serverEvents(partitionId).catch(() => []) : []
    };
  };
  const evidence = await settle(read, (e) => judgeNewLanguage(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeNewLanguage(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never created a partition; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
