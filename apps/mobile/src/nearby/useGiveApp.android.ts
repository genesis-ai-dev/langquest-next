import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { nearbyCodeOf, nearbyLinkNative } from '../../modules/nearby-link';
import { noteExpected } from '../diagnostics/report';
import { currentLanguage, isRtl, t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { useAppCovered } from '../shell/useAppCovered';
import { giveIdle, giveMustHave, givePermissions, giveStage, giveStatusOf, giveTick, handsOver, megabytes, pageHtml, shareOffered, stepAfterJoined, type GiveEnd, type GiveFail, type GiveStatus, type GiveStep, type Giving } from './giveAppModel';
import { giveHandedOver, handGiveOver, takeGiveHandOver } from './giveHandOver';
import type { LetInWhyNot } from './letInModel';
import { radiosMayRun } from './nearbyModel';
import { androidSdk, askingForNearby, askNearbyPermissions, checkNearbyPermissions, openNearbySettings } from './nearbyPermissions.android';
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
 * shows code 1, then code 2 once a phone joins the group or after Next, then what the server
 * counts. The phone stays awake from the press. It runs only while `radiosMayRun` holds, as Share
 * nearby and Let someone in do: a
 * screen pushed over it, the app leaving the screen or a cover coming down stop it. So do Stop,
 * leaving, native stopping it, and GIVE_IDLE_MS with nothing asked and nothing sent. Each Start is
 * an attempt: an answer from an older one is ignored, and any exit after the group formed stops
 * it and lets the screen sleep.
 *
 * Let them in, while the group serves on a build that can host Let someone in on it and on a phone
 * that can let people in (`handsOver`; `letIn` is the screen's `useLetInOffered`), hands the group
 * over instead of stopping it (giveHandOver.ts): the blur and the unmount that follow stop nothing,
 * and from then on this screen only follows native's status, since Let someone in owns the group
 * and stops it. It lets go once the group stops serving, and takes the group back if the carrier
 * comes back to this screen before Let someone in took it. Every other leave stops it as before.
 *
 * Send with Quick Share opens Android's share sheet with the kept file, only while no group runs
 * (the sheet takes the app to the background, which would stop one) and, as every start here,
 * from a press while the gate holds, so never behind a cover. It asks no permission and runs no
 * radio of the app's; on a phone that wears a cover the sheet locks it, as any share sheet does
 * (decision 171).
 */
export function useGiveApp(letIn: LetInWhyNot | null): GiveAppHandle {
  const apk = useCarriedApk();
  const native = nearbyLinkNative();
  const canGive = apk.canGive && !!native;
  const { covered, worn } = useAppCovered();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<GiveStep>('join');
  const [giving, setGiving] = useState<Giving | null>(null);
  const [status, setStatus] = useState<GiveStatus | null>(null);
  const [ended, setEnded] = useState<GiveEnd | null>(null);
  const [failed, setFailed] = useState<GiveFail | null>(null);
  const [shareFailed, setShareFailed] = useState(false);
  const attempt = useRef(0);
  const startedAt = useRef(0);
  const moved = useRef({ sent: 0, at: 0 });
  /** Phones in the group at the last look: one more moves code 1 on to code 2 by itself (`stepAfterJoined`). */
  const seenJoined = useRef(0);
  const sharing = useRef(false);
  const shareable = !!native && typeof native.shareInstallFile === 'function';
  /** The group is Let someone in's now (Let them in handed it over): nothing here stops it. */
  const handed = useRef(false);
  const hostable = !!native && typeof native.hostOnGiveGroup === 'function' && typeof native.setGiveJoin === 'function';

  const focused = useFocus(() => undefined);
  const [onScreen, setOnScreen] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      // Android's own question, asked after Show the first code, takes the app to the background, which is not leaving (5.8).
      if (s !== 'active' && askingForNearby()) return;
      setOnScreen(s === 'active');
    });
    return () => sub.remove();
  }, []);
  const running = busy || giving !== null;
  const mayRun = radiosMayRun({ focused, onScreen, covered, worn, pressed: running, stopped: false });
  const gate = useRef(mayRun);
  gate.current = radiosMayRun({ focused, onScreen, covered, worn, pressed: true, stopped: false });

  /** A status native gave for the current attempt: kept, and a phone that joined since the last look shows code 2. */
  const take = useCallback((s: GiveStatus) => {
    const seen = seenJoined.current;
    seenJoined.current = s.joined;
    setStatus(s);
    setStep((now) => stepAfterJoined({ step: now, seen, joined: s.joined }));
  }, []);

  /**
   * Ends whatever attempt is current: native, keep-awake and the screen's state. `tell` false lets
   * go of a group handed over and already stopped, asking nothing of native.
   */
  const halt = useCallback((why: GiveEnd | null, tell = true) => {
    attempt.current += 1;
    handed.current = false;
    if (tell) native?.stopGiveApp().catch((e: unknown) => noteExpected('give app: stop', e));
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
    setShareFailed(false);
    setStep('join');
    seenJoined.current = 0;
    // A hand-over nobody took is over: this group is Give the app's own.
    takeGiveHandOver();
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
        stepFind: t('nearby.give.page.stepFind', { name: kept.name }),
        stepAllow: t('nearby.give.page.stepAllow'),
        stepInstall: t('nearby.give.page.stepInstall'),
        stepJoin: t('nearby.give.page.stepJoin'),
        join: t('nearby.give.page.join')
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
      const first = giveStatusOf(await native.giveAppStatus());
      if (still()) take(first);
    } catch (e) {
      noteExpected('give app: start', e);
      if (!still()) return;
      const why = failOf(nearbyCodeOf(e));
      halt(null);
      if (why) setFailed(why);
      else setEnded('stopped');
    }
  }, [canGive, native, apk.kept, busy, giving, worn, halt, take]);

  // What the server has done, once a second while it runs; it stops itself when nobody uses it.
  useEffect(() => {
    if (!giving || !native) return undefined;
    const mine = attempt.current;
    const timer = setInterval(() => {
      native.giveAppStatus().then(giveStatusOf).then((s) => {
        if (mine !== attempt.current) return;
        const now = Date.now();
        if (s.sent !== moved.current.sent) moved.current = { sent: s.sent, at: now };
        const idle = giveIdle({ startedMs: startedAt.current, lastAskedMs: s.lastAskedMs, lastMovedMs: moved.current.at, nowMs: now });
        const tick = giveTick({ serving: s.serving, handed: handed.current, idle });
        if (tick === 'ended') halt('phone');
        else if (tick === 'idle') halt('idle');
        else if (tick === 'let-go') {
          // Let someone in stopped the group it was handed: nothing is left to hand over.
          takeGiveHandOver();
          halt('stopped', false);
        } else take(s);
      }).catch((e: unknown) => noteExpected('give app: status', e));
    }, 1000);
    return () => clearInterval(timer);
  }, [giving, native, halt, take]);

  // The gate closing ends it, as on the other nearby screens: a screen over it, the app away, a
  // cover; but not Let someone in opened over it by Let them in, which takes the group over.
  useEffect(() => {
    if (running && !mayRun && !handed.current) halt('stopped');
  }, [running, mayRun, halt]);
  // Leaving the screen ends it, unless the group was handed over: then only the screen may sleep.
  useEffect(() => () => {
    if (handed.current) deactivateKeepAwake(KEEP_AWAKE).catch((e: unknown) => noteExpected('give app: keep awake', e));
    else halt(null);
  }, [halt]);
  // Back on this screen with the hand-over still untaken (Let someone in left without hosting on
  // the group): the group is this screen's own again, with every rule of its own.
  useEffect(() => {
    if (focused && handed.current && giveHandedOver()) {
      takeGiveHandOver();
      handed.current = false;
    }
  }, [focused]);
  // A file kept since (from Get the install file, over this screen) clears "no file".
  useEffect(() => {
    if (apk.kept) setFailed((f) => (f === 'no-file' ? null : f));
  }, [apk.kept]);

  const stage = giveStage({ kept: apk.kept, started: running, step, status: giving ? status : null, ended, failed });
  const canShare = !!apk.kept && shareOffered({ stage, shareable });

  // Android's share sheet with the kept file: what the person picks in it is not known. A file
  // gone from under it is "no file", as at Start; anything else says the sheet did not open.
  const share = useCallback(async () => {
    if (!native || !canShare || sharing.current || !gate.current) return;
    sharing.current = true;
    setShareFailed(false);
    try {
      await native.shareInstallFile();
    } catch (e) {
      noteExpected('give app: share', e);
      if (nearbyCodeOf(e) === 'FILE_UNREADABLE') setFailed('no-file');
      else setShareFailed(true);
    } finally {
      sharing.current = false;
    }
  }, [native, canShare]);

  const serving = giving !== null && status?.serving === true;
  const handing = handsOver({ serving, hostable, letIn });
  const actions = useMemo(() => ({
    start: () => { void start(); },
    next: () => setStep('download'),
    back: () => setStep('join'),
    stop: () => halt('stopped'),
    openSettings: () => { openNearbySettings().catch((e: unknown) => noteExpected('give app: settings', e)); },
    share: () => { void share(); },
    // Let them in: the group goes to Let someone in, which hosts its link on it, or stops as Stop does.
    letIn: () => {
      if (!handing) {
        halt('stopped');
        return;
      }
      handed.current = true;
      handGiveOver();
    }
  }), [start, halt, share, handing]);
  // A build with no native module at all is one an update mends, as one that lacks these functions is.
  const whyNot = canGive ? null : apk.cannotGive ?? 'update';
  return useMemo(() => ({ stage, giving, kept: apk.kept, canGive, cannotGive: whyNot, worn, canShare, shareFailed: canShare && shareFailed, handsOver: handing, actions }),
    [stage, giving, apk.kept, canGive, whyNot, worn, canShare, shareFailed, handing, actions]);
}
