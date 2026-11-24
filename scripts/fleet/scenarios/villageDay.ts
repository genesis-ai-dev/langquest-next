import { decodeHlc } from '@langquest-next/core';
import { always, Fleet, FLEET_EPOCH, NETWORKS, offlineBetween, seededRandom, TIME, type SimDevice } from '@langquest-next/sync/src/testing';
import { level, round } from './nearbyMeet';
import type { Knobs, Scenario } from './types';

/**
 * Sharing while LangQuest is open, against Share nearby each evening (docs/nearby-sync-plan.md
 * 15.10, phase 8). The same team, offline for `days` days, runs three times on one seed:
 *
 * - **While open:** each phone opens LangQuest for `windows` windows a day of `windowMin` minutes,
 *   at random between 8:00 and 18:00, and in each it is near the team with the chance `together`.
 *   Phones near the team with LangQuest open share; nobody opens Share nearby. Rooms run as the app
 *   runs them then (the fleet's `open`, 15.6): no idle stop, since the screen going off is the
 *   limit, no tap, and scans of six seconds a minute while "Up to date".
 * - **Each evening:** at 17:00 each phone opens Share nearby with the chance `eveningRate` (1, the
 *   strongest case, when nobody forgets) and keeps it open until every phone that came holds the
 *   same, and then Share nearby's idle limit (5 minutes), or three hours at most. The scenario ends
 *   the meeting itself, so it ends the same way in the run where rooms never idle.
 * - **Both:** the mode does not replace Share nearby, so this is what a team with it would do: the
 *   same windows as the first, and the same evenings as the second. With `eveningRate` below 1 it
 *   says what the mode adds for a team that forgets.
 *
 * Read, for each: how many hours a review took to reach the phone of the person whose version it
 * reviews, how many phones held each recording before the trip to town, the radios' megabytes,
 * and phone-minutes with the radios on (the battery's rough measure). Then everyone reaches the
 * server, and every phone must agree with it with nothing left nearby. If sharing while open does
 * not clearly beat the evening, phase 10 stops (15.10).
 *
 * Every phone here is an Android with Wi-Fi Direct; on an iPhone the mode moves events only. Work
 * goes on whether or not the window is open (the fleet's apps are always open, Limits), and
 * nothing pauses for recording or playing.
 */
export const villageDay: Scenario = {
  name: 'villageDay',
  summary: 'A village team shares while LangQuest is open, against Share nearby each evening.',
  defaults: { seed: 1, days: 5, passages: 60, translators: 3, reviewers: 2, audio: 1, audioKBps: 16, windows: 4, windowMin: 20, together: 0.6, eveningRate: 1, sampleMin: 10 },
  async run(k) {
    const whileOpen = await oneWay(k, 'open');
    const evening = await oneWay(k, 'evening');
    const both = await oneWay(k, 'both');
    return { report: both.report, findings: { whileOpen: whileOpen.findings, evening: evening.findings, both: both.findings } };
  }
};

type Way = 'open' | 'evening' | 'both';

/** Share nearby's idle limit (the app's `NEARBY_IDLE_LIMIT_MS`): "Up to date" this long with nobody new stops it. */
const SHARE_NEARBY_IDLE_MS = 5 * TIME.MINUTE;

