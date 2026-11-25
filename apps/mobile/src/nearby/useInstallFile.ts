import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { installFileItem, type InstallItem } from './carriedApkModel';
import { useCarriedApk } from './useCarriedApk';
import { useLetInOffered } from './useLetIn';

/**
 * The install file as an item of Sync's Ready for offline list (`installFileItem`,
 * docs/nearby-sync-plan.md 14.4): never got, too old, downloaded but not chosen, or ready; whether
 * this phone keeps a copy of it, which decides what Ready says to do with the file; and whether
 * a newer file than that copy is ready (`keptOutdated`, `keptFromOlderBuild`). Only
 * an Android phone lets someone in, so elsewhere `useLetInOffered` and `useCarriedApk` are their
 * plain stubs and the item is null.
 */
export function useInstallFile(ctx: Ctx): { item: InstallItem | null; keeps: boolean; behind: boolean } {
  const letIn = useLetInOffered(ctx);
  const apk = useCarriedApk();
  return useMemo(() => ({
    item: installFileItem({ letIn, needed: apk.needed, opened: apk.opened, kept: apk.kept, canGive: apk.canGive, right: apk.right }),
    keeps: apk.canGive,
    behind: apk.behind
  }), [letIn, apk.needed, apk.opened, apk.kept, apk.canGive, apk.right, apk.behind]);
}
