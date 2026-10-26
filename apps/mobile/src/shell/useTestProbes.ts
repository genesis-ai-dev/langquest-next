import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { ScreenId } from './flow';
import { syncActivity } from '../sync/syncActivity';
import { isTestBuild } from '../build/testBuild';
import type { LanguageHandle } from '../sync/useLanguage';
import type { OrgHandle } from '../sync/useOrg';

/**
 * Test builds on the web only (testBuild.ts): what the UI tests reach for
 * (e2e/ui/support.ts) beside the read-only log probe (store.ts). "Sync now"
 * and the sync state; a move the screens never offer, through `go`, so the
 * flow's gates still decide (NAV-051); and opening a passage the way a push
 * does, so a test that only reads a record need not walk through the Map.
 */
export function useTestProbes(o: {
  org: OrgHandle; language: LanguageHandle; languageId: string | null; orgId: string;
  go: (to: ScreenId, params?: Record<string, string>) => void; openTask: (languageId: string, unitId: string) => void;
}) {
  const { org, language, languageId, orgId, go, openTask } = o;
  useEffect(() => {
    if (!(isTestBuild() && Platform.OS === 'web')) return;
    const g = globalThis as { __langquestSyncNow?: () => Promise<void>; __langquestTestState?: () => Promise<unknown> };
    g.__langquestSyncNow = async () => { await org.sync(); if (languageId) { for (let i = 0; i < 10 && (await language.sync()).more; i++) { /* page on */ } } };
    g.__langquestTestState = async () => {
      const [os, ls] = await Promise.all([org.inspect(), language.inspect()]);
      return {
        ...syncActivity(),
        pending: (os?.pending.length ?? 0) + (ls?.pending.length ?? 0),
        rejected: (os?.rejected.length ?? 0) + (ls?.rejected.length ?? 0),
        orgId, languageId
      };
    };
    return () => { delete g.__langquestSyncNow; delete g.__langquestTestState; };
  }, [org, language, languageId, orgId]);
  useEffect(() => {
    if (!(isTestBuild() && Platform.OS === 'web')) return;
    const g = globalThis as { __langquestGo?: typeof go };
    g.__langquestGo = go;
    return () => { delete g.__langquestGo; };
  }, [go]);
  useEffect(() => {
    if (!(isTestBuild() && Platform.OS === 'web')) return;
    const g = globalThis as { __langquestOpenPassage?: typeof openTask };
    g.__langquestOpenPassage = openTask;
    return () => { delete g.__langquestOpenPassage; };
  }, [openTask]);
}
