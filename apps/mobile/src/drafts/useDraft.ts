// A draft kept on this phone as it changes (draftModel.ts, decision 127).
// The screen holds the value; a moment after each change it is written, and
// the mark in the header turns from a spinner into a check. An empty value
// removes the draft. `clear` drops it when the thing is finished.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../diagnostics/report';
import { hasContent, parseDraft, serializeDraft } from './draftModel';
import type { SaveStatus } from '../ui/savedModel';

const WRITE_AFTER_MS = 400;

export interface Draft<T> {
  value: T;
  set: (next: T | ((prev: T) => T)) => void;
  /** The stored draft has been read (or there was none): until then the screen shows its empty value. */
  loaded: boolean;
  /** When the draft that was opened had been kept, if one was. */
  restoredAt: number | null;
  status: SaveStatus;
  /** Forget it: the thing was finished (or thrown away on purpose). */
  clear: () => Promise<void>;
}

/**
 * `key` null keeps nothing (the screen is not ready to say whose or what).
 * `empty` is the value with nothing in it; `valid` says a stored value is
 * one this screen can read.
 */
export function useDraft<T>(key: string | null, empty: T, valid: (x: unknown) => x is T): Draft<T> {
  const [value, setValue] = useState<T>(empty);
  const [loaded, setLoaded] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const latest = useRef<T>(empty);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyRef = useRef(empty);
  const validRef = useRef(valid);
  validRef.current = valid;

  const write = useCallback(async (k: string, v: T) => {
    try {
      if (hasContent(v)) await AsyncStorage.setItem(k, serializeDraft(v, Date.now()));
      else await AsyncStorage.removeItem(k);
      if (latest.current === v) setStatus(hasContent(v) ? 'saved' : 'idle');
    } catch (e) {
      reportError('draft: write', e);
      setStatus('failed');
    }
  }, []);

  // Read the stored draft whenever the key changes; a change made before it arrives wins.
  useEffect(() => {
    let live = true;
    dirty.current = false;
    setLoaded(false);
    setRestoredAt(null);
    latest.current = emptyRef.current;
    setValue(emptyRef.current);
    setStatus('idle');
    if (!key) { setLoaded(true); return; }
    AsyncStorage.getItem(key).then((raw) => {
      if (!live || dirty.current) return;
      const stored = parseDraft(raw, validRef.current);
      if (stored) {
        latest.current = stored.value;
        setValue(stored.value);
        setRestoredAt(stored.savedAt);
        setStatus('saved');
      }
    }).catch((e: unknown) => { reportError('draft: read', e); })
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [key]);

  // A change is written a moment later; leaving the screen writes what is pending at once.
  const set = useCallback((next: T | ((prev: T) => T)) => {
    const v = typeof next === 'function' ? (next as (p: T) => T)(latest.current) : next;
    latest.current = v;
    dirty.current = true;
    setValue(v);
    if (!key) return;
    setStatus(hasContent(v) ? 'saving' : 'idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void write(key, v); }, WRITE_AFTER_MS);
  }, [key, write]);

  useEffect(() => () => {
    if (timer.current && key) { clearTimeout(timer.current); timer.current = null; void write(key, latest.current); }
  }, [key, write]);

  const clear = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    latest.current = emptyRef.current;
    dirty.current = false;
    setStatus('idle');
    if (key) await AsyncStorage.removeItem(key).catch((e: unknown) => { reportError('draft: clear', e); });
  }, [key]);

  return { value, set, loaded, restoredAt, status, clear };
}
