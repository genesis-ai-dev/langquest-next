import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { nearbyCodeOf, nearbyLinkNative } from '../../modules/nearby-link';
import { noteExpected } from '../diagnostics/report';
import { currentLanguage, isRtl, t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { useAppCovered } from '../shell/useAppCovered';
import { giveIdle, giveMustHave, givePermissions, giveStage, megabytes, pageHtml, type GiveEnd, type GiveFail, type GiveStatus, type Giving } from './giveAppModel';
import { radiosMayRun } from './nearbyModel';
import { androidSdk, askNearbyPermissions, checkNearbyPermissions, openNearbySettings } from './nearbyPermissions.android';
import { useCarriedApk } from './useCarriedApk';
import type { GiveAppHandle } from './useGiveApp';
import { useFocus } from './useNearby.native';

const KEEP_AWAKE = 'give-app';
/** How long the phone may take to form its Wi-Fi Direct group. */
const START_MS = 30_000;

/** A native rejection's code as why Give the app would not start; null for a stop the person or the gate asked for. */
function failOf(code: string | null): GiveFail | null {
  if (code === 'STOPPED') return null;
  return code === 'WIFI_OFF' ? 'wifi-off' : code === 'NO_PERMISSION' ? 'permission' : code === 'GROUP_BUSY' ? 'busy' : code === 'FILE_UNREADABLE' ? 'no-file' : 'failed';
}

/**
 * Give the app on an Android phone (docs/nearby-sync-plan.md 14.5). Start checks Wi-Fi and the one
 * permission Wi-Fi Direct needs, asking for it after
 * the screen's line (never at launch, and never on a phone wearing a cover, which allows it from
 * Share nearby). Then native forms the group and serves the page and the kept file; the screen
 * shows code 1, then code 2 after Next, then what the server counts. The phone stays awake from
 * the press. It runs only while `radiosMayRun` holds, as Share nearby and Let someone in do: a
 * screen pushed over it, the app leaving the screen or a cover coming down stop it. So do Stop,
 * leaving, native stopping it, and GIVE_IDLE_MS with nothing asked and nothing sent. Each Start is
 * an attempt: an answer from an older one is ignored, and any exit after the group formed stops
 * it and lets the screen sleep.
 */
export function useGiveApp(): GiveAppHandle {
  const apk = useCarriedApk();
  const native = nearbyLinkNative();
  const canGive = apk.canGive && !!native;
  const { covered, worn } = useAppCovered();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'join' | 'download'>('join');
  const [giving, setGiving] = useState<Giving | null>(null);
  const [status, setStatus] = useState<GiveStatus | null>(null);
  const [ended, setEnded] = useState<GiveEnd | null>(null);
  const [failed, setFailed] = useState<GiveFail | null>(null);
  const attempt = useRef(0);
  const startedAt = useRef(0);
  const moved = useRef({ sent: 0, at: 0 });

  const focused = useFocus(() => undefined);
  const [onScreen, setOnScreen] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setOnScreen(s === 'active'));
    return () => sub.remove();
  }, []);
  const running = busy || giving !== null;
  const mayRun = radiosMayRun({ focused, onScreen, covered, worn, pressed: running, stopped: false });
  const gate = useRef(mayRun);
  gate.current = radiosMayRun({ focused, onScreen, covered, worn, pressed: true, stopped: false });

  /** Ends whatever attempt is current: native, keep-awake and the screen's state. */
  const halt = useCallback((why: GiveEnd | null) => {
    attempt.current += 1;
    native?.stopGiveApp().catch((e: unknown) => noteExpected('give app: stop', e));
    deactivateKeepAwake(KEEP_AWAKE).catch((e: unknown) => noteExpected('give app: keep awake', e));
    setBusy(false);
    setGiving(null);
    setStatus(null);
    if (why) setEnded(why);
  }, [native]);

  const start = useCallback(async () => {
    const kept = apk.kept;
    if (!canGive || !native || !kept || busy || giving) return;
    const mine = ++attempt.current;
    const still = () => mine === attempt.current;
    setBusy(true);
    setEnded(null);
    setFailed(null);
    setStep('join');
    const give = (why: GiveFail) => { if (still()) { setFailed(why); setBusy(false); } };
    try {
      const caps = await native.capabilities();
      if (!still()) return;
      if (!caps.wifiOn) return give('wifi-off');
      const sdk = androidSdk();
      // Forming a group needs no Location switch, unlike nearby's Bluetooth scan (AOSP's CREATE_GROUP
      // checks the permission only, security review 2026-11-18), so none is asked for here.
      const must = giveMustHave(sdk);
      const have = await checkNearbyPermissions(sdk);
      if (!still()) return;
      if (must && have[must] !== 'granted') {
        if (worn) return give('permission-covered');
        if (have[must] === 'never_ask_again') return give('blocked');
        const answers = await askNearbyPermissions(givePermissions(sdk).filter((p) => have[p] !== 'granted'));
        if (!still()) return;
        if (answers[must] !== 'granted') return give(answers[must] === 'never_ask_again' ? 'blocked' : 'permission');
      }
      // The screen stays awake from here: a phone that sleeps while the group forms goes to the background, and native stops.
      activateKeepAwakeAsync(KEEP_AWAKE).catch((e: unknown) => noteExpected('give app: keep awake', e));
      const page = pageHtml({
        lang: currentLanguage(),
        dir: isRtl() ? 'rtl' : 'ltr',
        title: t('nearby.give.page.title'),
        size: t('nearby.give.page.size', { size: formatNumber(megabytes(kept.size)) }),
        download: t('nearby.give.page.download'),
        stepOpen: t('nearby.give.page.stepOpen'),
        stepAllow: t('nearby.give.page.stepAllow'),
        stepInstall: t('nearby.give.page.stepInstall')
      }, kept.name);
      startedAt.current = Date.now();
      moved.current = { sent: 0, at: 0 };
      const g = await native.startGiveApp(page, START_MS);
      if (!still()) {
        // Stopped or left while the group formed.
        native.stopGiveApp().catch((e: unknown) => noteExpected('give app: stop', e));
        return;
      }
      setGiving(g);
      setBusy(false);
      const first = await native.giveAppStatus();
      if (still()) setStatus(first);
    } catch (e) {
      noteExpected('give app: start', e);
      if (!still()) return;
      const why = failOf(nearbyCodeOf(e));
      halt(null);
      if (why) setFailed(why);
      else setEnded('stopped');
    }
  }, [canGive, native, apk.kept, busy, giving, worn, halt]);

  // What the server has done, once a second while it runs; it stops itself when nobody uses it.
  useEffect(() => {
    if (!giving || !native) return undefined;
    const mine = attempt.current;
    const timer = setInterval(() => {
      native.giveAppStatus().then((s) => {
        if (mine !== attempt.current) return;
        const now = Date.now();
        if (s.sent !== moved.current.sent) moved.current = { sent: s.sent, at: now };
        if (!s.serving) halt('phone');
        else if (giveIdle({ startedMs: startedAt.current, lastAskedMs: s.lastAskedMs, lastMovedMs: moved.current.at, nowMs: now })) halt('idle');
        else setStatus(s);
      }).catch((e: unknown) => noteExpected('give app: status', e));
    }, 1000);
    return () => clearInterval(timer);
  }, [giving, native, halt]);

  // The gate closing ends it, as on the other nearby screens: a screen over it, the app away, a cover.
  useEffect(() => {
    if (running && !mayRun) halt('stopped');
  }, [running, mayRun, halt]);
  // Leaving the screen ends it.
  useEffect(() => () => halt(null), [halt]);
  // A file kept since (from Get the install file, over this screen) clears "no file".
  useEffect(() => {
    if (apk.kept) setFailed((f) => (f === 'no-file' ? null : f));
  }, [apk.kept]);

  const actions = useMemo(() => ({
    start: () => { void start(); },
    next: () => setStep('download'),
    back: () => setStep('join'),
    stop: () => halt('stopped'),
    openSettings: () => { openNearbySettings().catch((e: unknown) => noteExpected('give app: settings', e)); }
  }), [start, halt]);
  const stage = giveStage({ kept: apk.kept, started: running, step, status: giving ? status : null, ended, failed });
  // A build with no native module at all is one an update mends, as one that lacks these functions is.
  const whyNot = canGive ? null : apk.cannotGive ?? 'update';
  return useMemo(() => ({ stage, giving, kept: apk.kept, canGive, cannotGive: whyNot, worn, actions }), [stage, giving, apk.kept, canGive, whyNot, worn, actions]);
}
