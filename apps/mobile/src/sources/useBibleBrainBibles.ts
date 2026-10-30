// Bible Brain's Bibles in each of some languages, by id, as its list for that
// language has them (the Worker's `bibles` route, sources/bibleBrain.ts): what
// a count beside a language says, so the number is what opens when the
// language is chosen. Bible Brain's language search counts Bibles our key
// cannot open (English 51 where 20 open), so its number is used for order
// only. A few languages are asked at a time, each once a session; the client
// keeps each answer on the phone, so the counts show offline once seen.
import { useEffect, useMemo, useState } from 'react';
import type { BibleSummary } from './bibleBrain';
import { bibleBrain } from './store';

const AT_ONCE = 4;
const asked = new Map<string, Promise<BibleSummary[] | null>>();

function biblesIn(code: string): Promise<BibleSummary[] | null> {
  let bibles = asked.get(code);
  if (!bibles) {
    // A failure is asked again next time, not remembered.
    bibles = bibleBrain!.bibles(code).catch(() => { asked.delete(code); return null; });
    asked.set(code, bibles);
  }
  return bibles;
}

/** Bible Brain's Bibles for each ISO 639-3 code it has answered for; other codes are left out. */
function useBibleBrainLists(codes: readonly string[]): ReadonlyMap<string, readonly BibleSummary[]> {
  const key = [...new Set(codes.map((c) => c.toLowerCase()).filter((c) => /^[a-z]{3}$/.test(c)))].sort().join(',');
  const [found, setFound] = useState<ReadonlyMap<string, readonly BibleSummary[]>>(() => new Map());
  useEffect(() => {
    if (!bibleBrain || !key) return;
    let live = true;
    const queue = key.split(',');
    const work = async () => {
      while (live) {
        const code = queue.shift();
        if (!code) return;
        const bibles = await biblesIn(code);
        if (live && bibles) setFound((m) => new Map(m).set(code, bibles));
      }
    };
    void Promise.all(Array.from({ length: AT_ONCE }, work));
    return () => { live = false; };
  }, [key]);
  return found;
}

/** Bible Brain's Bibles by id for each ISO 639-3 code it has answered for; other codes are left out. */
export function useBibleBrainBibles(codes: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const lists = useBibleBrainLists(codes);
  return useMemo(() => new Map([...lists].map(([code, bibles]) => [code, bibles.map((b) => b.bibleId)])), [lists]);
}

/** Bible Brain's Bibles in these languages, in the order asked, as far as it has answered (New language's step 4, LAN-194). */
export function useBibleBrainSummaries(codes: readonly string[]): readonly BibleSummary[] {
  const lists = useBibleBrainLists(codes);
  return useMemo(() => codes.flatMap((c) => lists.get(c.toLowerCase()) ?? []), [codes.join(','), lists]); // eslint-disable-line react-hooks/exhaustive-deps -- the codes by value
}
