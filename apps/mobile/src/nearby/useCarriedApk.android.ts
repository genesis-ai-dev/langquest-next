import { carriedApkNameHere } from '@langquest-next/core';
import * as DocumentPicker from 'expo-document-picker';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { carriedApkUrl } from '../server/carriedApk';
import { apkOpenedNow, keepApkOpened, loadApkOpened, subscribeApkOpened } from './carriedApkKept';
import { nearbyCodeOf, nearbyLinkNative } from '../../modules/nearby-link';
import { apkCheck, apkStale, chosenName, KEEP_MIN_FREE_BYTES, keepResultOf, keptStale, type ApkCheck, type KeepResult } from './carriedApkModel';
import { keptFileNow, setKeptFile, subscribeKeptFile } from './installFileKept';
import { androidSdk } from './nearbyPermissions.android';
import type { CarriedApkHandle } from './useCarriedApk';

/** What Android's picker offers: install files, and files a card or cable left with no type. */
const APK_TYPES = ['application/vnd.android.package-archive', 'application/octet-stream'];

/**
 * The carried build's install file on an Android phone (docs/nearby-sync-plan.md 14.4). Get opens
 * the Worker's address in the phone's browser, which downloads the file; the app downloads and
 * installs nothing, so `REQUEST_INSTALL_PACKAGES` stays out. The press is remembered by name, so a
 * later version can say the file the person holds is too old. Check my file opens Android's own
 * picker, which needs no permission, and checks the chosen file's name. A right one is then copied
 * into the app's own folder and checked by native to be this app's own (its package and signing
 * certificates), so Give the app can hand it to a new phone over Wi-Fi (14.5); the copy goes once
 * this phone needs other versions. The app still downloads nothing: the person chose the file.
 */
export function useCarriedApk(): CarriedApkHandle {
  const needed = carriedApkNameHere(Updates.runtimeVersion);
  const url = needed ? carriedApkUrl(needed) : null;
  const opened = useSyncExternalStore(subscribeApkOpened, apkOpenedNow);
  const [checked, setChecked] = useState<{ result: ApkCheck; name: string; keep?: KeepResult } | null>(null);
  useEffect(() => { loadApkOpened().catch((e: unknown) => noteExpected('carried apk: read', e)); }, []);
  // An older binary under this update has the module without Give the app's functions, and Give
  // the app needs Android 10: on either, nothing is kept and the screens say what to do instead.
  const native = nearbyLinkNative();
  const canGive = !!native && typeof native.keepInstallFile === 'function' && androidSdk() >= 29;
  const held = useSyncExternalStore(subscribeKeptFile, keptFileNow);
  const kept = canGive ? held : null;
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
      // The right file in hand counts as got: a later version then says it is too old.
      await keepApkOpened(needed);
      if (!canGive || !native) {
        setChecked({ result, name, keep: 'unsupported' });
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
  }, [needed, canGive, native]);

  const actions = useMemo(() => ({ get, check: () => { void check(); } }), [get, check]);
  return useMemo(() => ({ needed, url, opened, stale: apkStale(needed, opened), checked, kept, canGive, actions }), [needed, url, opened, checked, kept, canGive, actions]);
}
