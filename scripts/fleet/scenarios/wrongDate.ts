import { CLOCK_AHEAD_TOLERANCE_MS, decodeHlc, isHlc } from '@langquest-next/core';
import { always, Fleet, FLEET_EPOCH, NETWORKS, offlineBetween, TIME } from '@langquest-next/sync/src/testing';
import { meet, type Meeting } from './nearbyMeet';
import type { Scenario } from './types';

/**
 * One phone's date is years off (docs/nearby-sync-plan.md 5.4, the clock rows of the traps
 * table). The team works offline and shares nearby each evening, then goes to town, where
 * the server refuses a clock over 5 minutes ahead and that phone re-stamps its work. A
 * teammate's clock must never follow a far-off one (`clockCloseEnough`), every phone must
 * end agreeing with the server's fold with nothing nearby, and the far-ahead stamps a
 * teammate took must give way to the re-stamped copies the server holds.
 */
export const wrongDate: Scenario = {
  name: 'wrongDate',
  summary: 'One phone\'s date is years ahead; the team shares nearby, then reaches the server.',
  defaults: { seed: 1, days: 4, passages: 60, translators: 3, reviewers: 1, yearsOff: 3, audio: 0 },
  async run(k) {
    const started = performance.now();
    const away = FLEET_EPOCH + 2 * TIME.HOUR;
    const town = FLEET_EPOCH + k.days! * TIME.DAY + 9 * TIME.HOUR;
    const fleet = new Fleet({
      seed: k.seed!,
      audio: k.audio ? { bytesPerSecond: 16_000 } : null,
      nearby: {},
      clockAhead: true,
      crew: { passages: k.passages!, translators: k.translators!, reviewers: k.reviewers!, link: () => offlineBetween(away, town, always(NETWORKS.phone, 'phone')) }
    });
    const off = fleet.devices[1]!;
    off.clockOffsetMs = Math.round(k.yearsOff! * 365.25 * TIME.DAY);
    await fleet.start();
    const team = fleet.devices.slice(1);

    const meetings: Meeting[] = [];
    for (let day = 0; day < k.days!; day++) {
      await fleet.time.runUntil(FLEET_EPOCH + day * TIME.DAY + 17 * TIME.HOUR);
      meetings.push(await meet(fleet, team));
    }
    // Before town: every stamp a teammate made is near the true time, and the wrong phone's are years ahead.
    const truth = fleet.time.now();
    let teammatesAhead = 0;
    let offAhead = 0;
    for (const d of team) {
      const rows = [...await d.nearbyRows(), ...(await d.client.inspect()).pending.map((l) => l.event)];
      for (const e of rows) {
        if (!isHlc(e.hlc)) continue;
        const ahead = decodeHlc(e.hlc).wallMs - truth > CLOCK_AHEAD_TOLERANCE_MS;
        if (e.actorId === off.actorId) offAhead += ahead ? 1 : 0;
        else if (ahead) teammatesAhead += 1;
      }
    }
    const agreement = await fleet.settle();
    const report = fleet.report(agreement, performance.now() - started);
    const serverAhead = fleet.server.stream(fleet.orgId, fleet.streamId).filter((e) => isHlc(e.hlc) && decodeHlc(e.hlc).wallMs - fleet.time.now() > CLOCK_AHEAD_TOLERANCE_MS).length;
    const nearbyLeft = (await Promise.all(fleet.devices.map((d) => d.client.inspect()))).reduce((n, v) => n + v.nearby, 0);
    return {
      report,
      findings: {
        meetings: meetings.length,
        pairings: meetings.reduce((n, m) => n + m.pairings, 0),
        meetingsLevel: meetings.filter((m) => m.minutesToLevel !== null).length,
        farAheadRowsHeldBeforeTown: offAhead,
        teammatesStampsAheadBeforeTown: teammatesAhead,
        sessionsWarnedOfClock: report.nearby?.clockOff ?? 0,
        farAheadPagesSeen: report.nearby?.farAhead ?? 0,
        serverEventsAheadAfterTown: serverAhead,
        nearbyRowsAfterTown: nearbyLeft
      }
    };
  }
};
