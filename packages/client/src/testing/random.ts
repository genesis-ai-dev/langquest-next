/**
 * Seeded randomness, so a simulated run with the same seed does the same
 * thing every time (mulberry32: small, fast, good enough for scheduling).
 */
export interface Random {
  /** In [0, 1), like Math.random. */
  (): number;
  /** An integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with this probability. */
  chance(p: number): boolean;
  /** A UUID-shaped id, as phones mint for events. */
  uuid(): string;
  /** A SHA-256-shaped hex string, as audio cards are named. */
  hash(): string;
  /** An independent stream for one device, so devices do not shift each other's draws. */
  fork(label: string): Random;
}

export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = (n: number): string => {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(next() * 16).toString(16);
    return s;
  };
  const r = (() => next()) as Random;
  r.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  r.chance = (p) => next() < p;
  r.uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(next() * 4)]}${hex(3)}-${hex(12)}`;
  r.hash = () => hex(64);
  r.fork = (label) => {
    let h = seed >>> 0;
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
    return seededRandom(h);
  };
  return r;
}
