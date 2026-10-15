// Which sources are offered and which one this person chose (sources/SourceReader.tsx).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { filesetsFor, sourceUsed } from './model';
import type { Usage } from './useUsage';
import { useSources, type PassageSources } from './useSources';

export const choices = new Map<string, string>();

/** The version chosen last for this language on this phone, shared by the recorder, the study and the review. */
export function useChoice(key: string): [string | null, (itemId: string) => void] {
  const [chosen, setChosen] = useState<string | null>(choices.get(key) ?? null);
  useEffect(() => {
    if (choices.has(key)) return;
    void AsyncStorage.getItem(key).then((v) => { if (v) { choices.set(key, v); setChosen(v); } }).catch(() => undefined);
  }, [key]);
  return [chosen, (itemId: string) => {
    choices.set(key, itemId);
    setChosen(itemId);
    void AsyncStorage.setItem(key, itemId).catch(() => undefined);
  }];
}

/** Put every source offered for this passage in the screen's record of what was used. */
export function useOffer(usage: Usage | undefined, passage: PassageSources): void {
  useEffect(() => {
    if (!usage || !passage.range) return;
    usage.offer(passage.options.map((o) => {
      const f = filesetsFor(o, passage.range!.book);
      return sourceUsed(o, { ref: passage.ref, opened: false, filesets: [f.text, f.audio].filter((x): x is string => !!x) });
    }));
  }, [usage, passage.options, passage.range, passage.ref]);
}

/**
 * Offer the passage's sources to the record without showing them: for a
 * screen where the reader sits behind a disclosure (the reviewer's
 * Background), so what was offered is recorded whether or not it was opened.
 */
export function useOfferedSources(ctx: Ctx, unitId: string | undefined, languageId: string | undefined, usage: Usage | undefined): void {
  const passage = useSources(ctx, unitId, languageId);
  useOffer(usage, passage);
}
