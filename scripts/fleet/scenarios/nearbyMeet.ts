import { isServerEventId } from '@langquest-next/core';
import { TIME, type Fleet, type SimDevice } from '@langquest-next/sync/src/testing';

/**
 * What the nearby scenarios share: a team meeting with Share nearby open, and whether its
 * phones hold the same things. Not a scenario.
 */

export interface Meeting {
  /** Simulated minutes from opening the screens to every phone holding the same events and files. Null if they never did. */
  minutesToLevel: number | null;
  /** Sessions a phone had opened by then. */
  pairingsToLevel: number | null;
  /** Simulated minutes until every room had stopped by itself. */
  minutesOpen: number;
  /** Sessions a phone opened during the meeting. */
  pairings: number;
  /** Of those, how many ended with both sides done, and how many met a phone already in a session. */
  done: number;
  busy: number;
  /** Megabytes the radios carried during the meeting. */
  mbBluetooth: number;
  mbWifi: number;
}

/**
 * The team opens Share nearby together and keeps it open until every room stops by itself
 * ("Up to date", then the idle limit), or `maxMs` passes. Checked every 10 simulated seconds.
 */
export async function meet(fleet: Fleet, team: readonly SimDevice[], maxMs = 3 * TIME.HOUR): Promise<Meeting> {
  const nearby = fleet.nearby!;
  const ended = (how: string) => nearby.stats.ended[how] ?? 0;
  const before = { pairings: nearby.stats.pairings, done: ended('done'), busy: ended('heard:busy'), bt: nearby.stats.bytes['bluetooth'] ?? 0, wifi: nearby.stats.bytes['wifi'] ?? 0 };
  const started = fleet.time.now();
  await nearby.gather(team);
  let minutesToLevel: number | null = null;
  let pairingsToLevel: number | null = null;
  while (fleet.time.now() - started < maxMs) {
    await fleet.runFor(10_000);
    if (minutesToLevel === null && await level(team)) {
      minutesToLevel = round((fleet.time.now() - started) / TIME.MINUTE);
      pairingsToLevel = nearby.stats.pairings - before.pairings;
    }
    if (nearby.allStopped(team)) break;
  }
  const minutesOpen = Math.round((fleet.time.now() - started) / TIME.MINUTE);
  await nearby.leave(team);
  return {
    minutesToLevel, pairingsToLevel, minutesOpen,
    pairings: nearby.stats.pairings - before.pairings,
    // Both sides count a session that ended done.
    done: (ended('done') - before.done) / 2,
    busy: ended('heard:busy') - before.busy,
    mbBluetooth: round(((nearby.stats.bytes['bluetooth'] ?? 0) - before.bt) / 1e6),
    mbWifi: round(((nearby.stats.bytes['wifi'] ?? 0) - before.wifi) / 1e6)
  };
}

/**
 * Every phone holds every event any of them holds, and every audio file. Events only the
 * server makes (its file verdicts) are left out: a phone back from town has them, and no
 * claim carries them (core `shouldClaim`), so the others get them only from the server.
 */
export async function level(team: readonly SimDevice[]): Promise<boolean> {
  const sets = await Promise.all(team.map(async (d) => [...await d.eventIds()].filter((id) => !isServerEventId(id))));
  const all = new Set(sets.flat());
  if (!sets.every((s) => s.length === all.size)) return false;
  const files = new Set(team.flatMap((d) => [...d.audioHere]));
  return team.every((d) => d.audioHere.size === files.size);
}

/**
 * Each phone's app opened again on its store: the wait to open the language in real
 * milliseconds on this machine, and the fold inside it (`SimDevice.timeLoad`), and how many
 * events it folded. Then the app runs on as before.
 */
export async function loads(team: readonly SimDevice[]): Promise<{ device: string; kept: boolean; ms: number; readMs: number; foldMs: number; events: number }[]> {
  const out = [];
  for (const d of team) {
    d.stop();
    const n = await d.timeLoad();
    await d.restart();
    out.push({ device: d.id, kept: d.keepsOnDisk, ms: round(n['ms'] ?? 0), readMs: round(n['readMs'] ?? 0), foldMs: round(n['foldMs'] ?? 0), events: n['events'] ?? 0 });
  }
  return out;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
