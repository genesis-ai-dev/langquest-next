// Bible Brain's Bibles in each of some languages, by id, as its list for that
// language has them (the Worker's `bibles` route, sources/bibleBrain.ts): what
// a count beside a language says, so the number is what opens when the
// language is chosen. Bible Brain's language search counts Bibles our key
// cannot open (English 51 where 20 open), so its number is used for order
// only. A few languages are asked at a time, each once a session; the client
// keeps each answer on the phone, so the counts show offline once seen.
import { useEffect, useState } from 'react';
import { bibleBrain } from './store';

const AT_ONCE = 4;
const asked = new Map<string, Promise<string[] | null>>();

function idsIn(code: string): Promise<string[] | null> {
  let ids = asked.get(code);
  if (!ids) {
    // A failure is asked again next time, not remembered.
    ids = bibleBrain!.bibles(code).then((bs) => bs.map((b) => b.bibleId), () => { asked.delete(code); return null; });
    asked.set(code, ids);
  }
  return ids;
}

/** Bible Brain's Bibles by id for each ISO 639-3 code it has answered for; other codes are left out. */
export function useBibleBrainBibles(codes: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const key = [...new Set(codes.map((c) => c.toLowerCase()).filter((c) => /^[a-z]{3}$/.test(c)))].sort().join(',');
  const [found, setFound] = useState<ReadonlyMap<string, readonly string[]>>(() => new Map());
  useEffect(() => {
    if (!bibleBrain || !key) return;
    let live = true;
    const queue = key.split(',');
    const work = async () => {
      while (live) {
        const code = queue.shift();
        if (!code) return;
        const ids = await idsIn(code);
        if (live && ids) setFound((m) => new Map(m).set(code, ids));
      }
    };
    void Promise.all(Array.from({ length: AT_ONCE }, work));
    return () => { live = false; };
  }, [key]);
  return found;
}
