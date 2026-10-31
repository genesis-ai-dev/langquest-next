// Bible Brain's Bibles that the survey numbered (decision 198), found by what
// is typed in Find your Bible, through the Worker's `numbered` route
// (sources/bibleBrain.ts). Asked a moment after typing stops; the client
// keeps each answer, so a search seen once answers offline. With no Worker,
// or no answer, none: the Bibles in the app still show.
import { useEffect, useState } from 'react';
import type { NumberedBible } from './bibleBrain';
import { bibleBrain } from './store';

const WAIT_MS = 300;

/** The numbered Bibles the Worker found for `q` (two letters or more); none until it answers. */
export function useNumberedBibles(q: string): readonly NumberedBible[] {
  const typed = q.trim();
  const [found, setFound] = useState<{ q: string; bibles: readonly NumberedBible[] }>({ q: '', bibles: [] });
  useEffect(() => {
    const client = bibleBrain;
    if (!client || typed.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      client.numbered(typed).then((bibles) => { if (live) setFound({ q: typed, bibles }); }).catch(() => undefined);
    }, WAIT_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [typed]);
  return found.q === typed ? found.bibles : [];
}
