import { always, Fleet, FLEET_EPOCH, NETWORKS, TIME, type SimDevice } from '@langquest-next/client/src/testing';
import { cpuSince, mark, type Scenario } from './types';

/**
 * What makes phones refold their whole log (performance-audit.md item 7),
 * which the other scenarios never trigger because the fake server accepts
 * everything. Two causes, one after the other:
 *
 * - The language is not listed yet: the coordinator created it on a phone
 *   and its events reach the server before the organization lists it. They
 *   are refused, re-queued on every push, and each push refolds.
 * - A moderator: once it is listed, the coordinator takes notes out of the
 *   record as it goes; every phone that pulls a redaction refolds.
 *
 * Read refolds per phone in each part, and the sync CPU they cost.
 */
export const refoldTriggers: Scenario = {
  name: 'refoldTriggers',
  summary: 'A language not listed yet for the first hours, then a moderator redacting notes.',
  defaults: { seed: 1, days: 3, passages: 300, translators: 8, reviewers: 5, unlistedHours: 10, redactShare: 0.5 },
  async run(k) {
    const started = performance.now();
    const listedAt = FLEET_EPOCH + k.unlistedHours! * TIME.HOUR;
    const fleet = new Fleet({
      seed: k.seed!,
      unlistedUntil: listedAt,
      crew: {
        passages: k.passages!,
        translators: k.translators!,
        reviewers: k.reviewers!,
        redactShare: k.redactShare!,
        link: () => always(NETWORKS.phone, 'phone')
      }
    });
    await fleet.start();
    const cpu0 = mark(fleet.devices);
    await fleet.time.runUntil(listedAt);
    const unlisted = { refolds: refolds(fleet.devices, FLEET_EPOCH, listedAt), syncCpuMs: cpuSince(fleet.devices, cpu0) };
    const cpu1 = mark(fleet.devices);
    await fleet.time.runUntil(FLEET_EPOCH + k.days! * TIME.DAY);
    const moderated = { refolds: refolds(fleet.devices, listedAt, fleet.time.now()), syncCpuMs: cpuSince(fleet.devices, cpu1) };
    const redactions = fleet.server.stream(fleet.orgId, fleet.streamId).filter((e) => e.type === 'v1.Redacted').length;
    const agreement = await fleet.settle();
    return {
      report: fleet.report(agreement, performance.now() - started),
      findings: {
        whileUnlisted: { hours: k.unlistedHours, refolds: unlisted.refolds.total, worstPhone: unlisted.refolds.worst, syncCpuMsTotal: unlisted.syncCpuMs.total },
        afterListing: { redactions, refolds: moderated.refolds.total, perPhone: Math.round(moderated.refolds.total / fleet.devices.length), syncCpuMsTotal: moderated.syncCpuMs.total }
      }
    };
  }
};

/** Loads recorded in [from, to), less the one at install (the first record). */
function refolds(devices: SimDevice[], from: number, to: number): { total: number; worst: number } {
  const counts = devices.map((d) => {
    const loads = d.diag.records.filter((r) => r.kind === 'load');
    return loads.slice(1).filter((r) => r.at >= from && r.at < to).length;
  });
  return { total: counts.reduce((a, b) => a + b, 0), worst: Math.max(0, ...counts) };
}
