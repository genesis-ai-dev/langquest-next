import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { apkShown, installFileItem, type InstallItem } from './carriedApkModel';
import { useCarriedApk } from './useCarriedApk';
import { useLetInOffered } from './useLetIn';

/**
 * The install file as an item of Sync's Ready for offline list (`installFileItem`,
 * docs/nearby-sync-plan.md 14.4): got, never got or too old, and the name's start this phone
 * needs. Only an Android phone lets someone in, so elsewhere `useLetInOffered` and
 * `useCarriedApk` are their plain stubs and the item is null.
 */
export function useInstallFile(ctx: Ctx): { item: InstallItem | null; shown: string | null } {
  const letIn = useLetInOffered(ctx);
  const apk = useCarriedApk();
  return useMemo(() => ({
    item: installFileItem({ letIn, needed: apk.needed, opened: apk.opened }),
    shown: apk.needed ? apkShown(apk.needed) : null
  }), [letIn, apk.needed, apk.opened]);
}
