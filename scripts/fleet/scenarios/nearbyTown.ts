import { always, Fleet, FLEET_EPOCH, NETWORKS, never, offlineBetween, TIME } from '@langquest-next/sync/src/testing';
import { meet } from './nearbyMeet';
import type { Scenario } from './types';

/**
 * A repeating trip to town (docs/nearby-sync-plan.md section 6, phase 4). A team with no signal
 * works each day and shares nearby each evening, and each morning a different phone goes to
 * town for `hours` hours, the rest staying out of reach. Read, for every trip, whether the server
 * then held everything that phone held for its teammates (it should, for every trip), how many
 * events each delivered on their authors' behalf, and how many it left nearby. Then everyone
 * reaches the server and every phone must fold to its log with nothing nearby.
 */
export const nearbyTown: Scenario = {
  name: 'nearbyTown',
  summary: 'A village team shares nearby each evening; each morning a different phone goes to town.',
  defaults: { seed: 1, days: 6, hours: 2, passages: 60, translators: 3, reviewers: 2, audio: 1 },
  async run(k) {
    const started = performance.now();
    const fleet = new Fleet({
      seed: k.seed!,
      audio: k.audio ? { bytesPerSecond: 16_000 } : null,
      keepOnDisk: 'half',
      nearby: { delivery: true },
      // Everyone downloads the language in the first two hours, then is out of reach but for the trips.
      crew: { passages: k.passages!, translators: k.translators!, reviewers: k.reviewers!, link: () => offlineBetween(FLEET_EPOCH + 2 * TIME.HOUR, FLEET_EPOCH + 1000 * TIME.DAY, always(NETWORKS.phone, 'phone')) }
    });
    await fleet.start();
    const team = fleet.devices.slice(1);
    const trips: { phone: string; heldForTeammates: number; missedOnServer: number; delivered: number }[] = [];
    for (let day = 0; day < k.days!; day++) {
      if (day > 0) {
        // The morning trip: this phone alone has a signal.
        const traveller = team[(day - 1) % team.length]!;
        await fleet.time.runUntil(FLEET_EPOCH + day * TIME.DAY + 7 * TIME.HOUR);
        const held = (await traveller.nearbyRows()).map((e) => e.id);
        const before = traveller.metrics.delivered;
        traveller.setLink(always(NETWORKS.phone, 'phone'));
        await fleet.runFor(k.hours! * TIME.HOUR);
        traveller.setLink(never(NETWORKS.phone));
        const onServer = new Set(fleet.server.stream(fleet.orgId, fleet.streamId).map((e) => e.id));
        trips.push({ phone: traveller.id, heldForTeammates: held.length, missedOnServer: held.filter((id) => !onServer.has(id)).length, delivered: traveller.metrics.delivered - before });
      }
      await fleet.time.runUntil(FLEET_EPOCH + day * TIME.DAY + 17 * TIME.HOUR);
      await meet(fleet, team);
    }
    const agreement = await fleet.settle();
    const report = fleet.report(agreement, performance.now() - started);
    const nearbyLeft = (await Promise.all(fleet.devices.map((d) => d.client.inspect()))).reduce((n, v) => n + v.nearby, 0);
    return {
      report,
      findings: {
        trips,
        missedOnServerAfterTrips: trips.reduce((n, t) => n + t.missedOnServer, 0),
        deliveredOnTrips: trips.reduce((n, t) => n + t.delivered, 0),
        agree: agreement.agree,
        nearbyRowsAfter: nearbyLeft
      }
    };
  }
};
