import type { NearbyRoom, NearbyRoomEvent, NearbySessionReport } from '@langquest-next/sync/nearby';
import { NavigationContext } from '@react-navigation/native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import type { NativeCapabilities } from '../../modules/nearby-link';
import type { Ctx } from '../shell/ctx';
import { useAppCovered } from '../shell/useAppCovered';
import { currentHoldChoice } from './holdChoice.android';
import { pressHoldChoice } from './nearbyIdentity.android';
import { nearbyRadio } from './nearbyLink.android';
import { holdByDefault, radiosMayRun } from './nearbyModel';
import { androidSdk, askingForNearby, askNearbyPermissions, checkNearbyPermissions, openNearbySettings } from './nearbyPermissions.android';
import {
  afterPrompt, permissionsStateOf, permissionStepOf, radiosOffOf, unavailableReasonOf, type PermissionAnswers
} from './nearbyPermissionsModel';
import { nearbyNamesOf, nearbyOfferedFor, nearbyPiecesFor, nearbyRoomOf } from './nearbyRun.android';
import {
  NEARBY_PROGRESS_MS, NEARBY_RUN_START, NEARBY_TICK_MS, nearbyRunReducer, nearbyViewOf, type NearbyHandle, type NearbyWhyNot
} from './nearbyRunModel';

/**
 * Share nearby on an Android phone (docs/nearby-sync-plan.md 5.8, 5.11, 5.12). It builds the
 * room for the open language from the phone's identity pieces (nearbyRun.android.ts) and runs it
 * only while `radiosMayRun` says so: focused, on screen, not covered, not stopped, and on a phone
 * that wears a cover, pressed. Every start asks the gate again after each await. A `blur` or the
 * background stops it; on a phone with no cover it resumes from the vector, and on one that wears
 * a cover the lock clears the press, so only a new press restarts it. The room's own stops (idle,
 * the run limit, "Up to date" on a worn phone) latch until Look again, reopening the screen, or a
 * press. Keep-awake follows the room, under its own tag. Progress stays in this hook's state,
 * read by Share nearby alone, never in `ctx`. It hands the screen plain data and draws nothing.
 */

const KEEP_AWAKE = 'nearby-share';

/** Whether this screen is the focused one; a `focus` after a `blur` is the screen opened again. */
function useFocus(onReopen: () => void): boolean {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => nav?.isFocused() ?? true);
  const reopen = useRef(onReopen);
  reopen.current = onReopen;
  useEffect(() => {
    if (!nav) return;
    const on = nav.addListener('focus', () => { setFocused(true); reopen.current(); });
    const off = nav.addListener('blur', () => setFocused(false));
    return () => { on(); off(); };
  }, [nav]);
  return focused;
}

