// Avatar P, J-MAP-2: a translator types "luk 1" into the Map search and
// opens a passage it finds. The outcome the product persists is the device's
// Recent list (App.tsx writes it whenever passage_record opens; My Work reads
// it). Not a false pass: the list starts empty, the passage must be one the
// query means (Luke 2:1-7 is in the partition and does not count), and the
// typed query must be in the driver's keystrokes, so reaching a Luke 1
// passage some other way (My Work, browsing the book) is inconclusive.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceLog, deviceRecent, settle } from '../evidence';
import { searchMap } from '../goals';
import { judgeMapSearch } from '../outcome';
import { openAs, seedTranslatorWorld } from '../world';

test('map search "luk 1" opens a Luke 1 passage', async ({ page }) => {
  const world = await seedTranslatorWorld();
  const me = world.translator;
  await openAs(page, world, me);
  await settle(() => deviceLog(page, world.orgId, world.partitionId), (rows) => rows.some((r) => r.event.type === 'v1.UnitAdded'), 30_000);
  const recentBefore = await deviceRecent(page, world.orgId, world.partitionId, me.id);

  const query = 'luk 1';
  const run = await runJev(page, searchMap(query), { timeoutMs: 60_000, maxDecisions: 20 });

  const contract = { query, laneId: world.laneId, matchingUnitIds: world.passages.map((p) => p.unitId) };
  const read = async () => ({ typed: run.actions.map((a) => a.text ?? '').filter(Boolean), recentBefore,
    recentAfter: await deviceRecent(page, world.orgId, world.partitionId, me.id) });
  const outcome = judgeMapSearch(contract, await settle(read, (e) => judgeMapSearch(contract, e).verdict === 'passed', 5_000));
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never searched and opened a passage; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
