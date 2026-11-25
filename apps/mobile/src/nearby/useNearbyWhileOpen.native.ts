import type { NearbyRoom, NearbyRoomEvent } from '@langquest-next/sync/nearby';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { NativeCapabilities } from '../../modules/nearby-link';
import { noteChainNames } from '../account/chainNames';
import { showsLock } from '../appLock/appLockModel';
import { useAppLock } from '../appLock/useAppLock';
import { anythingPlaying, subscribeNowPlaying } from '../audio/nowPlaying';
import { noteExpected } from '../diagnostics/report';
import { isRecording, onRecordingChange } from '../recording/recorderState';
import { wornNow } from '../shell/appCovered';
import type { Ctx } from '../shell/ctx';
import { useAppCovered } from '../shell/useAppCovered';
import { getStore } from '../storage/store';
import { isOffline } from '../sync/uploadsModel';
import { nearbyOpenOrgs, nearbyOpenSwitch, onNearbyHeld } from './nearbyIdentity.native';
import { nearbyRadio } from './nearbyLink.native';
import { openMayRun, type OpenGate } from './nearbyModel';
import { openHeldOf, OpenWaitTally, type OpenHeld, type OpenPiecesWhy, type OpenRest } from './openWaitModel';
import { nearbyOwner } from './nearbyOwner';
import { checkNearbyPermissions, phoneSystem } from './nearbyPermissions';
import { permissionsStateOf, radiosOffOf, type PermissionAnswers, type PermissionsState, type RadioOff } from './nearbyPermissionsModel';
import { nearbyLibraryOf } from './nearbyLibrary.native';
import { copySourceOf } from './nearbyCopySource';
import { roomCopyTargetFor } from './nearbyCopyTarget.native';
import { nearbyDiagFor, nearbyPiecesFor, nearbyRoomOf } from './nearbyRun.native';
import { NEARBY_OPEN_FRESH_MS, NEARBY_OPEN_REST_MS, NEARBY_START_MS, NEARBY_TICK_MS, NearbyStartHeld, startWithin, turnedAwayUnwelcome } from './nearbyRunModel';
import type { WhileOpenFacts } from './shareNearbyModel';
import { useFocus, useNearbyOffered } from './useNearby.native';

/**
 * Sharing while LangQuest is open (docs/nearby-sync-plan.md 15.6, phase 10): the room for the open
 * language, run quietly by itself while `openMayRun` says so. Mounted once, beside the screens
 * (shell/NearbyWhileOpen.native.tsx), only where it may be wanted at all: the organization has
 * `nearby_open`, the switch is on, the phone wears no cover and the language is offline
 * (`useWhileOpenWanted`). It never asks for a permission, never keeps the screen awake, offers no
 * tap and touches no hotspot (`nearbyRoomOf` with `mode: 'open'`). A screen that runs the radios
 * claims them (`nearbyOwner`), which stops this room first; every start and stop goes through the
 * owner's turn, so two rooms never run at once. At "Up to date" its radios run three minutes of
 * every four (`NEARBY_OPEN_PAUSE`), and it never stops while there is anything to swap. After
 * turning away a phone whose chain did not check, a stop of the room's own or a radio error, it
 * rests a minute (`NEARBY_OPEN_REST_MS`), kept per language so a remount does not end it. It never runs behind the app lock, Hello takes
 * only a teammate whose certificate is recent (`NEARBY_OPEN_FRESH_MS`) or whom this phone met on Share
 * nearby within that long (`nearbyMet`, noted only there), and a room stopped because a
 * cover went on writes no diagnostics record, which would date it (the security review of
 * 2026-11-23). It draws nothing and shows no name: Sync and offline's row says that it is on,
 * that it runs, or that Share nearby says what it needs (`useWhileOpenRow`), and the Teammates
 * fold says what moved. A wait of a minute or more with the app in front, no room running and no
 * screen owning the radios writes one diagnostics record as it ends, naming what held it and why
 * each rest began (`openWaitModel`, 2026-11-25).
 */

