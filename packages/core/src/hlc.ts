/**
 * Hybrid logical clock encoded as a lexically sortable string:
 *   <wall ms, 15 digits>:<counter, 6 digits>:<nodeId>
 *
 * Comparing two HLC strings with `<` orders events causally when they are
 * related and by wall time otherwise. The node id breaks the final tie so two
 * devices never produce an equal clock.
 */
export type Hlc = string;

const WALL_WIDTH = 15;
const COUNTER_WIDTH = 6;

export function encodeHlc(wallMs: number, counter: number, nodeId: string): Hlc {
  return `${String(wallMs).padStart(WALL_WIDTH, '0')}:${String(counter).padStart(COUNTER_WIDTH, '0')}:${nodeId}`;
}

export function decodeHlc(hlc: Hlc): { wallMs: number; counter: number; nodeId: string } {
  const [wall, counter, nodeId] = hlc.split(':');
  if (wall === undefined || counter === undefined || nodeId === undefined) {
    throw new Error(`Malformed HLC: ${hlc}`);
  }
  return { wallMs: Number(wall), counter: Number(counter), nodeId };
}

export class HlcClock {
  private wallMs = 0;
  private counter = 0;

  /**
   * @param seed the last clock this node emitted or received, persisted by
   * the caller across restarts. Without it a device whose wall clock went
   * backwards would emit clocks older than its own history.
   */
  constructor(
    private readonly nodeId: string,
    private readonly now: () => number = () => Date.now(),
    seed?: Hlc | null
  ) {
    if (seed) {
      const { wallMs, counter } = decodeHlc(seed);
      this.wallMs = wallMs;
      this.counter = counter;
      this.seeded = true;
    }
  }

  private seeded = false;

  /** Newest clock emitted or received, or null if nothing yet. */
  last(): Hlc | null {
    return this.seeded ? encodeHlc(this.wallMs, this.counter, this.nodeId) : null;
  }

  /** Produce a clock for a locally generated event. */
  next(): Hlc {
    const physical = this.now();
    if (physical > this.wallMs) {
      this.wallMs = physical;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    this.seeded = true;
    return encodeHlc(this.wallMs, this.counter, this.nodeId);
  }

  /** Advance past a clock received from another node. */
  receive(remote: Hlc): void {
    const { wallMs, counter } = decodeHlc(remote);
    const physical = this.now();
    const maxWall = Math.max(physical, wallMs, this.wallMs);
    if (maxWall === this.wallMs && maxWall === wallMs) {
      this.counter = Math.max(this.counter, counter) + 1;
    } else if (maxWall === this.wallMs) {
      this.counter += 1;
    } else if (maxWall === wallMs) {
      this.counter = counter + 1;
    } else {
      this.counter = 0;
    }
    this.wallMs = maxWall;
    this.seeded = true;
  }
}
