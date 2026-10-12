import { stats, type FleetReport, type SimDevice, type Stats } from '@langquest-next/client/src/testing';

/** Knobs a scenario takes, all numbers; set any with `--name=value`. */
export type Knobs = Record<string, number>;

export interface Scenario {
  name: string;
  /** What it models and what to look at. */
  summary: string;
  defaults: Knobs;
  run(k: Knobs): Promise<{ report: FleetReport; findings: Record<string, unknown> }>;
}

/** Where every device's sync CPU samples stand now, to measure one stretch of a run. */
export function mark(devices: SimDevice[]): number[] {
  return devices.map((d) => d.metrics.syncCpuMs.length);
}

/** Sync CPU from a mark until now, across the fleet. */
export function cpuSince(devices: SimDevice[], from: number[]): Stats {
  return stats(devices.flatMap((d, i) => d.metrics.syncCpuMs.slice(from[i] ?? 0)));
}
