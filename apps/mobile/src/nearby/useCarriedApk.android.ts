import { carriedApkNameHere } from '@langquest-next/core';
import * as DocumentPicker from 'expo-document-picker';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { carriedApkUrl } from '../server/carriedApk';
import { apkOpenedNow, apkRightNow, keepApkOpened, keepApkRight, loadApkOpened, loadApkRight, subscribeApkOpened, subscribeApkRight } from './carriedApkKept';
import { nearbyCodeOf, nearbyLinkNative } from '../../modules/nearby-link';
import { apkCheck, apkStale, cannotGive, chosenName, KEEP_MIN_FREE_BYTES, keepResultOf, keptBehind, keptStale, type ApkCheck, type KeepResult } from './carriedApkModel';
import { keptFileNow, setKeptFile, subscribeKeptFile } from './installFileKept';
import { androidSdk } from './nearbyPermissions.android';
import type { CarriedApkHandle } from './useCarriedApk';

/** What Android's picker offers: install files, and files a card or cable left with no type. */
const APK_TYPES = ['application/vnd.android.package-archive', 'application/octet-stream'];

/**
 * The carried build's install file on an Android phone (docs/nearby-sync-plan.md 14.4). Get opens
 * the Worker's address in the phone's browser, which downloads the file; the app downloads and
 * installs nothing, so `REQUEST_INSTALL_PACKAGES` stays out. The press is remembered by name, so a
 * later version can say the file the person holds is too old. Choosing a file opens Android's own
 * picker, which needs no permission, and checks the chosen file's name; a right name is remembered
 * too, apart from the press. A right one is then copied into the app's own folder and checked by
 * native to be this app's own (its package and signing certificates), so Give the app can hand it
 * to a new phone over Wi-Fi (14.5); the copy goes once this phone needs other versions. The app
 * still downloads nothing: the person chose the file.
 */
export function useCarriedApk(): CarriedApkHandle {
  const needed = carriedApkNameHere(Updates.runtimeVersion);
  const url = needed ? carriedApkUrl(needed) : null;
  const opened = useSyncExternalStore(subscribeApkOpened, apkOpenedNow);
  const right = useSyncExternalStore(subscribeApkRight, apkRightNow);
  const [checked, setChecked] = useState<{ result: ApkCheck; name: string; keep?: KeepResult } | null>(null);
  useEffect(() => {
    loadApkOpened().catch((e: unknown) => noteExpected('carried apk: read', e));
    loadApkRight().catch((e: unknown) => noteExpected('carried apk: read right', e));
  }, []);
  // An older binary under this update has the module without Give the app's functions, and Give
  // the app needs Android 10: on either, nothing is kept and the screens say which, and what to do.
  const native = nearbyLinkNative();
  const whyNot = cannotGive({ sdk: androidSdk(), native: !!native && typeof native.keepInstallFile === 'function' });
  const canGive = whyNot === null;
  const held = useSyncExternalStore(subscribeKeptFile, keptFileNow);
  const kept = canGive ? held : null;
  // The kept copy against the app this phone runs (an OTA update's time, or the build's own): a
  // newer file is ready once the copy is two days behind (docs/decisions/2026-11-19-carried-build-refreshed-daily.md).
  const behind = keptBehind(kept, Updates.createdAt?.getTime() ?? null);
  useEffect(() => {
    if (!canGive || !native) return;
    void (async () => {
      try {
        let file = await native.keptInstallFile();
        // Kept until a newer version is needed (Carl's answer, 2026-11-18): then it goes.
        if (keptStale(file, needed)) {
          await native.dropInstallFile();
          file = null;
        }
        setKeptFile(file);
      } catch (e) {
        noteExpected('carried apk: kept', e);
        setKeptFile(null);
      }
    })();
  }, [canGive, native, needed]);

  const get = useCallback(() => {
    if (!needed || !url) return;
    keepApkOpened(needed).catch((e: unknown) => noteExpected('carried apk: keep', e));
    Linking.openURL(url).catch((e: unknown) => noteExpected('carried apk: open', e));
  }, [needed, url]);

  const check = useCallback(async () => {
    if (!needed) return;
    try {
      // Not copied by the picker: native copies a right one itself, into the app's own folder.
      const picked = await DocumentPicker.getDocumentAsync({ type: APK_TYPES, copyToCacheDirectory: false, multiple: false });
      const asset = picked.canceled ? null : picked.assets[0] ?? null;
      const name = asset?.name ?? null;
      if (name === null || !asset) return;
      const result = apkCheck(name, needed);
      if (result !== 'right') {
        setChecked({ result, name });
        return;
      }
      // The right file in hand counts as got: a later version then says it is too old. Its name
      // is remembered as right too, which is all a phone that keeps no copy has to go by.
      await keepApkOpened(needed);
      await keepApkRight(needed);
      if (whyNot !== null || !native) {
        setChecked({ result, name, keep: whyNot === 'android' ? 'needs-android' : 'needs-update' });
        return;
      }
      setChecked({ result, name, keep: 'keeping' });
      try {
        setKeptFile(await native.keepInstallFile(asset.uri, chosenName(name), KEEP_MIN_FREE_BYTES));
        setChecked({ result, name, keep: 'kept' });
      } catch (e) {
        setChecked({ result, name, keep: keepResultOf(nearbyCodeOf(e)) });
      }
    } catch (e) {
      noteExpected('carried apk: check', e);
    }
  }, [needed, whyNot, native]);

  const actions = useMemo(() => ({ get, check: () => { void check(); } }), [get, check]);
  return useMemo(() => ({ needed, url, opened, stale: apkStale(needed, opened), checked, kept, right, canGive, cannotGive: whyNot, behind, actions }),
    [needed, url, opened, checked, kept, right, canGive, whyNot, behind, actions]);
}
