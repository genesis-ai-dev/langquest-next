// The part of a sync's status that changes while it works (decisions.md 104):
// counts that tick, the last result, the files here. It is not React state of
// the hook that opens the stream, so a tick redraws only the screens that show
// it (useSyncStatus.ts) and not every mounted screen through `ctx`.
import type { PassageUploads, SentEntry } from '@langquest-next/sync';

/** What changes during a sync or a transfer, for the language that is open. */
export interface LanguageSyncStatus {
  /** Events of this language not yet accepted by the server. */
  pending: number;
  /** The last sync's outcome, for the sync screen. */
  lastSync: string;
  /** Recordings waiting to go up and audio waiting to come down, and the highest each has been since the queue was last empty. */
  pendingUp: number;
  pendingDown: number;
  peakUp: number;
  peakDown: number;
  /** Audio files on this phone now; a new set only when the session publishes (about twice a second at most). */
  present: ReadonlySet<string>;
  /** Recordings waiting to upload by passage, and what this device sent and when (decisions.md 166). */
  uploads: ReadonlyMap<string, PassageUploads>;
  sent: readonly SentEntry[];
  /** Passages with a file going up or coming down this moment: "Uploading" and moving downloads are said only then. */
  uploading: ReadonlySet<string>;
  downloading: ReadonlySet<string>;
}

/** What the screens see: the open language's, and the organization's events not yet sent. */
export interface SyncStatus extends LanguageSyncStatus {
  orgPending: number;
}

const NO_FILES: ReadonlySet<string> = new Set();
const NO_UPLOADS: ReadonlyMap<string, PassageUploads> = new Map();

export const NO_LANGUAGE_STATUS: LanguageSyncStatus = {
  pending: 0, lastSync: 'never', pendingUp: 0, pendingDown: 0, peakUp: 0, peakDown: 0, present: NO_FILES, uploads: NO_UPLOADS, sent: [],
  uploading: NO_FILES, downloading: NO_FILES
};

/** One value that changes, and who wants to hear when it does. */
export class StatusStore<T extends object> {
  private current: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.current = initial;
  }

  /** Stable between changes, as `useSyncExternalStore` requires. */
  readonly get = (): T => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Replace the value, and tell listeners only when a field differs. */
  set(next: T): void {
    const a = this.current as Record<string, unknown>;
    const b = next as Record<string, unknown>;
    let differs = false;
    for (const k of Object.keys(b)) if (a[k] !== b[k]) { differs = true; break; }
    if (!differs) return;
    this.current = next;
    for (const l of [...this.listeners]) l();
  }
}

export type LanguageStatusStore = StatusStore<LanguageSyncStatus>;
export type OrgStatusStore = StatusStore<{ pending: number }>;
