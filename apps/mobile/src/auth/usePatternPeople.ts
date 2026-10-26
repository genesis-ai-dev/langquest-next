import { useEffect, useState } from 'react';
import { noteExpected } from '../diagnostics/report';
import { LOCKS_ON_SIGN_OUT, onLocksChanged, patternPeople } from '../server/lock';

/** People signed out of this phone who can come back with a pattern, as their pictures (decisions.md 167); none on the web. */
export function usePatternPeople(): { actorId: string; picture: number }[] {
  const [people, setPeople] = useState<{ actorId: string; picture: number }[]>([]);
  useEffect(() => {
    if (!LOCKS_ON_SIGN_OUT) return;
    let active = true;
    const read = () => { patternPeople().then((p) => { if (active) setPeople(p); }, (e: unknown) => noteExpected('pattern locks', e)); };
    read();
    const off = onLocksChanged(read);
    return () => { active = false; off(); };
  }, []);
  return people;
}
