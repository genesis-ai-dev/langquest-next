import { always, Fleet, FLEET_EPOCH, NETWORKS, never, offlineBetween, TIME, type SimDevice } from '@langquest-next/sync/src/testing';
import { meet, type Meeting } from './nearbyMeet';
import type { Scenario } from './types';

/**
 * One phone carries the team's work to town (docs/nearby-sync-plan.md section 6, phase 4). A
 * team with no signal works for `days` days and shares nearby each evening; then nobody works,
 * they meet once more, and one translator's phone ("Hold teammates' recordings" on, as every
 * fleet phone) alone reaches the server. Read whether the server then holds every event any
 * phone of the team made and every file it recorded, how many of them that phone delivered on
 * their authors' behalf, and how long town took. Then everyone reaches the server, and every
 * phone must fold to the server's log with nothing left nearby.
 */
export const nearbyCarry: Scenario = {
  name: 'nearbyCarry',
  summary: 'A village team shares nearby; one phone alone takes everyone\'s work to the server.',
  defaults: { seed: 1, days: 4, passages: 60, translators: 3, reviewers: 2, audio: 1 },
  async run(k) {
    const started = performance.now();
    const away = FLEET_EPOCH + 2 * TIME.HOUR;
    const back = FLEET_EPOCH + 1000 * TIME.DAY;
    const fleet = new Fleet({
      seed: k.seed!,
      audio: k.audio ? { bytesPerSecond: 16_000 } : null,
      keepOnDisk: 'half',
      nearby: { delivery: true },
      crew: { passages: k.passages!, translators: k.translators!, reviewers: k.reviewers!, link: () => offlineBetween(away, back, always(NETWORKS.phone, 'phone')) }
    });
    await fleet.start();
    const team = fleet.devices.slice(1);
    const carrier = team[0]!;

    const meetings: Meeting[] = [];
    for (let day = 0; day < k.days!; day++) {
      await fleet.time.runUntil(FLEET_EPOCH + day * TIME.DAY + 17 * TIME.HOUR);
      meetings.push(await meet(fleet, team));
    }
    // Nobody works from here on, and the team meets once more, so the carrier holds the last of it.
    fleet.stopWork();
    meetings.push(await meet(fleet, team));
    const made = await madeByTeam(team);

    // The carrier alone reaches the server.
    for (const d of team) if (d !== carrier) d.setLink(never(NETWORKS.phone));
    carrier.setLink(always(NETWORKS.phone, 'phone'));
    const town = fleet.time.now();
    let carried = false;
    while (!carried && fleet.time.now() - town < 6 * TIME.HOUR) {
      await fleet.runFor(TIME.MINUTE);
      carried = await carrierDone(fleet, carrier, made);
    }
    const onServer = new Set(fleet.server.stream(fleet.orgId, fleet.streamId).map((e) => e.id));
    const findings = {
      eventsTheTeamMade: made.events.size,
      filesTheTeamRecorded: made.files.size,
      eventsMissingFromServer: [...made.events].filter((id) => !onServer.has(id)).length,
      filesMissingFromServer: [...made.files].filter((h) => !fleet.server.blobs.has(h)).length,
      deliveredByCarrier: carrier.metrics.delivered,
      townMinutes: carried ? Math.round((fleet.time.now() - town) / TIME.MINUTE) : null,
      pairings: meetings.reduce((n, m) => n + m.pairings, 0)
    };

    // Then everyone reaches the server.
    const agreement = await fleet.settle();
    const report = fleet.report(agreement, performance.now() - started);
    const nearbyLeft = (await Promise.all(fleet.devices.map((d) => d.client.inspect()))).reduce((n, v) => n + v.nearby, 0);
    return { report, findings: { ...findings, agreeAfterEveryoneSyncs: agreement.agree, nearbyRowsAfter: nearbyLeft } };
  }
};

/** Every event the team's phones hold that the server did not have when they left, and every file one of them recorded. */
export async function madeByTeam(team: readonly SimDevice[]): Promise<{ events: Set<string>; files: Set<string> }> {
  const events = new Set<string>();
  const files = new Set<string>();
  for (const d of team) {
    for (const id of await d.eventIds()) events.add(id);
    for (const l of (await d.client.inspect()).pending) if (l.event.type === 'v1.RecordingAdded') for (const c of l.event.payload.cards) files.add(c.hash);
  }
  return { events, files };
}

/** The server holds all of it, or the carrier has nothing more it could send. */
async function carrierDone(fleet: Fleet, carrier: SimDevice, made: { events: Set<string>; files: Set<string> }): Promise<boolean> {
  const onServer = new Set(fleet.server.stream(fleet.orgId, fleet.streamId).map((e) => e.id));
  if ([...made.events].every((id) => onServer.has(id)) && [...made.files].every((h) => fleet.server.blobs.has(h))) return true;
  return carrier.caughtUp();
}
