// Every language Bible Brain has Bibles in (the Worker's `languages/all`
// route), for a language list that offers only those: Add a Bible and More
// Bibles. Asked once a session; the client keeps it on the phone for a day,
// so the list works offline once seen. Null until it comes, or when this build
// has no Worker.
import { useEffect, useState } from 'react';
import type { BibleLanguage } from './bibleBrain';
import { bibleBrain } from './store';

let asked: Promise<BibleLanguage[] | null> | null = null;

function all(): Promise<BibleLanguage[] | null> {
  // A failure is asked again next time, not remembered.
  asked ??= bibleBrain!.allLanguages().catch(() => { asked = null; return null; });
  return asked;
}

export function useBibleBrainLanguages(enabled = true): readonly BibleLanguage[] | null {
  const [languages, setLanguages] = useState<readonly BibleLanguage[] | null>(null);
  useEffect(() => {
    if (!enabled || !bibleBrain || languages) return;
    let live = true;
    void all().then((l) => { if (live && l) setLanguages(l); });
    return () => { live = false; };
  }, [enabled, languages]);
  return languages;
}
