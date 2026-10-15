/**
 * One tab at a time on the web (decisions.md 58). expo-sqlite keeps its
 * database in a pool of browser files whose handles are exclusive and held
 * for the life of the page, so a second tab cannot open it. The tab that
 * holds a Web Lock owns the database; another tab says so and offers "Use
 * here", which asks the holder over a BroadcastChannel to step aside. The
 * holder reloads into a "moved" page that never opens the database, which
 * frees the pool, and its lock passes to the asking tab. Pure: the browser
 * parts come in as `TabDeps`, so the protocol is tested without one.
 */
export type TabState =
  /** Asking for the lock. */
  | 'checking'
  /** This tab holds the database. */
  | 'ready'
  /** Another tab holds it. */
  | 'elsewhere'
  /** This tab gave it to another. */
  | 'moved'
  /** Asked the holder to step aside; waiting for the lock. */
  | 'waiting';

export interface TabDeps {
  /** `navigator.locks.request`; the callback's promise holds the lock until it settles. */
  request(name: string, opts: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<void>): Promise<void>;
  post(message: string): void;
  listen(handler: (message: string) => void): () => void;
  /** A flag that survives this tab's reload (sessionStorage). */
  movedFlag: { get(): boolean; set(): void; clear(): void };
  reload(): void;
  /** Wait this long (setTimeout); injected so tests need not. */
  wait?(ms: number): Promise<void>;
}

export const LOCK_NAME = 'langquest-database';
const TAKE = 'take';

/**
 * A reloaded page can start before the browser has let go of the lock its
 * own previous page held (seen in Chrome about one reload in ten), and would
 * then say LangQuest is open in another tab when it is not. So a lock that
 * is taken is asked for again for this long before another tab is assumed.
 */
export const RELOAD_SETTLE_MS = 2000;
const RETRY_MS = 250;

export function startTab(deps: TabDeps, onState: (s: TabState) => void): { useHere(): void; stop(): void } {
  let unlisten = () => {};
  let stopped = false;
  /** Lets go of the lock this tab holds (stop). */
  let release = () => {};
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const hold = (): Promise<void> => {
    onState('ready');
    unlisten = deps.listen((message) => {
      if (message !== TAKE) return;
      deps.movedFlag.set();
      deps.reload();
    });
    // Held until the page goes (the file pool is released only then), or until stop.
    return new Promise<void>((resolve) => { release = resolve; });
  };
  const tryHold = async (): Promise<void> => {
    for (let waited = 0; ; waited += RETRY_MS) {
      let got = false;
      await deps.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) return Promise.resolve();
        got = true;
        return hold();
      }).catch(() => undefined);
      // `request` settles only when the lock is let go; holding, it never does.
      if (got || stopped) return;
      if (waited >= RELOAD_SETTLE_MS) { onState('elsewhere'); return; }
      await wait(RETRY_MS);
      if (stopped) return;
    }
  };
  onState('checking');
  if (deps.movedFlag.get()) {
    deps.movedFlag.clear();
    onState('moved');
  } else {
    void tryHold();
  }
  return {
    useHere() {
      onState('waiting');
      deps.post(TAKE);
      void deps.request(LOCK_NAME, {}, () => hold());
    },
    /** Stop listening and let go of the lock, so whatever asks next (this page mounted again, or another tab) gets it. */
    stop() {
      stopped = true;
      unlisten();
      release();
    }
  };
}
