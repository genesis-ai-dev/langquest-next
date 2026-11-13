import { carriedApkNameHere } from '@langquest-next/core';
import * as DocumentPicker from 'expo-document-picker';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { carriedApkUrl } from '../server/carriedApk';
import { apkOpenedNow, keepApkOpened, loadApkOpened, subscribeApkOpened } from './carriedApkKept';
import { apkCheck, apkStale, type ApkCheck } from './carriedApkModel';
import type { CarriedApkHandle } from './useCarriedApk';

/** What Android's picker offers: install files, and files a card or cable left with no type. */
const APK_TYPES = ['application/vnd.android.package-archive', 'application/octet-stream'];

/**
 * The carried build's install file on an Android phone (docs/nearby-sync-plan.md 14.4). Get opens
 * the Worker's address in the phone's browser, which downloads the file; the app downloads and
 * installs nothing, so `REQUEST_INSTALL_PACKAGES` stays out. The press is remembered by name, so a
 * later version can say the file the person holds is too old. Check my file opens Android's own
 * picker, which needs no permission, and reads only the chosen file's name: no copy, no bytes.
 */
export function useCarriedApk(): CarriedApkHandle {
  const needed = carriedApkNameHere(Updates.runtimeVersion);
  const url = needed ? carriedApkUrl(needed) : null;
  const opened = useSyncExternalStore(subscribeApkOpened, apkOpenedNow);
  const [checked, setChecked] = useState<{ result: ApkCheck; name: string } | null>(null);
  useEffect(() => { loadApkOpened().catch((e: unknown) => noteExpected('carried apk: read', e)); }, []);

  const get = useCallback(() => {
    if (!needed || !url) return;
    keepApkOpened(needed).catch((e: unknown) => noteExpected('carried apk: keep', e));
    Linking.openURL(url).catch((e: unknown) => noteExpected('carried apk: open', e));
  }, [needed, url]);

  const check = useCallback(async () => {
    if (!needed) return;
    try {
      // Not copied: the file is about 100 MB, and only its name is wanted.
      const picked = await DocumentPicker.getDocumentAsync({ type: APK_TYPES, copyToCacheDirectory: false, multiple: false });
      const name = picked.canceled ? null : picked.assets[0]?.name ?? null;
      if (name === null) return;
      const result = apkCheck(name, needed);
      setChecked({ result, name });
      // The right file in hand counts as got: a later version then says it is too old.
      if (result === 'right') await keepApkOpened(needed);
    } catch (e) {
      noteExpected('carried apk: check', e);
    }
  }, [needed]);

  const actions = useMemo(() => ({ get, check: () => { void check(); } }), [get, check]);
  return useMemo(() => ({ needed, url, opened, stale: apkStale(needed, opened), checked, actions }), [needed, url, opened, checked, actions]);
}