// ---- whether it runs now, for Sync and offline ---------------------------------------------

let runningNow = false;
const runningListeners = new Set<() => void>();

function setRunningNow(on: boolean): void {
  if (runningNow === on) return;
  runningNow = on;
  for (const hear of runningListeners) hear();
}

function onRunningNow(hear: () => void): () => void {
  runningListeners.add(hear);
  return () => { runningListeners.delete(hear); };
}

/** The quiet room runs now: a line on Sync and offline, never a name. */
function useWhileOpenNow(): boolean {
  return useSyncExternalStore(onRunningNow, () => runningNow);
}

// ---- rests, per language, so a remount (a moment online, a language switch) does not end one ----

const restsUntil = new Map<string, number>();
const restKey = (orgId: string, languageId: string) => `${orgId}/${languageId}`;

// ---- what it reads --------------------------------------------------------------------------

function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

const busyNow = () => isRecording() || anythingPlaying();
/** How long the phone is quiet after playing or recording before a held room finds again (review P2). */
const NEARBY_AUDIO_QUIET_MS = 15_000;
function onBusy(hear: () => void): () => void {
  const offRecording = onRecordingChange(hear);
  const offPlaying = subscribeNowPlaying(hear);
  return () => { offRecording(); offPlaying(); };
}

/** Be told when what the phone keeps for nearby sync may have changed: the flag as last heard, or the switch. */
function useHeld(): number {
  const [heard, setHeard] = useState(0);
  useEffect(() => onNearbyHeld(() => setHeard((n) => n + 1)), []);
  return heard;
}

/**
 * Whether the quiet mode is on for this person here, from what costs nothing to read: the
 * organization's `nearby_open` as the phone last heard it, the switch and no cover. Read again
 * when the switch or the kept organizations change, and when the language goes on or offline.
 */
function useWhileOpenOn(ctx: Ctx): boolean {
  const { actorId, readOnly } = ctx.session;
  const { orgId } = ctx.language;
  const { worn } = useAppCovered();
  const offline = isOffline(ctx.language.online);
  const held = useHeld();
  const [kept, setKept] = useState<{ actorId: string; orgs: ReadonlySet<string>; on: boolean } | null>(null);
  useEffect(() => {
    if (!actorId || readOnly || nearbyRadio() === null) return;
    let live = true;
    Promise.all([nearbyOpenOrgs(actorId), nearbyOpenSwitch()])
      .then(([orgs, on]) => { if (live) setKept({ actorId, orgs, on }); })
      .catch((e: unknown) => noteExpected('nearby: open', e));
    return () => { live = false; };
  }, [actorId, readOnly, held, offline]);
  return !!kept && kept.actorId === actorId && !readOnly && kept.on && kept.orgs.has(orgId) && !worn;
}

/**
 * Whether the quiet mode may be wanted here at all: on (`useWhileOpenOn`) and the language
 * offline. Only then does the room's own hook read the radios and permissions.
 */
export function useWhileOpenWanted(ctx: Ctx): boolean {
  return useWhileOpenOn(ctx) && isOffline(ctx.language.online);
}

/**
 * What Sync and offline's Share nearby row says of the quiet mode (`nearbyRowWords`): `null`
 * where it is not on for this person here, else whether its room runs now and what of the phone
 * would keep it from running, its permissions and radios. Read without a prompt where the row can
 * run (`usable`), and again on coming back to Sync or to the front, where the person may have
 * allowed or turned something on.
 */
