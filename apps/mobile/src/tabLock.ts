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
}

export const LOCK_NAME = 'langquest-database';
const TAKE = 'take';

export function startTab(deps: TabDeps, onState: (s: TabState) => void): { useHere(): void; stop(): void } {
  let unlisten = () => {};
  const hold = (): Promise<void> => {
    onState('ready');
    unlisten = deps.listen((message) => {
      if (message !== TAKE) return;
      deps.movedFlag.set();
      deps.reload();
    });
    // Held until the page goes: the file pool is released only then.
    return new Promise<void>(() => {});
  };
  onState('checking');
  if (deps.movedFlag.get()) {
    deps.movedFlag.clear();
    onState('moved');
  } else {
    void deps.request(LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? hold() : (onState('elsewhere'), Promise.resolve())));
  }
  return {
    useHere() {
      onState('waiting');
      deps.post(TAKE);
      void deps.request(LOCK_NAME, {}, () => hold());
    },
    stop() {
      unlisten();
    }
  };
}
