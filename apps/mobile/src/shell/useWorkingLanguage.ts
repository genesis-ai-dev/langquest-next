import AsyncStorage from '@react-native-async-storage/async-storage';
import { orgLanguages, type OrgState } from '@langquest-next/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { openLanguage } from './languages';

/**
 * The language this person works in (MAP-7), and so the stream open:
 * the one a screen names, else the one remembered per account and
 * organization on this device, else the organization's first.
 */
export function useWorkingLanguage(org: OrgState | null, actorId: string, orgId: string, paramLanguage: string | undefined) {
  const languageKey = `language:${actorId}:${orgId}`;
  const [savedLanguage, setSavedLanguage] = useState<string | null>(null);
  useEffect(() => { AsyncStorage.getItem(languageKey).then(setSavedLanguage).catch(() => {}); }, [languageKey]);
  const setLanguage = useCallback((id: string) => { setSavedLanguage(id); AsyncStorage.setItem(languageKey, id).catch(() => {}); }, [languageKey]);
  const languageId = useMemo(() => openLanguage(org, actorId, { param: paramLanguage, saved: savedLanguage }),
    [org, actorId, paramLanguage, savedLanguage]);
  // A screen about a language makes it the one this person works in.
  useEffect(() => { if (languageId && languageId === paramLanguage && languageId !== savedLanguage) setLanguage(languageId); }, [languageId, paramLanguage, savedLanguage, setLanguage]);
  const languages = useMemo(() => orgLanguages(org), [org]);
  return { languageId, setLanguage, languages };
}