export function useWhileOpenRow(ctx: Ctx, usable: boolean): WhileOpenFacts | null {
  const radio = nearbyRadio();
  const on = useWhileOpenOn(ctx) && usable;
  const running = useWhileOpenNow();
  const offline = isOffline(ctx.language.online);
  const active = useAppActive();
  const [read, setRead] = useState<{ permissions: PermissionsState; radiosOff: RadioOff[] } | null>(null);
  const load = useCallback(() => {
    if (!radio || !on || !active) return;
    const { os, sdk } = phoneSystem();
    Promise.all([checkNearbyPermissions(), radio.facts()])
      .then(([answers, facts]) => setRead({ permissions: permissionsStateOf(sdk, answers, os), radiosOff: radiosOffOf(facts, os) }))
      .catch((e: unknown) => noteExpected('nearby: open row', e));
  }, [radio, on, active]);
  useEffect(load, [load, offline]);
  useFocus(load);
  if (!on) return null;
  return { running, offline, permissions: read?.permissions ?? null, radiosOff: read?.radiosOff ?? null };
}

/**
 * A phone with a cover keeps no day it met a teammate on Share nearby (`nearbyMet`, decision 230
 * as amended): the mode that reads them never runs under one, and they say who was together and
 * when. They go the moment a cover is on, and at every start while it is.
 */
export function useNoMetUnderCover(): void {
  const { worn } = useAppCovered();
  useEffect(() => {
    if (!worn) return;
    getStore().then((store) => store.clearMeta('nearbyMet:')).catch((e: unknown) => noteExpected('nearby: met under cover', e));
  }, [worn]);
}

// ---- the room ---------------------------------------------------------------------------------

