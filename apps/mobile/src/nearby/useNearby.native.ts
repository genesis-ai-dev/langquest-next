import { languagePeople } from '@langquest-next/core';
import type { NearbyRoom, NearbyRoomEvent, NearbySessionReport } from '@langquest-next/sync/nearby';
import { NavigationContext } from '@react-navigation/native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { noteChainName } from '../account/chainNames';
import { noteExpected } from '../diagnostics/report';
import type { NativeCapabilities } from '../../modules/nearby-link';
import { showsLock } from '../appLock/appLockModel';
import { useAppLock } from '../appLock/useAppLock';
import type { Ctx } from '../shell/ctx';
import { useAppCovered } from '../shell/useAppCovered';
import { currentHoldChoice } from './holdChoice.native';
import { certificateLimited, nearbyOpenOrgs, nearbyOpenSwitch, onNearbyHeld, pressHoldChoice, pressOpenSwitch } from './nearbyIdentity.native';
import { nearbyFlag, onNearbyFlag } from './nearbyFlag';
import { nearbyRowShown } from './nearbyRowModel';
import { nearbyRadio } from './nearbyLink.native';
import { carryFactsOf, type StoredCarryFacts } from './nearbyCarry.native';
import { copySourceOf } from './nearbyCopySource';
import { nearbyBlockedOf } from './nearbyDiagModel';
import { holdByDefault, radiosMayRun } from './nearbyModel';
import { nearbyOwner } from './nearbyOwner';
import { askingForNearby, askNearbyPermissions, checkNearbyPermissions, openNearbySettings, phoneSystem } from './nearbyPermissions';
import {
  afterPrompt, permissionsStateOf, permissionStepOf, radiosOffOf, unavailableReasonOf, type PermissionAnswers
} from './nearbyPermissionsModel';
import { nearbyDiagFor, nearbyNamesOf, nearbyOfferedFor, nearbyPiecesFor, nearbyRoomOf } from './nearbyRun.native';
import {
  NEARBY_PROGRESS_MS, NEARBY_RUN_START, NEARBY_START_MS, NEARBY_TICK_MS, NearbyStartHeld, nearbyRunReducer, nearbyViewOf, startWithin, type NearbyHandle, type NearbyWhyNot
} from './nearbyRunModel';
import { readyToCarryOf, teammatesOf, type CarryTeammate } from './readyToCarryModel';
import { useRadioClaim } from './useRadioClaim';

/**
 * Share nearby on an Android phone or an iPhone (docs/nearby-sync-plan.md 5.8, 5.11, 5.12, and
 * section 7's phase 5). It builds the room for the open language from the phone's identity pieces
 * (nearbyRun.native.ts) and runs it only while `radiosMayRun` says so: focused, on screen, not
 * covered, not stopped, and on a phone that wears a cover, pressed. Every start asks the gate again
 * after each await. A `blur` or the background stops it; on a phone with no cover it resumes from
 * the vector, and on one that wears a cover the lock clears the press, so only a new press restarts
 * it. The room's own stops (idle, the run limit, "Up to date" on a worn phone) latch until Look
 * again, reopening the screen, or a press. Keep-awake follows the room, under its own tag. Progress
 * stays in this hook's state, read by Share nearby alone, never in `ctx`. It hands the screen plain
 * data and draws nothing. The permission rules are the phone's own (nearbyPermissions.android.ts,
 * nearbyPermissions.ios.ts), and only Android serves a newcomer's starting copy (nearbyCopySource).
 * While focused it claims the radios (`useRadioClaim`), which stops the quiet room of sharing while
 * LangQuest is open, and its room starts and stops in `nearbyOwner`'s turn, so the two never run
 * together (15.6). It also shows and sets that mode's switch where the organization has it.
 */

const KEEP_AWAKE = 'nearby-share';

