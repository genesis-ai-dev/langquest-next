import { newCommandId } from '@langquest-next/core';
import { NEARBY_BUDGET } from '@langquest-next/core/nearby';
import { always, Fleet, FLEET_EPOCH, NETWORKS, offlineBetween, passageId, TIME, type SimDevice } from '@langquest-next/sync/src/testing';
import { loads, meet, round, type Meeting } from './nearbyMeet';
import type { Scenario } from './types';

/**
 * A team with no server for a month (docs/nearby-sync-plan.md 5.4, section 8's Fleet row,
 * section 11): it sets up in town, works out of reach, meets with Share nearby open every
 * evening, then makes one trip to town where every phone reaches the server. Every phone
 * must end with the server holding everything, agreeing with a fold of the server's log,
 * and with nothing left nearby.
 *
 * `atBudget` makes one translator also write notes up to `budgetRows` (Carl's budget per
 * signer, answer 21, is 70,000 rows and 50 MB), so every phone holds a month of one member
 * at the budget. Read `load` and `foldMs` before the trip to town: each phone's app is
 * restarted then, and every load folds every nearby row, since none can be pruned before the
 * server confirms it (5.4, the memory row). Run it with `--atBudget=0` for the same month
 * without that member.
 */
export const villageMonth: Scenario = {
  name: 'villageMonth',
  summary: 'A team offline for a month shares nearby each evening, then makes one trip to town.',
  defaults: { seed: 1, days: 30, passages: 300, translators: 3, reviewers: 2, audio: 1, audioKBps: 16, atBudget: 1, budgetRows: 68_000, noteChars: 300, keepOnDisk: 1, verbose: 0 },
  async run(k) {
    const started = performance.now();
    const away = FLEET_EPOCH + 2 * TIME.HOUR;
    const town = FLEET_EPOCH + k.days! * TIME.DAY + 9 * TIME.HOUR;
    const fleet = new Fleet({
      seed: k.seed!,
      audio: k.audio ? { bytesPerSecond: k.audioKBps! * 1000 } : null,
      keepOnDisk: k.keepOnDisk ? 'half' : false,
      nearby: {},
      crew: {
        passages: k.passages!,
        translators: k.translators!,
        reviewers: k.reviewers!,
        link: () => offlineBetween(away, town, always(NETWORKS.phone, 'phone'))
      }
    });
    await fleet.start();
    const team = fleet.devices.slice(1);
    const heavy = team[0]!;
    if (k.atBudget) floodNotes(fleet, heavy, { rows: k.budgetRows!, days: k.days! - 1, chars: k.noteChars!, passages: k.passages! });

    const meetings: Meeting[] = [];
    for (let day = 0; day < k.days!; day++) {
      await fleet.time.runUntil(FLEET_EPOCH + day * TIME.DAY + 17 * TIME.HOUR);
      meetings.push(await meet(fleet, team, 3 * TIME.HOUR));
      if (k.verbose) console.error(`day ${day}: ${JSON.stringify(meetings.at(-1))} after ${round((performance.now() - started) / 1000)} s`);
    }

    // The evening before town: each app restarted, as a phone left overnight would be.
    const nearbyHeld = await Promise.all(team.map(async (d) => (await d.client.inspect()).nearby));
    // What a phone holds for this: the fold in memory as JSON (a JavaScript heap holds a few times that), and the unconfirmed rows' JSON on disk.
    const held = await Promise.all(team.map(async (d) => {
      const rows = [...await d.nearbyRows(), ...(await d.client.inspect()).pending.map((l) => l.event)];
      return { device: d.id, kept: d.keepsOnDisk, rows: rows.length, rowsMb: round(rows.reduce((n, e) => n + JSON.stringify(e).length, 0) / 1e6), stateMb: round(JSON.stringify(d.client.getState()).length / 1e6) };
    }));
    const heavyRows = (await heavy.client.inspect()).pending.length;
    const loaded = await loads(team);
    const heap = process.memoryUsage().heapUsed;

    const agreement = await fleet.settle(24 * TIME.HOUR);
    const report = fleet.report(agreement, performance.now() - started);
    const nearbyLeft = (await Promise.all(fleet.devices.map((d) => d.client.inspect()))).reduce((n, v) => n + v.nearby, 0);
    const p = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;
    return {
      report,
      findings: {
        budget: { maxRows: NEARBY_BUDGET.maxRows, maxBytes: NEARBY_BUDGET.maxBytes, memberRowsUnsent: k.atBudget ? heavyRows : 0 },
        meetings: meetings.length,
        pairings: meetings.reduce((n, m) => n + m.pairings, 0),
        meetingsLevel: meetings.filter((m) => m.minutesToLevel !== null).length,
        minutesToLevel: { p50: p(meetings.map((m) => m.minutesToLevel ?? Infinity), 0.5), max: Math.max(...meetings.map((m) => m.minutesToLevel ?? Infinity)) },
        mbRadio: round(meetings.reduce((n, m) => n + m.mbBluetooth + m.mbWifi, 0)),
        nearbyRowsBeforeTown: nearbyHeld,
        unconfirmedBeforeTown: held,
        loadBeforeTown: loaded,
        heapMbBeforeTown: round(heap / 1e6),
        nearbyRowsAfterTown: nearbyLeft
      }
    };
  }
};

/**
 * One member's notes up to the budget, a slice each working morning, every id naming them
 * (a phone over budget drops the page and keeps the number open, so this stays just under).
 */
function floodNotes(fleet: Fleet, d: SimDevice, o: { rows: number; days: number; chars: number; passages: number }): void {
  const perDay = Math.ceil(o.rows / o.days);
  const text = 'n'.repeat(o.chars);
  let written = 0;
  for (let day = 0; day < o.days; day++) {
    fleet.at(day * TIME.DAY + 10 * TIME.HOUR, async () => {
      for (let i = 0; i < perDay && written < o.rows; i += 500) {
        const n = Math.min(500, perDay - i, o.rows - written);
        const notes = Array.from({ length: n }, (_, j) => {
          const noteId = newCommandId(d.actorId, `flood-${written + j}`);
          return { type: 'v1.NoteAdded' as const, payload: { noteId, unitId: passageId((written + j) % o.passages), anchor: { kind: 'passage' as const }, text } };
        });
        written += n;
        await d.client.appendMany(notes);
        d.metrics.appended += n;
      }
    });
  }
}
