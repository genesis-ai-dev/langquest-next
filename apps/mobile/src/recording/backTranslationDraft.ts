// A back translation in progress, kept on this phone (REV-5, decision 30):
// the recorded parts are cards in the blob store that nothing on the record
// names until Save puts them in one `produceContent`. So deleting a part is
// final, and nothing half-made ever reaches the grow-only review. The list
// is in AsyncStorage (keyed by language, person, passage and kind;
// see workspaceModel.ts) so it survives leaving the screen or a restart.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Card } from '@langquest-next/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { reportError } from '../report';
import { parseBackTranslationDraft, withoutPart, withPart, type BackTranslationDraft } from './workspaceModel';

/** A draft that could not be read is never overwritten: writes refuse until it can be. */
class DraftUnreadable extends Error {
  override name = 'DraftUnreadable';
}

export function useBackTranslationDraft(key: string, fromTakeId: string) {
  const [draft, setDraft] = useState<BackTranslationDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState('');
  const current = useRef<BackTranslationDraft | null>(null);
  // Every read and write goes through one chain, starting with the load, so
  // parts that land quickly one after another are all kept, in order.
  const chain = useRef<Promise<unknown> | null>(null);
  const mounted = useRef(true);
  if (!chain.current) {
    chain.current = AsyncStorage.getItem(key).then((raw) => {
      current.current = parseBackTranslationDraft(raw);
      if (mounted.current) { setDraft(current.current); setLoaded(true); }
    }, (e: unknown) => {
      const id = reportError('back translation draft: read', e);
      if (mounted.current) { setProblem(t('recording.backTranslation.draftUnreadable', { code: id })); setLoaded(true); }
      throw new DraftUnreadable('draft unreadable'); // i18n-ignore: an internal error's message, never shown
    });
    chain.current.catch(() => undefined); // reported above; writes see the refusal
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const write = useCallback((change: (d: BackTranslationDraft | null) => BackTranslationDraft | null): Promise<void> => {
    const run = chain.current!.then(async () => {
      const next = change(current.current);
      if (next && next.cards.length > 0) await AsyncStorage.setItem(key, JSON.stringify(next));
      else await AsyncStorage.removeItem(key);
      current.current = next && next.cards.length > 0 ? next : null;
      if (mounted.current) setDraft(current.current);
    });
    // A failed write leaves the chain usable; an unreadable draft keeps refusing.
    chain.current = run.catch((e: unknown) => { if (e instanceof DraftUnreadable) throw e; });
    return run;
  }, [key]);

  return {
    draft,
    loaded,
    /** Set when the stored draft could not be read. */
    problem,
    /** A recorded part; resolves once it is on disk, so the recorder keeps the file until then. */
    add: useCallback((card: Card, at?: number) => write((d) => withPart(d, fromTakeId, card, at)), [write, fromTakeId]),
    remove: useCallback((hash: string) => write((d) => withoutPart(d, hash)), [write]),
    /** After Save: the parts are on the record now. */
    clear: useCallback(() => write(() => null), [write])
  };
}
