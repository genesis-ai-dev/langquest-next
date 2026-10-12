import { always, Fleet, NETWORKS, patchy, TIME, village } from '@langquest-next/client/src/testing';
import type { Scenario } from './types';

/**
 * Ordinary weeks: a team on a mix of links (a phone signal, a trip to town
 * every few days, a patchy slow signal) translating and reviewing in office
 * hours. The baseline the other scenarios are read against: sync CPU per
 * run, how long work takes to reach the others, and how often phones wake
 * with no signal.
 */
export const normalDay: Scenario = {
  name: 'normalDay',
  summary: 'A team on mixed links working office hours for a week.',
  defaults: { seed: 1, days: 7, passages: 300, translators: 8, reviewers: 5 },
  async run(k) {
    const started = performance.now();
    const fleet = new Fleet({
      seed: k.seed!,
      crew: {
        passages: k.passages!,
        translators: k.translators!,
        reviewers: k.reviewers!,
        link: (_role, i, r) =>
          i % 10 < 4 ? always(NETWORKS.phone, 'phone')
            : i % 10 < 7 ? village(NETWORKS.phone, 3, 4, r.int(8, 15))
              : patchy(NETWORKS.slow, 240, 45, r.int(0, 239))
      }
    });
    await fleet.start();
    await fleet.runFor(k.days! * TIME.DAY);
    const agreement = await fleet.settle();
    const report = fleet.report(agreement, performance.now() - started);
    return {
      report,
      findings: {
        wakesWithNoSignalPerPhonePerDay: Math.round(report.phones.offlineSyncs / report.simulated.devices / k.days!)
      }
    };
  }
};