export function useNearbyWhileOpen(ctx: Ctx): void {
  const radio = nearbyRadio();
  const { language, org } = ctx;
  const { actorId } = ctx.session;
  const { orgId, languageId } = language;
  const { worn } = useAppCovered();
  const { offered, whyNot } = useNearbyOffered(ctx);
  const active = useAppActive();
  const offline = isOffline(language.online);
  const busy = useSyncExternalStore(onBusy, busyNow);
  const recording = useSyncExternalStore(onRecordingChange, isRecording);
  const screenOpen = useSyncExternalStore(nearbyOwner.subscribe, nearbyOwner.claimed);
  // The app lock stands in front of every screen and keeps them running: the mode waits behind it (decision 253).
  const locked = showsLock(useAppLock());
  const held = useHeld();
  const [kept, setKept] = useState<{ orgs: ReadonlySet<string>; on: boolean } | null>(null);
  const [answers, setAnswers] = useState<PermissionAnswers | null>(null);
  const [facts, setFacts] = useState<NativeCapabilities | null>(null);
  const resting = restKey(orgId, languageId);
  const restingKey = useRef(resting);
  restingKey.current = resting;
  const [restUntil, setRestUntil] = useState(() => restsUntil.get(resting) ?? 0);
  useEffect(() => { setRestUntil(restsUntil.get(resting) ?? 0); }, [resting]);
  const { os, sdk } = phoneSystem();

  // Read again on coming to the front and after a nearby screen closes, where the person may have granted or turned something on.
  useEffect(() => {
    if (!radio || !active || screenOpen) return;
    let live = true;
    Promise.all([nearbyOpenOrgs(actorId), nearbyOpenSwitch()])
      .then(([orgs, on]) => { if (live) setKept({ orgs, on }); })
      .catch((e: unknown) => noteExpected('nearby: open', e));
    checkNearbyPermissions().then((a) => { if (live) setAnswers(a); }).catch((e: unknown) => noteExpected('nearby: permissions', e));
    radio.facts().then((f) => { if (live) setFacts(f); }).catch((e: unknown) => noteExpected('nearby: capabilities', e));
    return () => { live = false; };
  }, [radio, actorId, active, screenOpen, held]);

  // A rest ends by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (restUntil <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), restUntil - now);
    return () => clearTimeout(timer);
  }, [restUntil, now]);
  // Why the mode waited (2026-11-25): told of each rest's cause, and of what holds the room below.
  const waits = useRef(new OpenWaitTally());
  const rest = useCallback((cause: OpenRest, why?: OpenPiecesWhy) => {
    waits.current.rest(cause, why);
    const at = Date.now();
    restsUntil.set(resting, at + NEARBY_OPEN_REST_MS);
    setRestUntil(at + NEARBY_OPEN_REST_MS);
    setNow(at);
  }, [resting]);

  const state = answers ? permissionsStateOf(sdk, answers, os) : null;
  const holding = useRef<{ room: NearbyRoom; ticker: ReturnType<typeof setInterval> | null; forget: () => void } | null>(null);
  const inputs: OpenGate = {
    feature: !!kept?.orgs.has(orgId), switchOn: !!kept?.on, granted: state === 'granted' || state === 'none',
    // Audio keeps a room from starting; one already running is held instead (below), not stopped (review P2).
    radiosOn: facts !== null && radiosOffOf(facts, os).length === 0, offered: offered && whyNot === null, worn, locked, active, offline, busy: busy && !holding.current, screenOpen,
    resting: restUntil > now, ready: org.state !== null && language.state !== null
  };
  const mayRun = openMayRun(inputs);
  const gate = useRef(mayRun);
  gate.current = mayRun;

  // A wait of a minute or more with the app in front and the radios its own writes one record as it ends (`openWaitModel`):
  // a phone let in offline shared nothing for 21 minutes and nothing said why (2026-11-25).
  const running = useWhileOpenNow();
  const waitHeld = openHeldOf(inputs, running)?.join(',') ?? null;
  useEffect(() => {
    const record = waits.current.note(Date.now(), waitHeld === null ? null : (waitHeld.split(',') as OpenHeld[]));
    if (record) nearbyDiagFor(orgId, languageId)(record);
  }, [waitHeld, orgId, languageId]);
  // Leaving ends a wait, and so does another language. One a cover ended writes nothing: the record would date the cover.
  useEffect(() => () => {
    if (wornNow()) { waits.current.drop(); return; }
    const record = waits.current.note(Date.now(), null);
    if (record) nearbyDiagFor(orgId, languageId)(record);
  }, [orgId, languageId]);

  const attempt = useRef(0);

  const stop = useCallback(async () => {
    attempt.current += 1;
    const h = holding.current;
    holding.current = null;
    setRunningNow(false);
    if (!h) return;
    h.forget();
    if (h.ticker) clearInterval(h.ticker);
    // A stop because a rest began says so in the room's record (decision 235 as amended).
    const why = (restsUntil.get(restingKey.current) ?? 0) > Date.now() ? 'rest' : 'asked';
    await nearbyOwner.turn(() => h.room.stop(why)).catch((e: unknown) => noteExpected('nearby: open stop', e));
  }, []);

  // A radio's error stops this room and rests, only while it is the one running.
  useEffect(() => radio?.onFindError(() => {
    if (!holding.current) return;
    rest('radio');
  }), [radio, rest]);

  // Read when a start needs them: the folds and the language's handle change with every revision, which must not restart the radios.
  const orgState = useRef(org.state);
  orgState.current = org.state;
  const inspectOrg = useRef(org.inspect);
  inspectOrg.current = org.inspect;
  const orgClient = useRef(org.client);
  orgClient.current = org.client;
  const nearbyLanguage = language.nearby;
  const start = useCallback(async () => {
    const mine = ++attempt.current;
    const still = () => mine === attempt.current && gate.current && !nearbyOwner.claimed();
    const open = nearbyLanguage();
    const fold = orgState.current;
    if (!radio || !open || !fold || holding.current) return;
    try {
      const got = await nearbyPiecesFor({ actorId, orgId, languageId, org: fold, inspectOrg: () => inspectOrg.current() });
      // A person let in offline whose copy is missing, short or lost to an update takes one quietly too (2026-11-24, review items 6, 26).
      const takeCopy = await roomCopyTargetFor({ actorId, orgId, languageId, language: open.client, org: orgClient.current() });
      if (!still()) return;
      if (!got.ok) { rest('pieces', got.why); return; }
      let room: NearbyRoom | null = null;
      const report = (e: NearbyRoomEvent) => {
        // Someone let in offline, met before the server knows them: their chain names them (14.1, 5).
        // And whoever else a checked chain named, on a batch or a holdings entry this phone took (review item 12).
        if (e.t === 'ended' && (e.report.peer?.name || e.report.names.length > 0)) {
          const named = [...(e.report.peer?.name ? [{ profileId: e.report.peer.profileId, name: e.report.peer.name }] : []), ...e.report.names];
          void noteChainNames(actorId, named).catch((x: unknown) => noteExpected('nearby: chain name', x));
        }
        // A phone whose chain did not check: nothing more from the air for a while (15.8). A teammate whose window ran out is only passed over.
        if (e.t === 'ended' && turnedAwayUnwelcome(e.report)) rest('unwelcome');
        // A stop of its own (waiting too long, no key): it rests rather than start again at once.
        if (e.t === 'stopped' && e.why !== 'asked' && e.why !== 'rest' && room && holding.current?.room === room) rest('stopped');
      };
      // A starting copy, to a teammate let in offline whose copy is short or lost (review items 6, 26): only an Android
      // phone gives one, and only to a phone that asks.
      const copy = copySourceOf({ actorId, language: open.client, org: orgClient.current() });
      room = nearbyRoomOf({
        radio, pieces: got.pieces, language: open, actorId, orgId, languageId, worn: false, mode: 'open', report, progress: () => undefined,
        freshWithinMs: NEARBY_OPEN_FRESH_MS, silent: wornNow,
        // The library documents the language uses go between teammates here too (14.1, 2026-11-24).
        library: nearbyLibraryOf({ language: open.client, org: () => orgState.current }),
        ...(copy ? { copy } : {}), ...(takeCopy ? { takeCopy: takeCopy.target } : {})
      });
      const starting = room;
      const held = { room, ticker: null as ReturnType<typeof setInterval> | null, forget: () => undefined as void };
      holding.current = held;
      const started = await nearbyOwner.turn(async () => {
        // A screen may have claimed the radios while this waited its turn.
        if (!still()) return false;
        held.forget = nearbyOwner.quiet(() => starting.stop());
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await startWithin(starting.start(Date.now()), new Promise<void>((done) => { timer = setTimeout(done, NEARBY_START_MS); }), () => starting.startingAt);
        } finally {
          clearTimeout(timer);
        }
        return true;
      });
      if (!started || !still() || holding.current !== held) {
        if (holding.current === held) holding.current = null;
        held.forget();
        await nearbyOwner.turn(() => starting.stop());
        return;
      }
      if (!starting.isRunning) { holding.current = null; held.forget(); return; }
      setRunningNow(true);
      held.ticker = setInterval(() => { void starting.tick(Date.now()).catch((e: unknown) => noteExpected('nearby: open tick', e)); }, NEARBY_TICK_MS);
    } catch (e) {
      noteExpected('nearby: open start', e, e instanceof NearbyStartHeld ? e.at : undefined);
      const failed = mine === attempt.current;
      await stop();
      if (failed) rest('start');
    }
  }, [radio, nearbyLanguage, actorId, orgId, languageId, rest, stop]);

  // Runs while the gate is open, and stops when it closes, when the language or person changes, and on leaving.
  useEffect(() => {
    if (!mayRun) return;
    void start();
    return () => { void stop(); };
  }, [mayRun, start, stop]);

  // Playing or recording holds a running room rather than stopping it, and recording cuts its session; after a quiet
  // spell it finds again (2026-11-24 review, P2). A reviewer plays clip after clip: each used to stop the room, cut its
  // session and write a diagnostic, and build it all again after.
  useEffect(() => {
    const room = holding.current?.room;
    if (!room) return;
    if (busy) {
      void room.hold(recording).catch((e: unknown) => noteExpected('nearby: open hold', e));
      return;
    }
    if (!room.held) return;
    const timer = setTimeout(() => { void room.release().catch((e: unknown) => noteExpected('nearby: open hold', e)); }, NEARBY_AUDIO_QUIET_MS);
    return () => clearTimeout(timer);
  }, [busy, recording]);
}