async function oneWay(k: Knobs, way: Way) {
  const started = performance.now();
  const away = FLEET_EPOCH + 2 * TIME.HOUR;
  const back = FLEET_EPOCH + 1000 * TIME.DAY;
  const fleet = new Fleet({
    seed: k.seed!,
    audio: k.audio ? { bytesPerSecond: k.audioKBps! * 1000 } : null,
    keepOnDisk: 'half',
    // While open, rooms run as the app runs them then (15.6): no tap, no idle stop, scans in bursts at "Up to date".
    nearby: way === 'evening' ? {} : { open: true },
    crew: { passages: k.passages!, translators: k.translators!, reviewers: k.reviewers!, link: () => offlineBetween(away, back, always(NETWORKS.phone, 'phone')) }
  });
  await fleet.start();
  const nearby = fleet.nearby!;
  const team = fleet.devices.slice(1);
  // One stream for the windows and one for who comes in the evening, so each way draws the same ones.
  const windowsRandom = seededRandom(k.seed! * 7_919 + 1);
  const eveningRandom = seededRandom(k.seed! * 7_919 + 2);
  const sampleMs = k.sampleMin! * TIME.MINUTE;

  // When each event first showed on each phone, sampled every `sampleMin` minutes.
  const firstSeen = new Map<SimDevice, Map<string, number>>(team.map((d) => [d, new Map()]));
  let lastSample = -Infinity;
  const sample = async (force = false) => {
    const now = fleet.time.now();
    if (!force && now - lastSample < sampleMs) return;
    lastSample = now;
    for (const d of team) {
      const seen = firstSeen.get(d)!;
      for (const id of await d.eventIds()) if (!seen.has(id)) seen.set(id, now);
    }
  };

  let phoneMinutesRadio = 0;
  let meetings = 0;
  const eveningMeeting = async () => {
    const who = team.filter(() => eveningRandom.chance(k.eveningRate!));
    if (who.length < 2) return;
    meetings += 1;
    const opened = fleet.time.now();
    await nearby.gather(who);
    let levelAt: number | null = null;
    while (fleet.time.now() - opened < 3 * TIME.HOUR) {
      await fleet.runFor(10_000);
      if (levelAt === null && await level(who)) { levelAt = fleet.time.now(); await sample(true); }
      if (levelAt !== null && fleet.time.now() - levelAt >= SHARE_NEARBY_IDLE_MS) break;
    }
    await nearby.leave(who);
    phoneMinutesRadio += Math.round((fleet.time.now() - opened) / TIME.MINUTE) * who.length;
    await sample(true);
  };
  for (let day = 0; day < k.days!; day++) {
    const dayStart = FLEET_EPOCH + day * TIME.DAY;
    const evening = dayStart + 17 * TIME.HOUR;
    if (way !== 'evening') {
      const windows = team.flatMap((d) => Array.from({ length: k.windows! }, () => {
        const from = dayStart + 8 * TIME.HOUR + windowsRandom.int(0, 10 * 60 - k.windowMin!) * TIME.MINUTE;
        return { d, from, to: from + k.windowMin! * TIME.MINUTE, near: windowsRandom.chance(k.together!) };
      }));
      let open = new Set<SimDevice>();
      let met = way === 'open';
      while (fleet.time.now() < dayStart + TIME.DAY) {
        const now = fleet.time.now();
        if (!met && now >= evening) {
          await nearby.leave([...open]);
          open = new Set();
          await eveningMeeting();
          met = true;
          continue;
        }
        const want = new Set(windows.filter((w) => w.near && w.from <= now && now < w.to).map((w) => w.d));
        const gone = [...open].filter((d) => !want.has(d));
        if (gone.length > 0) await nearby.leave(gone);
        if ([...want].some((d) => !open.has(d))) {
          if (want.size > 1) meetings += 1;
          await nearby.gather([...want]);
        }
        open = want;
        phoneMinutesRadio += open.size;
        await fleet.runFor(TIME.MINUTE);
        await sample();
      }
      await nearby.leave([...open]);
    } else {
      while (fleet.time.now() < evening) { await fleet.runFor(sampleMs); await sample(); }
      await eveningMeeting();
      while (fleet.time.now() < dayStart + TIME.DAY) { await fleet.runFor(sampleMs); await sample(); }
    }
  }
  await sample(true);

  const reviews = await reviewsReachingTranslators(team, firstSeen);
  const files = new Set(team.flatMap((d) => [...d.audioHere]));
  const copies = [...files].map((h) => team.filter((d) => d.audioHere.has(h)).length);
  const bytes = (nearby.stats.bytes['bluetooth'] ?? 0) + (nearby.stats.bytes['wifi'] ?? 0);
  const beforeTown = {
    reviews,
    recordings: { files: files.size, onOnePhoneOnly: copies.filter((n) => n === 1).length, meanPhones: round(copies.reduce((a, b) => a + b, 0) / Math.max(1, copies.length)) },
    meetings,
    pairings: nearby.stats.pairings,
    mbRadio: round(bytes / 1e6),
    phoneMinutesRadio
  };

  // The trip to town: everyone reaches the server, and every phone must agree with it.
  const town = fleet.time.now();
  for (const d of team) d.setLink(always(NETWORKS.phone, 'phone'));
  const agreement = await fleet.settle(24 * TIME.HOUR);
  const nearbyLeft = (await Promise.all(fleet.devices.map((d) => d.client.inspect()))).reduce((n, v) => n + v.nearby, 0);
  return {
    report: fleet.report(agreement, performance.now() - started),
    findings: { ...beforeTown, townMinutes: Math.round((fleet.time.now() - town) / TIME.MINUTE), nearbyRowsAfterTown: nearbyLeft }
  };
}

/**
 * Each review made offline, and how many hours it took to show on the phone of the person whose
 * version it reviews: from the review's own clock to the first sample that found it there. The
 * reviews come from each reviewer's unsent log, so those made in town before the team left are
 * not counted; the version's author from the reviewer's own fold.
 */
async function reviewsReachingTranslators(team: readonly SimDevice[], firstSeen: ReadonlyMap<SimDevice, ReadonlyMap<string, number>>) {
  const hours: number[] = [];
  let made = 0;
  for (const d of team) {
    const pending = (await d.client.inspect()).pending.map((l) => l.event).filter((e) => e.type === 'v1.ReviewRecorded');
    if (pending.length === 0) continue;
    const state = await d.wholeState();
    for (const e of pending) {
      const takeId = (e.payload as { takeId: string }).takeId;
      const author = team.find((t) => t.actorId === state.takes[takeId]?.actorId);
      if (!author || author === d) continue;
      made += 1;
      const at = firstSeen.get(author)?.get(e.id);
      if (at !== undefined) hours.push((at - decodeHlc(e.hlc).wallMs) / TIME.HOUR);
    }
  }
  const sorted = [...hours].sort((a, b) => a - b);
  const q = (p: number) => (sorted.length ? round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!) : null);
  return { made, reachedTheirTranslator: hours.length, hours: { p50: q(0.5), p90: q(0.9), max: sorted.length ? round(sorted[sorted.length - 1]!) : null } };
}
