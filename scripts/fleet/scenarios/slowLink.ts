import { always, Fleet, FLEET_EPOCH, NETWORKS, TIME } from '@langquest-next/client/src/testing';
import type { Scenario } from './types';

/**
 * New phones on a very slow link join a language that is busy. If
 * downloading the snapshot takes longer than the gap between two
 * snapshots, the download is thrown away (`stale`) and the phone falls
 * back to pulling the log (audit item 5). Read whether each joiner caught
 * up, how long it took, and what it downloaded. Compare `--snapshotMinNew`
 * values to see the fix. A Bible-scale snapshot is about 52 pieces of
 * 256 KB; a small simulated one cut into small pieces (`--chunkKB`)
 * behaves the same way without folding 100k events on every phone.
 */
export const slowLink: Scenario = {
  name: 'slowLink',
  summary: 'Phones on a very slow link join a busy language.',
  defaults: { seed: 1, passages: 1200, translators: 8, reviewers: 5, historyDays: 3, joiners: 3, joinerKBps: 2, snapshotEveryMin: 5, snapshotMinNew: 1, chunkKB: 32 },
  async run(k) {
    const started = performance.now();
    const fleet = new Fleet({
      seed: k.seed!,
      snapshots: { everyMs: k.snapshotEveryMin! * TIME.MINUTE, minNewEvents: k.snapshotMinNew! },
      chunkChars: k.chunkKB! * 1024,
      crew: { passages: k.passages!, translators: k.translators!, reviewers: k.reviewers!, link: () => always(NETWORKS.phone, 'phone') }
    });
    await fleet.start();
    const slow = always({ ...NETWORKS.slow, bytesPerSecond: k.joinerKBps! * 1000 }, `slow ${k.joinerKBps} KB/s`);
    // The last few reviewers get new phones on the slow link, at 09:00.
    const joiners = fleet.devices.slice(-k.joiners!);
    const joinAt = k.historyDays! * TIME.DAY + 9 * TIME.HOUR;
    let snapshotKB = 0;
    const bytesBefore = new Map<string, number>();
    fleet.at(joinAt, async () => {
      const snap = [...fleet.server.snapshots.values()][0];
      snapshotKB = snap ? Math.round(JSON.stringify(snap.state).length / 1000) : 0;
      for (const d of joiners) {
        bytesBefore.set(d.id, d.metrics.bytesDown);
        d.setLink(slow);
        await d.reinstall();
      }
    });
    await fleet.time.runUntil(FLEET_EPOCH + joinAt + TIME.DAY);
    const joined = joiners.map((d) => ({
      device: d.id,
      minutes: d.metrics.coldStarts[0]?.ms == null ? null : Math.round(d.metrics.coldStarts[0].ms / TIME.MINUTE),
      mbDown: Math.round((d.metrics.bytesDown - (bytesBefore.get(d.id) ?? 0)) / 1e5) / 10,
      snapshot: d.diag.records.filter((r) => r.kind === 'snapshot' && r.at >= FLEET_EPOCH + joinAt).map((r) => r.t.outcome)
    }));
    const agreement = await fleet.settle();
    return {
      report: fleet.report(agreement, performance.now() - started),
      findings: { snapshotKBWhenJoining: snapshotKB, joiners: joined }
    };
  }
};
