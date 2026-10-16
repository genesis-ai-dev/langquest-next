// The state of the saved mark (SavedMark.tsx, decision 124): a spinner while
// something is being kept, then a check. A save that takes no time still
// shows the spinner for a moment, so the check reads as "kept", not as a
// mark that was always there.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MIN_SPIN_MS, type SaveStatus } from './savedModel';

/**
 * Follows a busy flag: `saving` while it is on (and for MIN_SPIN_MS at
 * least), then `saved` when there is anything kept, else `idle`.
 */
export function useSaveStatus(busy: boolean, kept: boolean, failed = false): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>(failed ? 'failed' : kept ? 'saved' : 'idle');
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (failed) { setStatus('failed'); return; }
    if (busy) {
      startedAt.current ??= Date.now();
      setStatus('saving');
      return;
    }
    const since = startedAt.current === null ? MIN_SPIN_MS : Date.now() - startedAt.current;
    startedAt.current = null;
    const done = () => setStatus(kept ? 'saved' : 'idle');
    if (since >= MIN_SPIN_MS) { done(); return; }
    const timer = setTimeout(done, MIN_SPIN_MS - since);
    return () => clearTimeout(timer);
  }, [busy, kept, failed]);
  return status;
}

/**
 * For a value that is saved by writing it (a name, a setting): `run` shows
 * the spinner while the write is on its way and the check once it landed.
 */
export function useSaver(): { status: SaveStatus; run: <T>(write: () => Promise<T>) => Promise<T | undefined> } {
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = useCallback(async <T,>(write: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setFailed(false);
    try {
      const out = await write();
      setKept(true);
      return out;
    } catch {
      setFailed(true);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { status: useSaveStatus(busy, kept, failed), run };
}
