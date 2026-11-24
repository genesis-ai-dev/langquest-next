/**
 * Who runs the phone's one radio (docs/nearby-sync-plan.md 15.6, "One owner for the radios"): a
 * screen that runs it (Share nearby, Let someone in, Give the app, joining offline), or the quiet
 * mode while LangQuest is open. A screen claims the radios while it is open, and its claim stops
 * the quiet room at once, so a screen never waits on the mode and the two never run together.
 * Every room's start and stop goes through `turn`, one at a time in the order asked, so a stop
 * still finishing can never turn off radios a start has just turned on. Holds no radio itself.
 */
export interface NearbyOwner {
  /** A screen that runs the radios is open: the quiet room stops, and stays stopped until every claim is let go. Returns the release. */
  claim(): () => void;
  /** Some screen holds a claim now. */
  claimed(): boolean;
  /**
   * The quiet room is starting: how a claim stops it, through `turn`. Returns the forget, for when
   * it stopped by other means; it forgets only this one, never a later room's.
   */
  quiet(stop: () => Promise<void>): () => void;
  /** Runs `step` after every start or stop asked before it; one that fails does not hold up the next. */
  turn<T>(step: () => Promise<T>): Promise<T>;
  /** Be told when a claim is made or let go. Returns the unsubscribe. */
  subscribe(hear: () => void): () => void;
}

export function nearbyOwnerOf(): NearbyOwner {
  let claims = 0;
  let quietStop: (() => Promise<void>) | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const tell = () => { for (const hear of listeners) hear(); };
  const turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    claim() {
      claims += 1;
      const stop = quietStop;
      quietStop = null;
      // In the turn before anything the screen asks next, which is only ever after this.
      if (stop) void turn(stop).catch(() => undefined);
      tell();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        claims -= 1;
        tell();
      };
    },
    claimed: () => claims > 0,
    quiet(stop) {
      quietStop = stop;
      return () => { if (quietStop === stop) quietStop = null; };
    },
    turn,
    subscribe(hear) {
      listeners.add(hear);
      return () => { listeners.delete(hear); };
    }
  };
}

/** The phone's own. */
export const nearbyOwner: NearbyOwner = nearbyOwnerOf();
