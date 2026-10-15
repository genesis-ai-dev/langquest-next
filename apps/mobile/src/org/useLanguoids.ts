// Searching languoids and naming one (org/languoidPicker.tsx).
import { useEffect, useState } from 'react';
import { languoidHits, type LanguoidHit, type LanguoidRow } from './languoidModel';
import { languoidName, searchLanguoids } from '../server/languages';
import { LANGUOID_RESULTS } from './languoidModel';

export interface LanguoidSearch {
  status: 'idle' | 'searching' | 'found' | 'none' | 'unreachable';
  hits: LanguoidHit[];
  /** What was typed, trimmed: bold where it appears in each match. */
  query: string;
  retry: () => void;
}

/** Searches the list a moment after someone stops typing; nothing under two letters. */
export function useLanguoidSearch(query: string, enabled = true): LanguoidSearch {
  const q = query.trim();
  const [result, setResult] = useState<Omit<LanguoidSearch, 'retry' | 'query'>>({ status: 'idle', hits: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || q.length < 2) {
      setResult({ status: 'idle', hits: [] });
      return;
    }
    let live = true;
    // The last matches stay while the next search runs, so the list does not flicker.
    setResult((r) => ({ status: 'searching', hits: r.hits }));
    const unreachable = () => { if (live) setResult({ status: 'unreachable', hits: [] }); };
    const timer = setTimeout(() => {
      searchLanguoids(q, LANGUOID_RESULTS).then(({ data, error }) => {
        if (!live) return;
        if (error) return unreachable();
        const hits = languoidHits((data ?? []) as LanguoidRow[]);
        setResult({ status: hits.length ? 'found' : 'none', hits });
      }, unreachable);
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q, enabled, attempt]);
  return { ...result, query: q, retry: () => setAttempt((n) => n + 1) };
}

/** A languoid's name, read online; null offline or until it comes. */
export function useLanguoidName(id: string | null): string | null {
  const [name, setName] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    languoidName(id).then(({ data }) => {
      if (live && data?.name) setName({ id, name: data.name as string });
    }, () => undefined);
    return () => { live = false; };
  }, [id]);
  return name && name.id === id ? name.name : null;
}