/** Whether this screen is the focused one; a `focus` after a `blur` is the screen opened again. */
export function useFocus(onReopen: () => void): boolean {
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
  const present = useSyncExternalStore(language.syncStatus.subscribe, () => language.syncStatus.get().present);
  const [stored, setStored] = useState<StoredCarryFacts | null>(null);
  const [whileOpen, setWhileOpenShown] = useState<boolean | null>(null);
  const wornRef = useRef(worn);
  wornRef.current = worn;
  const { os, sdk } = phoneSystem();

  /** Ready to carry's facts from the store: on opening, after each session and at "Up to date" (5.8). */
  const nearbyLanguage = language.nearby;
  const readCarry = useCallback(() => {
    const open = nearbyLanguage();
    if (!open) return;
    carryFactsOf(open, orgId, languageId).then(setStored).catch((e: unknown) => noteExpected('nearby: ready to carry', e));
  }, [nearbyLanguage, orgId, languageId]);

  /** What the phone, its permissions and its identity say now: asked on focus and on coming back, never with a prompt. */
  const refresh = useCallback(() => {
    readCarry();
    if (!radio) return;
    radio.facts().then(setFacts).catch((e: unknown) => noteExpected('nearby: capabilities', e));
    checkNearbyPermissions().then(setAnswers).catch((e: unknown) => noteExpected('nearby: permissions', e));
    nearbyOfferedFor(actorId, orgId, languageId).then(setOffered).catch((e: unknown) => { noteExpected('nearby: offered', e); setOffered(false); });
    setHoldShown(currentHoldChoice()?.hold ?? holdByDefault(wornRef.current));
    Promise.all([nearbyOpenOrgs(actorId), nearbyOpenSwitch()])
      .then(([orgs, on]) => setWhileOpenShown(orgs.has(orgId) ? on : null))
      .catch((e: unknown) => noteExpected('nearby: open', e));
  }, [radio, actorId, orgId, languageId, readCarry]);
  useEffect(refresh, [refresh]);

  const focused = useFocus(useCallback(() => { dispatch({ t: 'reopened', worn: wornRef.current }); refresh(); }, [refresh]));
  useRadioClaim(focused);

  // The background stops the radios, but not a permission prompt or the hotspot's join dialog on a phone with no cover (5.8).
  // An iPhone's system prompts (Bluetooth, Local Network, a Wi-Fi join) and Control Center leave the app `inactive`, still on
  // screen; only `background` is leaving. Android never says `inactive`.
  const [onScreen, setOnScreen] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { setOnScreen(true); refresh(); return; }
      if (state === 'inactive') return;
      if (!wornRef.current && (askingForNearby() || radio?.joiningHotspot())) return;
      setOnScreen(false);
    });
    return () => sub.remove();
  }, [radio, refresh]);

  // A lock clears the press, and a code typed afterwards does not set it again (Carl's answer 15).
  useEffect(() => { if (covered) dispatch({ t: 'covered', worn }); }, [covered, worn]);

  const diag = useMemo(() => nearbyDiagFor(orgId, languageId), [orgId, languageId]);
  useEffect(() => radio?.onFindError((code) => {
    dispatch({ t: 'find-error', code });
    diag({ t: { event: 'find', code } });
  }), [radio, diag]);

  const whyNot: NearbyWhyNot | null = readOnly ? 'read-only'
    : unavailableReasonOf(facts, radio !== null, sdk, os) ?? (facts === null || offered === null ? 'loading' : offered ? null : certificateLimited(actorId) ? 'limited' : 'no-certificate');
  const radiosOff = useMemo(() => radiosOffOf(facts, os), [facts, os]);
  const state = permissionsStateOf(sdk, answers, os);
  const step = useMemo(
    () => permissionStepOf({ sdk, os, answers, worn, warned: run.warned, firstPress: !run.warnedOnce }),
    [sdk, os, answers, worn, run.warned, run.warnedOnce]
  );
  // An iPhone's advert goes out alone: one tap covers every teammate it cannot get an echo from (Carl's answer 26).
  const tapCoversAll = facts?.scanResponse === false;
  const permissions = useMemo(() => ({ state, step }), [state, step]);

  // Diagnostics hear once per reason while the screen is open why it cannot run, never who.
  const blocked = nearbyBlockedOf(whyNot, radiosOff, state);
  useEffect(() => { if (blocked) diag({ t: { event: 'blocked', why: blocked } }); }, [blocked, diag]);

  // The app lock stands in front like a cover: a phone left on this screen does not start again behind it (decision 253).
  const locked = showsLock(useAppLock());
  const mayRun = radiosMayRun({ focused, onScreen, covered: covered || locked, worn, pressed: run.pressed, stopped: run.stopped !== null })
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
    if (room) await nearbyOwner.turn(() => room.stop()).catch((e: unknown) => noteExpected('nearby: stop', e));
  }, [release]);

  // Read when a start needs them: the fold and the language's handle change with every revision, which must not restart the radios.
  const orgState = useRef(org.state);
  orgState.current = org.state;
  const inspectOrg = useRef(org.inspect);
  inspectOrg.current = org.inspect;
  const orgClient = useRef(org.client);
  orgClient.current = org.client;
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
        // Someone let in offline, met before the server knows them: their chain names them (14.1, 5).
        if (e.t === 'ended' && e.report.peer?.name) void noteChainName(actorId, e.report.peer.profileId, e.report.peer.name).catch((x: unknown) => noteExpected('nearby: chain name', x));
        if (e.t === 'ended' || e.t === 'level') readCarry();
        // A stop of its own (idle, the run limit, "Up to date" on a worn phone): nothing more to stop here.
        if (e.t === 'stopped' && room) release(room);
      };
      const progress = (r: Readonly<NearbySessionReport>) => {
        const now = Date.now();
        if (now - lastProgress.current < NEARBY_PROGRESS_MS) return;
        lastProgress.current = now;
        dispatch({ t: 'progress', report: r });
      };
      // Any teammate whose read gate passes a newcomer's chain sends a starting copy, on the same versions (14.1, 4): on Android; an iPhone has none.
      const copy = copySourceOf({ actorId, language: open.client, org: orgClient.current() });
      room = nearbyRoomOf({ radio, pieces: got.pieces, language: open, actorId, orgId, languageId, worn, report, progress, copy });
      held.current = { room, ticker: null };
      const starting = room;
      // After the quiet room's stop, which this screen's claim asked for first (15.6).
      await nearbyOwner.turn(async () => {
        if (!still()) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await startWithin(starting.start(Date.now()), new Promise<void>((done) => { timer = setTimeout(done, NEARBY_START_MS); }), () => starting.startingAt);
        } finally {
          clearTimeout(timer);
        }
      });
      if (!still()) {
        // Stopped while it started: `stop` may have found nothing to stop yet, and a stopped room stops again as nothing.
        release(room);
        await nearbyOwner.turn(() => starting.stop());
        return;
      }
      if (!room.isRunning) { release(room); return; }
      dispatch({ t: 'started' });
      activateKeepAwakeAsync(KEEP_AWAKE).catch((e: unknown) => noteExpected('nearby: keep awake', e));
      const ticking = room;
      held.current.ticker = setInterval(() => { void ticking.tick(Date.now()).catch((e: unknown) => noteExpected('nearby: tick', e)); }, NEARBY_TICK_MS);
    } catch (e) {
      noteExpected('nearby: start', e, e instanceof NearbyStartHeld ? e.at : undefined);
      const room = release(null);
      if (room) await nearbyOwner.turn(() => room.stop()).catch(() => undefined);
      if (mine === attempt.current) dispatch({ t: 'failed' });
    }
  }, [radio, nearbyLanguage, actorId, orgId, languageId, worn, release, readCarry]);

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
    // An iPhone says whether Bluetooth is on only once Bluetooth is allowed.
    radio?.facts().then(setFacts).catch((e: unknown) => noteExpected('nearby: capabilities', e));
  }, [step, radio]);

  const actions = useMemo(() => ({
    press: () => dispatch({ t: 'press', worn }),
    lookAgain: () => dispatch({ t: 'look-again', worn }),
    tap: (tag: string) => { held.current?.room.tap(tag); dispatch({ t: 'tapped', tag, all: tapCoversAll }); },
    warned: () => dispatch({ t: 'warned' }),
    askPermissions,
    openSettings: openNearbySettings,
    setHold: async (next: boolean) => {
      await pressHoldChoice(next, worn);
      setHoldShown(next);
    },
    setWhileOpen: async (on: boolean) => {
      await pressOpenSwitch(on);
      setWhileOpenShown(on);
    }
  }), [worn, askPermissions, tapCoversAll]);

  const members = useMemo(() => [...languagePeople(org.state, languageId).keys()], [org.state, languageId]);
  const carry = useMemo(() => readyToCarryOf({
    me: actorId, members, present, inRange: run.teammates.map((t) => t.key), hold,
    noRoom: run.sessions.some((l) => l.noRoom), olderFromServer: run.sessions.some((l) => l.olderFromServer), farAhead: run.farAhead,
    todayStartMs: new Date().setHours(0, 0, 0, 0),
    myKey: stored?.myKey ?? null, names: stored?.names ?? new Map(), vectorKeys: stored?.vectorKeys ?? [], holdings: stored?.holdings ?? new Map(),
    batches: stored?.batches ?? [], pulledUnshared: stored?.pulledUnshared ?? false, lastOnlineMs: stored?.lastOnlineMs ?? null, ...(stored?.onServer ? { onServer: stored.onServer } : {})
  }), [actorId, members, present, run.teammates, hold, run.sessions, run.farAhead, stored]);

  const iphone = os === 'ios';
  const view = useMemo(
    () => nearbyViewOf({ offered: offered === true, iphone, tapCoversAll, whyNot, radiosOff, permissions, worn, run, holding, hold, whileOpen, carry }),
    [offered, iphone, tapCoversAll, whyNot, radiosOff, permissions, worn, run, holding, hold, whileOpen, carry]
  );
  return useMemo(() => ({ view, actions }), [view, actions]);
}

