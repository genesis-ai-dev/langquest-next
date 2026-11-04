// The work a phone does on a recording's sound before it plays or shows a
// mark (decision 182): its measure (loudnessStore.ts) and its copy at even
// loudness (levelStore.ts), one at a time, as the microphone module does
// them on a thread of its own (Level.kt, Level.swift). A part someone just
// tapped goes ahead of the rest: the next part's copy and the other rows'
// measures wait behind it.

interface Turn {
  key: string;
  job: () => Promise<unknown>;
  done: (value: unknown) => void;
  fail: (e: unknown) => void;
}

const waiting: Turn[] = [];
let busy = false;

/** Runs `job` when its turn comes; `first` puts it ahead of everything waiting. */
export function inTurn<T>(key: string, job: () => Promise<T>, first = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const turn: Turn = { key, job, done: resolve as (value: unknown) => void, fail: reject };
    if (first) waiting.unshift(turn);
    else waiting.push(turn);
    next();
  });
}

/** The work waiting under `key`, if any, goes first. */
export function hurry(key: string): void {
  const i = waiting.findIndex((turn) => turn.key === key);
  if (i > 0) waiting.unshift(...waiting.splice(i, 1));
}

/** What is waiting, in order: for tests. */
export function waitingKeys(): string[] {
  return waiting.map((turn) => turn.key);
}

function next(): void {
  if (busy) return;
  const turn = waiting.shift();
  if (!turn) return;
  busy = true;
  void Promise.resolve().then(turn.job).then(turn.done, turn.fail).finally(() => {
    busy = false;
    next();
  });
}
