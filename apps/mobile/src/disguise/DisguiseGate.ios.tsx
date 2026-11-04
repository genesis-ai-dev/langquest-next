import { useEffect, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { CODE_KEY, LOOK_KEY, NOTES_KEY } from './disguiseKeys';

/**
 * An iPhone wears no disguise (decisions.md 171, amended 2026-11-03): Apple
 * refused build 48 for its icons (App Review Guideline 2.5.19), so an iPhone
 * build has none of it, and DisguiseGate.tsx is Android's. An iPhone that wore
 * one on an older build opens on LangQuest, and what that build kept is
 * cleared, so a later build that brings the disguise back does not put it on
 * by itself.
 */
export function DisguiseGate(props: { children: ReactNode }) {
  useEffect(() => { forgetDisguise(); }, []);
  return <>{props.children}</>;
}

function forgetDisguise(): void {
  try {
    Storage.removeItemSync(LOOK_KEY);
    Storage.removeItemSync(NOTES_KEY);
  } catch { /* nothing was kept */ }
  void SecureStore.deleteItemAsync(CODE_KEY).catch(() => undefined);
}
