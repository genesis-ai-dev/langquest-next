import { CARRIED_FILE_TYPE, carriedApkNameHere, carriedFileName } from '@langquest-next/core';
import * as DocumentPicker from 'expo-document-picker';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { carriedApkUrl } from '../server/carriedApk';
import { apkKeptUnderNow, apkOpenedNow, apkRightNow, keepApkKeptUnder, keepApkOpened, keepApkRight, loadApkKeptUnder, loadApkOpened, loadApkRight, subscribeApkKeptUnder, subscribeApkOpened, subscribeApkRight } from './carriedApkKept';
import { nearbyCodeOf, nearbyLinkNative } from '../../modules/nearby-link';
import { builtOnServer } from './carriedApkBuilt';
import { apkCheck, apkStale, cannotGive, chosenName, KEEP_MIN_FREE_BYTES, keepResultOf, keptStale, type ApkCheck, type KeepResult } from './carriedApkModel';
import { keptFileNow, keptFileReadStart, readKeptFile, setKeptFile, subscribeKeptFile } from './installFileKept';
import { keptFromOlderBuild, keptOutdated } from './keptBuildModel';
import { androidSdk } from './nearbyPermissions.android';
import type { CarriedApkHandle } from './useCarriedApk';

/**
 * What Android's picker offers: install files, the app's own type that a browser downloaded the
 * file under for the app (core `CARRIED_FILE_TYPE`), and files a card or cable left with no type.
 */
const APK_TYPES = ['application/vnd.android.package-archive', CARRIED_FILE_TYPE, 'application/octet-stream'];

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
 *
 * On a build that opens the app's own file type (`handOff`: native has `installFileName`, which
 * ships with app.json's filter for it), the browser downloads the same file as `.carried`, under
 * that type, so its own Open hands the file to the app (`take`), which checks and keeps it as one
 * chosen in the picker: no picker, no finding the way back, and no warning that it may be harmful
 * (docs/decisions/0246-a-carried-build-is-the-newcomers.md, amended 2026-11-20). An older build
 * downloads the install file as before, since Open would find nothing to hand it to.
 */
