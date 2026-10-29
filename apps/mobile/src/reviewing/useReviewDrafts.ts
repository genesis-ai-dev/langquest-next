// Which checks of a passage this person has a review of kept on this phone and
// not sent (reviewDraft.ts, decision 127), so the passage can say "Continue"
// where the review waits. Read again each time the passage shows.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useState } from 'react';
import { noteExpected } from '../diagnostics/report';
import { draftKey, parseDraft } from '../drafts/draftModel';
import { isReviewDraft } from './reviewDraft';

const NONE: ReadonlySet<string> = new Set();

export function useReviewDrafts(actorId: string | undefined, languageId: string | undefined, unitId: string | undefined, kindIds: readonly string[]): ReadonlySet<string> {
  const nav = useContext(NavigationContext);
  const [kinds, setKinds] = useState<ReadonlySet<string>>(NONE);
  const ids = kindIds.join('\n');
  useEffect(() => {
    if (!actorId || !languageId || !unitId || !ids) { setKinds(NONE); return; }
    let live = true;
    const list = ids.split('\n');
    const read = () => {
      AsyncStorage.multiGet(list.map((k) => draftKey('review', actorId, languageId, unitId, k, 'live')))
        .then((rows) => { if (live) setKinds(new Set(list.filter((_, i) => !!parseDraft(rows[i]?.[1] ?? null, isReviewDraft)))); })
        .catch((e: unknown) => noteExpected('review drafts: read', e));
    };
    read();
    const off = nav?.addListener('focus', read);
    return () => { live = false; off?.(); };
  }, [nav, actorId, languageId, unitId, ids]);
  return kinds;
}
