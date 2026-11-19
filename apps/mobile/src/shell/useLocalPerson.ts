import { useEffect, useState } from 'react';
import { localPersonNow, onLocalPerson, readLocalPerson, type LocalPerson } from '../server/localPerson';
import { reportError } from '../diagnostics/report';

/**
 * The local person of joining offline (docs/nearby-sync-plan.md 14.1, 5), read beside the saved
 * sign-in: undefined until read, then null or the record, and every change after. Only an
 * Android phone ever has one (server/localPerson.android.ts).
 */
export function useLocalPerson(): LocalPerson | null | undefined {
  const [person, setPerson] = useState<LocalPerson | null | undefined>(() => localPersonNow());
  useEffect(() => {
    let active = true;
    const off = onLocalPerson((p) => { if (active) setPerson(p); });
    readLocalPerson().then((p) => { if (active) setPerson(p); }, (e: unknown) => { reportError('local person', e); if (active) setPerson(null); });
    return () => { active = false; off(); };
  }, []);
  return person;
}
