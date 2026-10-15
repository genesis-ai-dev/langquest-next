/** Bytes per second over a sliding window, for the sync screen's speeds. */
export class RateMeter {
  private samples: { at: number; bytes: number }[] = [];
  constructor(private readonly windowMs = 10_000) {}
  add(bytes: number, at = Date.now()): void {
    this.samples.push({ at, bytes });
  }
  perSecond(now = Date.now()): number {
    const from = now - this.windowMs;
    this.samples = this.samples.filter((s) => s.at >= from);
    const total = this.samples.reduce((n, s) => n + s.bytes, 0);
    return (total * 1000) / this.windowMs;
  }
}
