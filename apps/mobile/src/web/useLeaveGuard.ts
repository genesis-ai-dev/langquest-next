// Warn before leaving the page while work is unsaved (web/storageGate.tsx).
import { useEffect } from 'react';
import { Platform } from 'react-native';

const WEB = Platform.OS === 'web';

/**
 * Web: say so before the tab closes while this session still has work to
 * send. Nothing is lost (it waits in this browser), but nobody else gets it
 * until LangQuest opens here again.
 */
export function useLeaveGuard(unsent: boolean): void {
  useEffect(() => {
    if (!WEB || !unsent) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsent]);
}
