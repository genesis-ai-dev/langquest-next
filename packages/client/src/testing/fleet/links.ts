import type { LinkState, NetworkShape } from '../shapedTransport';

/** A device's connection over time: when it has a signal, and how good it is then. */
export interface Link extends LinkState {
  name: string;
  /** The next moment after `t` that `online` changes, or Infinity. */
  nextChange(t: number): number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Connection qualities seen in the field (decision 71 measured on 12/4 Mbit/s, 120 ms). */
export const NETWORKS = {
  wifi: { latencyMs: 40, bytesPerSecond: 2_000_000, dropRate: 0 },
  phone: { latencyMs: 120, bytesPerSecond: 500_000, dropRate: 0.01 },
  /** The slow links `scripts/diagSignals.ts` flags: under 20 KB/s. */
  slow: { latencyMs: 400, bytesPerSecond: 20_000, dropRate: 0.05 }
} satisfies Record<string, NetworkShape>;

export function always(net: NetworkShape, name = 'always'): Link {
  return { ...net, name, online: () => true, nextChange: () => Infinity };
}

export function never(net: NetworkShape, name = 'never'): Link {
  return { ...net, name, online: () => false, nextChange: () => Infinity };
}

/**
 * A signal for `upMs` out of every `periodMs`, starting `phaseMs` in: a trip
 * to town every few days, or a weak signal that comes and goes.
 */
export function periodic(net: NetworkShape, o: { periodMs: number; upMs: number; phaseMs: number }, name = 'periodic'): Link {
  const pos = (t: number) => (((t - o.phaseMs) % o.periodMs) + o.periodMs) % o.periodMs;
  return {
    ...net,
    name,
    online: (t) => pos(t) < o.upMs,
    nextChange: (t) => {
      const p = pos(t);
      return p < o.upMs ? t + (o.upMs - p) : t + (o.periodMs - p);
    }
  };
}

/** No signal until `at`, then `then` (a village that reaches town). */
export function offlineUntil(at: number, then: Link): Link {
  return {
    ...then,
    name: `offline until ${new Date(at).toISOString().slice(0, 10)}, then ${then.name}`,
    online: (t) => t >= at && then.online(t),
    nextChange: (t) => (t < at ? at : then.nextChange(t))
  };
}

/** `link`, except no signal from `from` until `to`: a team that set up in town, then worked out of reach. */
export function offlineBetween(from: number, to: number, link: Link): Link {
  return {
    ...link,
    name: `offline for ${Math.round((to - from) / DAY)}d, then ${link.name}`,
    online: (t) => (t < from || t >= to) && link.online(t),
    nextChange: (t) => (t < from ? Math.min(from, link.nextChange(t)) : t < to ? to : link.nextChange(t))
  };
}

/** In town every `everyDays` for `hours`, at an hour of the day set by `phaseHours`. */
export function village(net: NetworkShape, everyDays: number, hours: number, phaseHours: number): Link {
  return periodic(net, { periodMs: everyDays * DAY, upMs: hours * HOUR, phaseMs: phaseHours * HOUR }, `village every ${everyDays}d`);
}

/** A signal for `upMinutes` out of every `periodMinutes`. */
export function patchy(net: NetworkShape, periodMinutes: number, upMinutes: number, phaseMinutes: number): Link {
  return periodic(net, { periodMs: periodMinutes * MINUTE, upMs: upMinutes * MINUTE, phaseMs: phaseMinutes * MINUTE }, 'patchy');
}

export const TIME = { MINUTE, HOUR, DAY };
