import { always, Fleet, FLEET_EPOCH, NETWORKS, TIME } from '@langquest-next/client/src/testing';
import type { Scenario } from './types';

/**
 * A release changes REDUCER_VERSION, so every phone throws its checkpoint
 * away and catches up through the server snapshot (decision 18), while the
 * team keeps working and the projection pass rewrites the snapshot every
 * five minutes (audit items 4 and 5). Updates reach phones over an hour.
 * Read the snapshot outcomes (`stale` means a download was thrown away),
 * how long each phone took to catch up, and the megabytes it cost.
 * The defaults are the server's snapshot rule (decisions.md 88); the rule
 * before it is `--snapshotMinNew=1 --snapshotMaxAgeMin=0 --snapshotRetainHours=0`.
 */
export const reducerBump: Scenario = {
  name: 'reducerBump',
  summary: 'Every phone cold-starts through the server snapshot while the team keeps working.',
  defaults: { seed: 1, passages: 600, translators: 8, reviewers: 5, historyDays: 3, slowShare: 0.3, slowKBps: 20, snapshotEveryMin: 5, snapshotMinNew: 200, snapshotMaxAgeMin: 60, snapshotRetainHours: 24, chunkKB: 256 },
  async run(k) {
    const started = performance.now();
    const slow = { ...NETWORKS.slow, bytesPerSecond: k.slowKBps! * 1000 };
    const fleet = new Fleet({
      seed: k.seed!,
      snapshots: {
        everyMs: k.snapshotEveryMin! * TIME.MINUTE, minNewEvents: k.snapshotMinNew!,
        maxAgeMs: k.snapshotMaxAgeMin! * TIME.MINUTE, retainMs: k.snapshotRetainHours! * TIME.HOUR
      },
      chunkChars: k.chunkKB! * 1024,
      crew: {
        passages: k.passages!,
        translators: k.translators!,
        reviewers: k.reviewers!,
        link: (_role, _i, r) => (r() < k.slowShare! ? always(slow, `slow ${k.slowKBps} KB/s`) : always(NETWORKS.phone, 'phone'))
      }
    });
    await fleet.start();
    // The update lands during working hours, spread over an hour.
    const at = k.historyDays! * TIME.DAY + 9 * TIME.HOUR;
    for (const [i, d] of fleet.devices.entries()) {
      fleet.at(at + Math.round((i / fleet.devices.length) * TIME.HOUR), () => d.reinstall());
    }
    await fleet.time.runUntil(FLEET_EPOCH + at + TIME.DAY);
    const agreement = await fleet.settle();
    const report = fleet.report(agreement, performance.now() - started);
    const minutes = report.coldStarts.map((c) => c.minutes);
    return {
      report,
      findings: {
        coldStarts: minutes.length,
        neverCaughtUp: minutes.filter((m) => m === null).length,
        worstMinutes: Math.max(0, ...minutes.map((m) => m ?? 0)),
        snapshotOutcomes: report.phones.snapshotOutcomes
      }
    };
  }
};
