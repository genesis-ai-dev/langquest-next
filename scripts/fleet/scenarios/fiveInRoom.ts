import { always, Fleet, FLEET_EPOCH, NETWORKS, offlineBetween, offlineUntil, TIME } from '@langquest-next/sync/src/testing';
import { meet, round } from './nearbyMeet';
import type { Scenario } from './types';

/**
 * Five people in one room with no signal (docs/nearby-sync-plan.md 5.11): each recorded or
 * reviewed alone for two days, then all open Share nearby. Read how many pairings the room's
 * chosen partners take to leave every phone holding everything (5.11 says 6 with a good
 * order, 10 for every pair to meet), how long that takes, whether review audio came ahead of
 * backups in every session, and what a trip to town by one phone costs at the next meeting:
 * its summary moves with what it pulled, so the room talks again while that gap is open.
 */
export const fiveInRoom: Scenario = {
  name: 'fiveInRoom',
  summary: 'Five phones with no signal share in one room, then again after one goes to town.',
  defaults: { seed: 1, passages: 40, translators: 3, reviewers: 2, daysApart: 2, audioKBps: 16, keepOnDisk: 1, wifi: 1 },
  async run(k) {
    const started = performance.now();
    const away = FLEET_EPOCH + 2 * TIME.HOUR;
    const town = FLEET_EPOCH + k.daysApart! * TIME.DAY + TIME.DAY + 9 * TIME.HOUR;
    const fleet = new Fleet({
      seed: k.seed!,
      audio: { bytesPerSecond: k.audioKBps! * 1000 },
      keepOnDisk: k.keepOnDisk ? 'half' : false,
      nearby: { wifi: k.wifi === 1 },
      crew: {
        passages: k.passages!,
        translators: k.translators!,
        reviewers: k.reviewers!,
        // Out of reach from two hours in; the first translator alone goes to town once, for two hours.
        link: (role, i) => {
          const back = FLEET_EPOCH + 100 * TIME.DAY;
          return role === 'translator' && i === 0
            ? offlineBetween(away, town, offlineBetween(town + 2 * TIME.HOUR, back, always(NETWORKS.phone, 'phone')))
            : offlineBetween(away, back, always(NETWORKS.phone, 'phone'));
        }
      }
    });
    await fleet.start();
    const team = fleet.devices.slice(1);
    const evening = (day: number) => FLEET_EPOCH + day * TIME.DAY + 17 * TIME.HOUR;

    await fleet.time.runUntil(evening(k.daysApart!));
    const first = await meet(fleet, team);
    const order = reviewFirst(fleet);

    // The first translator goes to town in the morning, pulls and pushes, and comes back.
    await fleet.time.runUntil(town + 3 * TIME.HOUR);
    const afterTown = await meet(fleet, team);

    // A third meeting with nothing new: the room should not talk.
    const quiet = await meet(fleet, team);

    // Then everyone reaches the server.
    for (const d of fleet.devices) d.setLink(offlineUntil(fleet.time.now(), always(NETWORKS.phone, 'phone')));
    const agreement = await fleet.settle();
    const report = fleet.report(agreement, performance.now() - started);
    const nearbyLeft = (await Promise.all(fleet.devices.map((d) => d.client.inspect()))).reduce((n, v) => n + v.nearby, 0);
    return {
      report,
      findings: {
        firstMeeting: first,
        pairingsGoodOrder: 2 * team.length - 4,
        pairingsEveryPair: (team.length * (team.length - 1)) / 2,
        reviewFirst: order,
        afterOneTripToTown: afterTown,
        quietMeeting: quiet,
        nearbyRowsAfterTown: nearbyLeft,
        mbPerPhoneHeld: round(team.reduce((n, d) => n + [...d.audioSizes.values()].reduce((a, b) => a + b, 0), 0) / team.length / 1e6)
      }
    };
  }
};

/** Within each session, did any file asked as open for review or needed land after a backup? Per phone that took files. */
function reviewFirst(fleet: Fleet): { phonesWithFiles: number; filesByGroup: Record<string, number>; reviewAfterBackup: number } {
  const byGroup: Record<string, number> = {};
  let late = 0;
  let phones = 0;
  for (const landed of fleet.nearby!.stats.landed.values()) {
    phones += 1;
    const seenBackup = new Set<number>();
    for (const { group, session } of landed) {
      byGroup[group] = (byGroup[group] ?? 0) + 1;
      if (group === 'backup') seenBackup.add(session);
      else if (seenBackup.has(session)) late += 1;
    }
  }
  return { phonesWithFiles: phones, filesByGroup: byGroup, reviewAfterBackup: late };
}