export function useCarriedApk(): CarriedApkHandle {
  const needed = carriedApkNameHere(Updates.runtimeVersion);
  const native = nearbyLinkNative();
  const handOff = !!native && typeof native.installFileName === 'function';
  const url = needed ? carriedApkUrl(handOff ? carriedFileName(needed) ?? needed : needed) : null;
  const opened = useSyncExternalStore(subscribeApkOpened, apkOpenedNow);
  const right = useSyncExternalStore(subscribeApkRight, apkRightNow);
  const keptUnder = useSyncExternalStore(subscribeApkKeptUnder, apkKeptUnderNow);
  const [checked, setChecked] = useState<{ result: ApkCheck; name: string; keep?: KeepResult } | null>(null);
  useEffect(() => {
    loadApkOpened().catch((e: unknown) => noteExpected('carried apk: read', e));
    loadApkRight().catch((e: unknown) => noteExpected('carried apk: read right', e));
    loadApkKeptUnder().catch((e: unknown) => noteExpected('carried apk: read kept under', e));
  }, []);
  // An older binary under this update has the module without Give the app's functions, and Give
  // the app needs Android 10: on either, nothing is kept and the screens say which, and what to do.
  const whyNot = cannotGive({ sdk: androidSdk(), native: !!native && typeof native.keepInstallFile === 'function' });
  const canGive = whyNot === null;
  const held = useSyncExternalStore(subscribeKeptFile, keptFileNow);
  const kept = canGive ? held : null;
  // With a copy kept, the Worker is asked when its file was built (a HEAD request, which fails
  // offline and is asked again on the next screen): a file built after the copy is newer, so it is
  // ready (Carl, 2026-11-25, after a phone keeping the morning's file said nothing of a later one).
  const [serverBuilt, setServerBuilt] = useState<number | null>(null);
  const keptName = kept?.name ?? null;
  useEffect(() => {
    if (!needed || keptName === null) return;
    let live = true;
    builtOnServer(needed).then((ms) => { if (live) setServerBuilt(ms); }, (e: unknown) => noteExpected('carried apk: built on server', e));
    return () => { live = false; };
  }, [needed, keptName]);
  // Without that answer, the copy against the app this phone runs (an OTA update's time, or the
  // build's own): a newer file is ready once the copy is two days behind
  // (docs/decisions/2026-11-19-carried-build-refreshed-daily.md). Or the copy comes from an older
  // native build than this phone runs, which installs an older app (Carl, 2026-11-20).
  const behind = keptOutdated(kept, serverBuilt, Updates.createdAt?.getTime() ?? null) || keptFromOlderBuild(kept, needed, keptUnder);
  // What native keeps, read on opening and again when Download the install file comes back to the
  // front, as from the browser (`reread`). A read that ends after a copy was kept meanwhile, as
  // when the browser's Open hands one over, leaves that copy shown (`readKeptFile`).
  const readKept = useCallback(async () => {
    if (!canGive || !native) return;
    const start = keptFileReadStart();
    try {
      let file = await native.keptInstallFile();
      // Kept until a newer version is needed (Carl's answer, 2026-11-18): then it goes.
      if (keptStale(file, needed)) {
        await native.dropInstallFile();
        file = null;
      }
      readKeptFile(file, start);
    } catch (e) {
      noteExpected('carried apk: kept', e);
      readKeptFile(null, start);
    }
  }, [canGive, native, needed]);
  useEffect(() => { void readKept(); }, [readKept]);

  const get = useCallback(() => {
    if (!needed || !url) return;
    keepApkOpened(needed).catch((e: unknown) => noteExpected('carried apk: keep', e));
    Linking.openURL(url).catch((e: unknown) => noteExpected('carried apk: open', e));
  }, [needed, url]);

  /** A file chosen in the picker or handed over by the browser: its name checked, and a right one kept for Give the app (14.5). */
  const keepChosen = useCallback(async (uri: string, name: string) => {
    if (!needed) return;
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
      setKeptFile(await native.keepInstallFile(uri, chosenName(name), KEEP_MIN_FREE_BYTES));
      // Kept under this build: a copy from an older one is not flagged again (keptFromOlderBuild).
      // Held at once for the screens; a failed write only means it may be flagged once more.
      keepApkKeptUnder(needed).catch((e: unknown) => noteExpected('carried apk: keep kept under', e));
      setChecked({ result, name, keep: 'kept' });
    } catch (e) {
      setChecked({ result, name, keep: keepResultOf(nearbyCodeOf(e)) });
    }
  }, [needed, whyNot, native]);

  const check = useCallback(async () => {
    if (!needed) return;
    try {
      // Not copied by the picker: native copies a right one itself, into the app's own folder.
      const picked = await DocumentPicker.getDocumentAsync({ type: APK_TYPES, copyToCacheDirectory: false, multiple: false });
      const asset = picked.canceled ? null : picked.assets[0] ?? null;
      if (!asset?.name) return;
      await keepChosen(asset.uri, asset.name);
    } catch (e) {
      noteExpected('carried apk: check', e);
    }
  }, [needed, keepChosen]);

  // The browser's Open gives an address with no name in it (content://media/external/downloads/<n>):
  // native asks the provider for it, as the picker does. With none, nothing says which versions it is for.
  const take = useCallback(async (uri: string) => {
    if (!needed || !handOff || !native) return;
    try {
      const name = await native.installFileName(uri);
      if (name) {
        await keepChosen(uri, name);
        return;
      }
    } catch (e) {
      noteExpected('carried apk: take', e);
    }
    setChecked({ result: 'right', name: '', keep: 'unreadable' });
  }, [needed, handOff, native, keepChosen]);

  const actions = useMemo(() => ({ get, check: () => { void check(); }, take: (uri: string) => { void take(uri); }, reread: () => { void readKept(); } }), [get, check, take, readKept]);
  return useMemo(() => ({ needed, url, handOff, opened, stale: apkStale(needed, opened), checked, kept, right, canGive, cannotGive: whyNot, behind, actions }),
    [needed, url, handOff, opened, checked, kept, right, canGive, whyNot, behind, actions]);
}
