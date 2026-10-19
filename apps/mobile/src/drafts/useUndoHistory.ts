// Undo and Redo's memory (decisions 133 and 134): the changes made to a
// draft (its parts, its guide, its sections), kept on this phone (AsyncStorage, keyed by
// language, person, passage and draft; workspaceModel.ts) so it lasts
// through leaving the screen and the phone closing the app, until the draft
// is published or deleted. It does not sync: it only says which parts were in
// which order with which verses, and every undo is written as new events
// (a back translation's pieces stay on the phone until Done, decision 30).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { noteExpected } from '../diagnostics/report';
import { emptyHistory, type History } from '../ui/undoModel';

/**
 * The history of the draft stored under `key`; null while the draft has no
 * name yet (nothing saved), when the history lives in memory and is stored
 * as soon as it has one. `loaded` is false until the stored one is read.
 */
export function useUndoHistory<S>(key: string | null, parse: (raw: string | null) => History<S>) {
  const [history, setState] = useState<History<S>>(emptyHistory);
  const [loaded, setLoaded] = useState(key === null);
  const current = useRef<History<S>>(emptyHistory);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const keyRef = useRef(key);
  const readKey = useRef<string | null>(null);

  useEffect(() => {
    keyRef.current = key;
    if (!key || readKey.current === key) return;
    readKey.current = key;
    let live = true;
    void AsyncStorage.getItem(key).then((raw) => {
      if (!live) return;
      const stored = parseRef.current(raw);
      // What was done here before the stored history came back (before the draft had a name, or
      // while the read was slow) is kept, after what was stored: read now, not when the read began.
      const unsaved = current.current;
      const merged = unsaved.done.length > 0 || unsaved.undone.length > 0
        ? { done: [...stored.done, ...unsaved.done], undone: unsaved.undone } : stored;
      current.current = merged;
      setState(merged);
      setLoaded(true);
      if (merged !== stored) void AsyncStorage.setItem(key, JSON.stringify(merged)).catch((e: unknown) => noteExpected('undo history: write', e, 'write'));
    }, (e: unknown) => {
      noteExpected('undo history: read', e, 'read');
      if (live) setLoaded(true);
    });
    return () => { live = false; };
  }, [key]);

  /** The new history, shown at once and stored. */
  const set = useCallback((next: History<S> | ((h: History<S>) => History<S>)) => {
    const value = typeof next === 'function' ? next(current.current) : next;
    if (value === current.current) return;
    current.current = value;
    setState(value);
    const k = keyRef.current;
    if (!k) return;
    const write = value.done.length === 0 && value.undone.length === 0 ? AsyncStorage.removeItem(k) : AsyncStorage.setItem(k, JSON.stringify(value));
    void write.catch((e: unknown) => noteExpected('undo history: write', e, 'write'));
  }, []);

  return { history, loaded, set };
}