export function useNearby(ctx: Ctx): NearbyHandle {
  const radio = nearbyRadio();
  const { language, org } = ctx;
  const { actorId, readOnly } = ctx.session;
  const { orgId, languageId } = language;
  const { covered, worn } = useAppCovered();
  const [run, dispatch] = useReducer(nearbyRunReducer, NEARBY_RUN_START);
  const [facts, setFacts] = useState<NativeCapabilities | null>(null);
  const [answers, setAnswers] = useState<PermissionAnswers>({});
  const [offered, setOffered] = useState<boolean | null>(null);
  const [hold, setHoldShown] = useState(() => currentHoldChoice()?.hold ?? holdByDefault(worn));
  const holding = useSyncExternalStore(language.syncStatus.subscribe, () => language.syncStatus.get().holding);
  const wornRef = useRef(worn);
  wornRef.current = worn;
  const sdk = androidSdk();

  /** What the phone, its permissions and its identity say now: asked on focus and on coming back, never with a prompt. */
  const refresh = useCallback(() => {
    if (!radio) return;
    radio.facts().then(setFacts).catch((e: unknown) => noteExpected('nearby: capabilities', e));
    checkNearbyPermissions().then(setAnswers).catch((e: unknown) => noteExpected('nearby: permissions', e));
    nearbyOfferedFor(actorId, orgId, languageId).then(setOffered).catch((e: unknown) => { noteExpected('nearby: offered', e); setOffered(false); });
    setHoldShown(currentHoldChoice()?.hold ?? holdByDefault(wornRef.current));
  }, [radio, actorId, orgId, languageId]);
  useEffect(refresh, [refresh]);

  const focused = useFocus(useCallback(() => { dispatch({ t: 'reopened', worn: wornRef.current }); refresh(); }, [refresh]));

  // The background stops the radios, but not a permission prompt or the hotspot's join dialog on a phone with no cover (5.8).
  const [onScreen, setOnScreen] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { setOnScreen(true); refresh(); return; }
      if (!wornRef.current && (askingForNearby() || radio?.joiningHotspot())) return;
      setOnScreen(false);
    });
    return () => sub.remove();
  }, [radio, refresh]);

  // A lock clears the press, and a code typed afterwards does not set it again (Carl's answer 15).
  useEffect(() => { if (covered) dispatch({ t: 'covered', worn }); }, [covered, worn]);

  useEffect(() => radio?.onFindError((code) => dispatch({ t: 'find-error', code })), [radio]);

  const whyNot: NearbyWhyNot | null = readOnly ? 'read-only'
    : unavailableReasonOf(facts, radio !== null, sdk) ?? (facts === null || offered === null ? 'loading' : offered ? null : 'no-certificate');
  const radiosOff = useMemo(() => radiosOffOf(facts), [facts]);
  const state = permissionsStateOf(sdk, answers);
  const step = useMemo(
    () => permissionStepOf({ sdk, answers, worn, warned: run.warned, firstPress: !run.warnedOnce }),
    [sdk, answers, worn, run.warned, run.warnedOnce]
  );
  const permissions = useMemo(() => ({ state, step }), [state, step]);

  const mayRun = radiosMayRun({ focused, onScreen, covered, worn, pressed: run.pressed, stopped: run.stopped !== null })
    && whyNot === null && radiosOff.length === 0 && step.t === 'ready' && org.state !== null && language.state !== null;
  const gate = useRef(mayRun);
  gate.current = mayRun;

  const held = useRef<{ room: NearbyRoom; ticker: ReturnType<typeof setInterval> | null } | null>(null);
  const attempt = useRef(0);
  const names = useRef<ReadonlyMap<string, string>>(new Map());
  const lastProgress = useRef(0);

  const release = useCallback((room: NearbyRoom | null) => {
    const h = held.current;
    if (!h || (room && h.room !== room)) return null;
    held.current = null;
    if (h.ticker) clearInterval(h.ticker);
    deactivateKeepAwake(KEEP_AWAKE).catch((e: unknown) => noteExpected('nearby: keep awake', e));
    return h.room;
  }, []);

  const stop = useCallback(async () => {
    attempt.current += 1;
    const room = release(null);
    if (room) await room.stop().catch((e: unknown) => noteExpected('nearby: stop', e));
  }, [release]);

  // Read when a start needs them: the fold and the language's handle change with every revision, which must not restart the radios.
  const orgState = useRef(org.state);
  orgState.current = org.state;
  const inspectOrg = useRef(org.inspect);
  inspectOrg.current = org.inspect;
  const nearbyLanguage = language.nearby;
  const start = useCallback(async () => {
    const mine = ++attempt.current;
    const still = () => mine === attempt.current && gate.current;
    const open = nearbyLanguage();
    const fold = orgState.current;
    if (!radio || !open || !fold || held.current) return;
    try {
      const got = await nearbyPiecesFor({ actorId, orgId, languageId, org: fold, inspectOrg: () => inspectOrg.current() });
      names.current = await nearbyNamesOf(open, orgId);
      if (!still()) return;
      if (!got.ok) {
        dispatch({ t: 'room', report: { t: 'stopped', why: 'no-key' }, worn });
        return;
      }
      let room: NearbyRoom | null = null;
      const report = (e: NearbyRoomEvent) => {
        dispatch({ t: 'room', report: e, worn, names: names.current });
        if (e.t === 'ended') void nearbyNamesOf(open, orgId).then((n) => { names.current = n; }).catch(() => undefined);
        // A stop of its own (idle, the run limit, "Up to date" on a worn phone): nothing more to stop here.
        if (e.t === 'stopped' && room) release(room);
      };
      const progress = (r: Readonly<NearbySessionReport>) => {
        const now = Date.now();
        if (now - lastProgress.current < NEARBY_PROGRESS_MS) return;
        lastProgress.current = now;
        dispatch({ t: 'progress', report: r });
      };
      room = nearbyRoomOf({ radio, pieces: got.pieces, language: open, actorId, orgId, languageId, worn, report, progress });
      held.current = { room, ticker: null };
      await room.start(Date.now());
      if (!still()) {
        // Stopped while it started: `stop` may have found nothing to stop yet, and a stopped room stops again as nothing.
        release(room);
        await room.stop();
        return;
      }
      if (!room.isRunning) { release(room); return; }
      dispatch({ t: 'started' });
      activateKeepAwakeAsync(KEEP_AWAKE).catch((e: unknown) => noteExpected('nearby: keep awake', e));
      const ticking = room;
      held.current.ticker = setInterval(() => { void ticking.tick(Date.now()).catch((e: unknown) => noteExpected('nearby: tick', e)); }, NEARBY_TICK_MS);
    } catch (e) {
      noteExpected('nearby: start', e);
      const room = release(null);
      if (room) await room.stop().catch(() => undefined);
      if (mine === attempt.current) dispatch({ t: 'failed' });
    }
  }, [radio, nearbyLanguage, actorId, orgId, languageId, worn, release]);

  // Runs while the gate is open, and stops when it closes, when the language or person changes, and on leaving.
  useEffect(() => {
    if (!mayRun) return;
    void start();
    return () => { void stop(); };
  }, [mayRun, start, stop]);

  const askPermissions = useCallback(async () => {
    if (step.t !== 'explain') return;
    const got = await askNearbyPermissions(step.permissions);
    // The continuation asks the gate by drawing again with what was granted.
    setAnswers((before) => afterPrompt(before, got));
  }, [step]);

  const actions = useMemo(() => ({
    press: () => dispatch({ t: 'press', worn }),
    lookAgain: () => dispatch({ t: 'look-again', worn }),
    tap: (tag: string) => { held.current?.room.tap(tag); dispatch({ t: 'tapped', tag }); },
    warned: () => dispatch({ t: 'warned' }),
    askPermissions,
    openSettings: openNearbySettings,
    setHold: async (next: boolean) => {
      await pressHoldChoice(next, worn);
      setHoldShown(next);
    }
  }), [worn, askPermissions]);

  const view = useMemo(
    () => nearbyViewOf({ offered: offered === true, whyNot, radiosOff, permissions, worn, run, holding, hold }),
    [offered, whyNot, radiosOff, permissions, worn, run, holding, hold]
  );
  return useMemo(() => ({ view, actions }), [view, actions]);
}

/** For the Sync screen's row: whether to show Share nearby, and why it is disabled (5.8, Carl's answer 7). Starts nothing. */
export function useNearbyOffered(ctx: Ctx): { offered: boolean; whyNot: NearbyWhyNot | null } {
  const radio = nearbyRadio();
  const { actorId, readOnly } = ctx.session;
  const { orgId, languageId } = ctx.language;
  const [facts, setFacts] = useState<NativeCapabilities | null>(null);
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    let live = true;
    radio?.facts().then((f) => { if (live) setFacts(f); }).catch((e: unknown) => noteExpected('nearby: capabilities', e));
    nearbyOfferedFor(actorId, orgId, languageId).then((o) => { if (live) setOffered(o); }).catch((e: unknown) => noteExpected('nearby: offered', e));
    return () => { live = false; };
  }, [radio, actorId, orgId, languageId]);
  const whyNot: NearbyWhyNot | null = readOnly ? 'read-only' : unavailableReasonOf(facts, radio !== null, androidSdk());
  return useMemo(() => ({ offered, whyNot }), [offered, whyNot]);
}