/**
 * For the Sync screen's row: whether to show Share nearby, and why it is disabled (5.8, Carl's
 * answer 7). Shown once the phone holds a certificate and the language's discovery key, and, where
 * the organization has nearby on, disabled with what is missing while it does not (`nearbyRowShown`,
 * 2026-11-19). Checked again whenever the server's flag or what the phone holds may have changed, so
 * a certificate that arrives while Sync is open shows at once. Starts nothing and asks nothing.
 */
export function useNearbyOffered(ctx: Ctx): { offered: boolean; whyNot: NearbyWhyNot | null } {
  const radio = nearbyRadio();
  const { actorId, readOnly } = ctx.session;
  const { orgId, languageId } = ctx.language;
  const [facts, setFacts] = useState<NativeCapabilities | null>(null);
  const [offered, setOffered] = useState(false);
  const [heard, setHeard] = useState(0);
  useEffect(() => {
    const again = () => setHeard((n) => n + 1);
    const offHeld = onNearbyHeld(again);
    const offFlag = onNearbyFlag(again);
    return () => { offHeld(); offFlag(); };
  }, []);
  useEffect(() => {
    let live = true;
    radio?.facts().then((f) => { if (live) setFacts(f); }).catch((e: unknown) => noteExpected('nearby: capabilities', e));
    nearbyOfferedFor(actorId, orgId, languageId).then((o) => { if (live) setOffered(o); }).catch((e: unknown) => noteExpected('nearby: offered', e));
    return () => { live = false; };
  }, [radio, actorId, orgId, languageId, heard]);
  const { os, sdk } = phoneSystem();
  const features = nearbyFlag(actorId).features;
  const row = nearbyRowShown({ offered, orgOn: features ? (features[orgId] ?? []).includes('nearby') : null, limited: certificateLimited(actorId), readOnly });
  const whyNot: NearbyWhyNot | null = readOnly ? 'read-only' : unavailableReasonOf(facts, radio !== null, sdk, os) ?? row.missing;
  return useMemo(() => ({ offered: row.shown, whyNot }), [row.shown, whyNot]);
}

