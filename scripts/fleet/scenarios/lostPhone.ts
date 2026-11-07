import { always, Fleet, FLEET_EPOCH, NETWORKS, offlineBetween, TIME } from '@langquest-next/sync/src/testing';
import { meet, type Meeting } from './nearbyMeet';
import type { Scenario } from './types';

/**
 * A phone lost in the village (docs/nearby-sync-plan.md section 8's Fleet row). The team
 * shares nearby each evening; on `loseOnDay`, after that evening's meeting, one
 * translator's phone is gone. Until delivery (phase 4) only an author can send its own work
 * to the server, so this asserts only what nearby already promises: every survivor holds
 * everything the lost phone shared, and after the trip to town every survivor agrees on the
 * server's log plus that work, which stays nearby on every one of them.
 */
export const lostPhone: Scenario = {
  name: 'lostPhone',
  summary: 'A phone is lost after sharing nearby; the survivors keep its work and agree.',
  defaults: { seed: 1, days: 5, loseOnDay: 2, passages: 60, translators: 3, reviewers: 2, audio: 1 },
  async run(k) {
    const started = performance.now();
    const away = FLEET_EPOCH + 2 * TIME.HOUR;
    const town = FLEET_EPOCH + k.days! * TIME.DAY + 9 * TIME.HOUR;
    const fleet = new Fleet({
      seed: k.seed!,
      audio: k.audio ? { bytesPerSecond: 16_000 } : null,
      keepOnDisk: 'half',
      nearby: {},
      crew: { passages: k.passages!, translators: k.translators!, reviewers: k.reviewers!, link: () => offlineBetween(away, town, always(NETWORKS.phone, 'phone')) }
    });
    await fleet.start();
    let team = fleet.devices.slice(1);
    const gone = team[1]!;

    const meetings: Meeting[] = [];
    let shared = new Set<string>();
    let sharedFiles = new Set<string>();
    for (let day = 0; day < k.days!; day++) {
      await fleet.time.runUntil(FLEET_EPOCH + day * TIME.DAY + 17 * TIME.HOUR);
      meetings.push(await meet(fleet, team));
      if (day === k.loseOnDay) {
        // What it had shared: its events and files on any other phone now.
        const others = team.filter((d) => d !== gone);
        shared = new Set((await Promise.all(others.map(async (d) => (await d.nearbyRows()).filter((e) => e.actorId === gone.actorId).map((e) => e.id)))).flat());
        const recorded = new Set((await gone.client.inspect()).pending.flatMap((l) => (l.event.type === 'v1.RecordingAdded' ? l.event.payload.cards.map((c) => c.hash) : [])));
        sharedFiles = new Set(others.flatMap((d) => [...d.audioHere].filter((h) => recorded.has(h))));
        await fleet.lose(gone);
        team = others;
      }
    }
    const survivorsHoldAll = (await Promise.all(team.map(async (d) => {
      const ids = new Set((await d.nearbyRows()).map((e) => e.id));
      return [...shared].every((id) => ids.has(id)) && [...sharedFiles].every((h) => d.audioHere.has(h));
    }))).every(Boolean);

    const agreement = await fleet.settle(12 * TIME.HOUR, { unsentBy: new Set([gone.actorId]) });
    const report = fleet.report(agreement, performance.now() - started);
    const left = await Promise.all(team.map(async (d) => (await d.nearbyRows()).length));
    return {
      report,
      findings: {
        lost: gone.id,
        eventsItShared: shared.size,
        filesItShared: sharedFiles.size,
        survivorsHoldAllBeforeTown: survivorsHoldAll,
        survivorsNearbyAfterTown: left,
        survivorsAgree: agreement.agree,
        pairings: meetings.reduce((n, m) => n + m.pairings, 0)
      }
    };
  }
};
