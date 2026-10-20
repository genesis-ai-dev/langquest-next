import { emptyLanguageState, foldLanguage, languageLines, REDUCER_VERSION } from '@langquest-next/core';
import { always, Fleet, FLEET_EPOCH, NETWORKS, offlineBetween, patchy, TIME, village, type Link } from '../src/testing';

/**
 * A small fleet on simulated time (docs/fleet-simulation.md): the app's
 * sync code on every phone, against the fake server. The full scenarios
 * are `npm run fleet`; this keeps the cheap guarantees in `npm test`.
 */
const mixed = (_role: string, i: number, r: { int(a: number, b: number): number }): Link =>
  i % 3 === 0 ? always(NETWORKS.phone, 'phone')
    : i % 3 === 1 ? village(NETWORKS.phone, 2, 3, r.int(8, 14))
      : patchy(NETWORKS.slow, 180, 40, r.int(0, 179));

async function run(seed: number, link = mixed, days = 4) {
  const fleet = new Fleet({ seed, crew: { passages: 40, translators: 4, reviewers: 3, link } });
  await fleet.start();
  await fleet.runFor(days * TIME.DAY);
  const agreement = await fleet.settle();
  return fleet.report(agreement, 0);
}

// Each scenario is CPU-bound: a second or two alone, many times that on a machine busy with other
// builds, where the default 5 s timed out the pre-push run (2026-10-14). Simulated time keeps the
// result the same however long it takes.
describe('a fleet of phones on simulated time', { timeout: 60_000 }, () => {
  it('ends with every phone holding the same state as the server, on mixed links', async () => {
    // Why: invariant 2 across a fleet. Phones that work offline for days,
    // lose calls mid-answer and catch up in slices must all fold to what
    // the server's log folds to.
    const r = await run(1);
    expect(r.errors).toEqual([]);
    expect(r.agreement).toMatchObject({ caughtUp: true, agree: true, disagree: [] });
    expect(r.events.appended).toBe(r.events.onServer);
    expect(r.phones.syncErrors).toBe(0);
  });

  it('is deterministic for a seed', async () => {
    // Why: a scenario that finds a problem must find it again on the next run.
    const a = await run(7);
    const b = await run(7);
    expect(b.agreement?.digest).toBe(a.agreement?.digest);
    expect(b.events).toEqual(a.events);
    expect(b.server).toEqual(a.server);
    expect(b.phones.syncs).toBe(a.phones.syncs);
  });

  it('drains a village that reconnects after working offline', async () => {
    // Why: everyone's month of work reaching the server at once is the
    // moment an offline-first app is for.
    const r = await run(3, () => offlineBetween(FLEET_EPOCH + 2 * TIME.HOUR, FLEET_EPOCH + 3 * TIME.DAY, always(NETWORKS.phone, 'phone')), 4);
    expect(r.errors).toEqual([]);
    expect(r.agreement?.agree).toBe(true);
    expect(r.phones.pushDelayMinutes.max).toBeGreaterThan(24 * 60);
    expect(r.phones.refolds).toBe(0);
  });

  it('an update that changes the reducer, on phones that keep their store, leaves every phone with the whole language', async () => {
    // Why: phones prune their log behind their checkpoint, and an update
    // that bumps REDUCER_VERSION makes the checkpoint unreadable. Folding
    // the tail that was left lost those phones most of the language for
    // good (2026-10-15); a reinstall with an empty store never showed it.
    // Half the phones update before the server has a snapshot for the new
    // reducer (they pull the stream again), half after (they take it).
    const fleet = new Fleet({ seed: 11, checkpointEvery: 20, crew: { passages: 40, translators: 4, reviewers: 3, link: mixed } });
    await fleet.start();
    await fleet.runFor(2 * TIME.DAY);
    const pruned = (await Promise.all(fleet.devices.map((d) => d.client.inspect()))).filter((v) => (v.checkpointSeq ?? 0) > 0).length;
    expect(pruned).toBeGreaterThan(fleet.devices.length / 2);
    const updateAt = fleet.time.now() - FLEET_EPOCH + 9 * TIME.HOUR;
    fleet.at(updateAt, () => fleet.deployReducer(REDUCER_VERSION + 1));
    for (const [i, d] of fleet.devices.entries()) {
      fleet.at(updateAt + (i % 2 === 0 ? TIME.MINUTE : 2 * TIME.HOUR), () => d.update(REDUCER_VERSION + 1));
    }
    await fleet.runFor(2 * TIME.DAY);
    const r = fleet.report(await fleet.settle(), 0);
    expect(r.errors).toEqual([]);
    expect(r.agreement).toMatchObject({ caughtUp: true, agree: true, disagree: [] });
    expect(r.events.appended).toBe(r.events.onServer);
    const dropped = fleet.devices.flatMap((d) => d.diag.records).filter((x) => x.kind === 'load' && x.n.staleCheckpointSeq !== undefined);
    expect(dropped).toHaveLength(pruned);
  });

  it('moves the audio too: every recording reaches the server, and reviewers hear what they review', async () => {
    // Why: work is audio. An event that arrives without its recording is a
    // passage nobody can review, and a recording that never leaves the phone
    // is work lost with the phone.
    const fleet = new Fleet({ seed: 5, audio: { bytesPerSecond: 16_000 }, crew: { passages: 12, translators: 2, reviewers: 2, link: mixed } });
    await fleet.start();
    await fleet.runFor(2 * TIME.DAY);
    const r = fleet.report(await fleet.settle(), 0);
    expect(r.errors).toEqual([]);
    expect(r.agreement?.agree).toBe(true);
    expect(r.audio).toMatchObject({ lost: 0 });
    expect(r.audio!.recorded).toBeGreaterThan(0);
    expect(r.audio!.onServer).toBe(r.audio!.recorded);
    expect(r.audio!.downloads).toBeGreaterThan(0);
  });

  it('phones that keep the language on disk end with the same language, and move the same audio', async () => {
    // Why: a phone that keeps a big language on disk (decisions.md 143) folds
    // what arrives for a passage it does not hold, and combines it with the
    // stored copy at its next checkpoint. Across days offline, snapshots and
    // reinstalls, it must still end where the server's log does, and still
    // send every recording and fetch what its person needs.
    const fleet = new Fleet({ seed: 11, keepOnDisk: 'half', checkpointEvery: 25, audio: { bytesPerSecond: 16_000 }, crew: { passages: 24, translators: 3, reviewers: 3, link: mixed } });
    await fleet.start();
    await fleet.runFor(3 * TIME.DAY);
    const r = fleet.report(await fleet.settle(), 0);
    expect(r.errors).toEqual([]);
    expect(r.agreement).toMatchObject({ caughtUp: true, agree: true, disagree: [] });
    expect(r.audio).toMatchObject({ lost: 0 });
    expect(r.audio!.onServer).toBe(r.audio!.recorded);
    const onDisk = fleet.devices.filter((d) => d.keepsOnDisk);
    expect(onDisk.length).toBeGreaterThan(2);
    // Their lists read the same as the server's log: every passage's line.
    const server = foldLanguage(fleet.server.stream(fleet.orgId, fleet.streamId), emptyLanguageState());
    const units = Object.keys(server.units);
    const lines = (l: { get(u: string): unknown }) => JSON.parse(JSON.stringify(units.map((u) => l.get(u))));
    for (const d of onDisk) {
      await d.client.settleLines();
      expect(lines(d.client.passageLines()), d.id).toEqual(lines(languageLines(server)));
      // And memory holds none of the language's versions: they are on the phone's disk.
      expect(Object.values(d.client.getState().takes).filter((t) => t.unitId).length, d.id).toBeLessThan(5);
    }
  });
});