/**
 * Sync and offline's Teammates fold (docs/nearby-sync-plan.md 15.4): each teammate and how recent
 * the newest work held from them is, as Ready to carry says on Share nearby but with no room
 * running. Read from the store when Sync opens and each time it is focused again, so coming back
 * from Share nearby shows what moved; never in `ctx`, so nothing else redraws. Empty until read, and
 * where Share nearby cannot run here (`usable`).
 */
export function useNearbyTeammates(ctx: Ctx, usable: boolean): CarryTeammate[] {
  const { language, org } = ctx;
  const { actorId } = ctx.session;
  const { orgId, languageId } = language;
  const [stored, setStored] = useState<{ languageId: string; facts: StoredCarryFacts } | null>(null);
  const nearbyLanguage = language.nearby;
  const read = useCallback(() => {
    const open = usable ? nearbyLanguage() : null;
    if (!open) return;
    carryFactsOf(open, orgId, languageId).then((facts) => setStored({ languageId, facts })).catch((e: unknown) => noteExpected('nearby: ready to carry', e));
  }, [usable, nearbyLanguage, orgId, languageId]);
  useEffect(read, [read]);
  useFocus(read);
  const members = useMemo(() => [...languagePeople(org.state, languageId).keys()], [org.state, languageId]);
  return useMemo(() => {
    if (!usable || stored?.languageId !== languageId) return [];
    return teammatesOf({ ...stored.facts, me: actorId, members, todayStartMs: new Date().setHours(0, 0, 0, 0) });
  }, [usable, stored, languageId, actorId, members]);
}
