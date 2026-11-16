import type { NearbyRoom, NearbyRoomEvent, NearbySession } from '@langquest-next/sync/nearby';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { heldJoinCode, onJoinCode, takeJoinCode } from '../invites/heldJoinCode';
import type { JoinCode } from '../invites/inviteCode';
import { keepLocalPerson, readLocalPerson } from '../server/localPerson';
import { serverHealth } from '../server/reachability';
import { CHECK_TIMEOUT_MS, isServerAnswer } from '../sync/reachModel';
import { onWake } from '../sync/wake';
import { useAppCovered } from '../shell/useAppCovered';
import { goOnOnline, JOIN_START, joinEndOf, joinName, joinReducer } from './joinOfflineModel';
import { finishUnfinished, joinWithCode, phoneNotEmpty, unfinishedCopy } from './nearbyJoin.android';
import { nearbyRadio } from './nearbyLink.android';
import { radiosMayRun } from './nearbyModel';
import { androidSdk, askingForNearby, askNearbyPermissions, checkNearbyPermissions, openNearbySettings } from './nearbyPermissions.android';
import { missingPermissions, permissionsStateOf } from './nearbyPermissionsModel';
import { nearbyPiecesFor, nearbyRoomOf } from './nearbyRun.android';
import { NEARBY_START_MS, NEARBY_TICK_MS, NearbyStartHeld, startWithin } from './nearbyRunModel';
import { useFocus } from './useNearby.android';
import type { JoinOfflineHandle } from './useJoinOffline';

const KEEP_AWAKE = 'nearby-join';
/** While a copy is left to finish, how often this screen asks whether the server answers, besides on opening and a network change. */
const ONLINE_CHECK_MS = 30_000;
/** A code scanned longer ago than this is past its two minutes on the inviter's phone. */
const CODE_FRESH_MS = 120_000;

/**
 * Joining offline on the newcomer's Android phone (docs/nearby-sync-plan.md 14.1, 3 and 4): the
 * progress screen's work. It checks that the phone has nobody on it, holds the scanned code until
 * the person types their name and presses Join, asks Android for the radios, then joins the
 * inviter's group and asks to be let in, showing the two pictures. Once let in, the starting copy
 * comes, and the person is set only when it is whole. A copy a drop left unfinished is finished
 * from any teammate over Find. Nothing runs while the screen is not focused and on screen.
 */
export function useJoinOffline(): JoinOfflineHandle {
  const radio = nearbyRadio();
  const { covered, worn } = useAppCovered();
  const [stage, dispatch] = useReducer(joinReducer, JOIN_START);
  const [code, setCode] = useState<{ code: JoinCode; at: number } | null>(() => heldJoinCode());
  const [pictures, setPictures] = useState<[number, number] | null>(null);
  useEffect(() => onJoinCode(() => setCode(heldJoinCode())), []);

  const check = useCallback(() => {
    void (async () => {
      const notEmpty = await phoneNotEmpty(worn);
      const held = await readLocalPerson();
      dispatch({ t: 'checked', notEmpty, code: heldJoinCode() !== null, filling: held?.stage === 'filling' });
    })().catch((e: unknown) => { noteExpected('join: check', e); dispatch({ t: 'checked', notEmpty: null, code: false, filling: false }); });
  }, [worn]);
  useEffect(check, [check]);

  const focused = useFocus(() => undefined);
  const [onScreen, setOnScreen] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      // Android's own question takes the app to the background, which is not leaving (5.8).
      if (s !== 'active' && askingForNearby()) return;
      setOnScreen(s === 'active');
    });
    return () => sub.remove();
  }, []);
  const open = radiosMayRun({ focused, onScreen, covered, worn: false, pressed: true, stopped: false });
  const gate = useRef(open);
  gate.current = open;
  const attempt = useRef(0);
  const room = useRef<{ room: NearbyRoom; ticker: ReturnType<typeof setInterval> } | null>(null);
  /** The join's session while it runs: leaving stops it, as it stops the room. */
  const joining = useRef<NearbySession | null>(null);

  const stopRoom = useCallback(async () => {
    const held = room.current;
    room.current = null;
    if (!held) return;
    clearInterval(held.ticker);
    await held.room.stop().catch((e: unknown) => noteExpected('join: stop', e));
  }, []);

  // Leaving ends whatever runs: a link before the grant needs a new code, and a copy goes on from any teammate later.
  useEffect(() => {
    if (open) return;
    attempt.current += 1;
    joining.current?.stop();
    void stopRoom();
    if (stage.t === 'looking') dispatch({ t: 'look-stopped' });
  }, [open, stopRoom, stage.t]);
  useEffect(() => () => { attempt.current += 1; joining.current?.stop(); void stopRoom(); }, [stopRoom]);

  /** Android's radios, asked after the press; true once allowed. */
  const permitted = useCallback(async (): Promise<boolean> => {
    const sdk = androidSdk();
    let answers = await checkNearbyPermissions(sdk);
    let state = permissionsStateOf(sdk, answers);
    if (state === 'needed' || state === 'approximate') {
      answers = { ...answers, ...(await askNearbyPermissions(missingPermissions(sdk, answers))) };
      state = permissionsStateOf(sdk, answers);
    }
    if (state === 'granted' || state === 'none') return true;
    dispatch({ t: 'permission', blocked: state === 'blocked' });
    return false;
  }, []);

  const join = useCallback(async (typed: string) => {
    const name = joinName(typed);
    const held = code;
    if (!radio || !name || !held) return;
    const mine = ++attempt.current;
    const still = () => mine === attempt.current && gate.current;
    dispatch({ t: 'start' });
    setPictures(null);
    activateKeepAwakeAsync(KEEP_AWAKE).catch((e: unknown) => noteExpected('join: keep awake', e));
    try {
      if (!(await permitted()) || !still()) return;
      if (!(await radio.facts()).wifiOn) { dispatch({ t: 'wifi-off' }); return; }
      // One scan starts one join: a No, a drop or an old code needs a new one from the inviter.
      takeJoinCode();
      setCode(null);
      const out = await joinWithCode(radio, held.code, name, worn, {
        pictures: (p) => { setPictures(p); dispatch({ t: 'asked', pictures: p }); },
        granted: () => dispatch({ t: 'granted' }),
        progress: () => dispatch({ t: 'part' }),
        still,
        onSession: (s) => { joining.current = s; }
      });
      setCode(heldJoinCode());
      if (out.why === 'not-empty') { check(); return; }
      if (out.ready) { dispatch({ t: 'copied', whole: true }); return; }
      if (out.report?.join?.granted) { dispatch({ t: 'copied', whole: false }); return; }
      dispatch({ t: 'ended', why: out.report ? joinEndOf(out.report) : out.why === 'stopped' ? 'dropped' : 'failed' });
    } catch (e) {
      noteExpected('join', e);
      if (mine === attempt.current) dispatch({ t: 'ended', why: 'dropped' });
    } finally {
      deactivateKeepAwake(KEEP_AWAKE).catch((e: unknown) => noteExpected('join: keep awake', e));
    }
  }, [radio, code, permitted, worn, check]);

  /** A copy left unfinished: look for any teammate on the same versions, over Find, and finish it (14.1, 3). */
  const look = useCallback(async () => {
    const person = await readLocalPerson();
    if (!radio || !person || person.stage !== 'filling' || room.current) return;
    const mine = ++attempt.current;
    const still = () => mine === attempt.current && gate.current;
    try {
      if (!(await permitted()) || !still()) return;
      if (!(await radio.facts()).wifiOn) { dispatch({ t: 'wifi-off' }); return; }
      const clients = await unfinishedCopy(person);
      if (!clients || !still()) return;
      const got = await nearbyPiecesFor({ actorId: person.profileId, orgId: clients.orgId, languageId: clients.languageId, org: clients.org.getState(), inspectOrg: () => clients.org.inspect() });
      if (!got.ok || !still()) { dispatch({ t: 'look-stopped' }); return; }
      dispatch({ t: 'look' });
      const report = (e: NearbyRoomEvent) => {
        if (e.t === 'ended' && e.report.copyRefused === 'versions') dispatch({ t: 'other-version' });
        if (e.t === 'ended' && e.report.copy?.whole) {
          void finishUnfinished(person, true).then((ready) => { if (ready) dispatch({ t: 'copied', whole: true }); void stopRoom(); });
        }
        if (e.t === 'stopped') { void stopRoom(); dispatch({ t: 'look-stopped' }); }
      };
      const r = nearbyRoomOf({
        radio, pieces: got.pieces, language: clients.language, actorId: person.profileId, orgId: clients.orgId, languageId: clients.languageId, worn: false,
        report, progress: () => undefined, takeCopy: clients.target
      });
      room.current = { room: r, ticker: setInterval(() => { void r.tick(Date.now()).catch((e: unknown) => noteExpected('join: tick', e)); }, NEARBY_TICK_MS) };
      activateKeepAwakeAsync(KEEP_AWAKE).catch((e: unknown) => noteExpected('join: keep awake', e));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await startWithin(r.start(Date.now()), new Promise<void>((done) => { timer = setTimeout(done, NEARBY_START_MS); }), () => r.startingAt);
      } finally {
        clearTimeout(timer);
      }
      if (!still()) await stopRoom();
    } catch (e) {
      noteExpected('join: look', e, e instanceof NearbyStartHeld ? e.at : undefined);
      await stopRoom();
      dispatch({ t: 'look-stopped' });
    }
  }, [radio, permitted, stopRoom]);

  useEffect(() => {
    if (stage.t !== 'looking' && room.current === null) deactivateKeepAwake(KEEP_AWAKE).catch(() => undefined);
  }, [stage.t]);

  // A copy left to finish needs no teammate once the server answers (Carl, 2026-11-09): the person is set, the app
  // starts as them, first contact makes their account, and the server's first download fills in the rest.
  const leftToFinish = stage.t === 'unfinished' || stage.t === 'looking' || stage.t === 'wifi-off';
  useEffect(() => {
    if (!leftToFinish || !open) return;
    let live = true;
    let asking = false;
    const ask = async () => {
      if (asking) return;
      asking = true;
      try {
        if (!isServerAnswer(await serverHealth(CHECK_TIMEOUT_MS)) || !live) return;
        const person = await readLocalPerson();
        const next = person ? goOnOnline(person) : null;
        if (!next || !live) return;
        attempt.current += 1;
        await stopRoom();
        if (await keepLocalPerson(next)) dispatch({ t: 'online' });
      } catch (e) {
        noteExpected('join: online', e);
      } finally {
        asking = false;
      }
    };
    void ask();
    const timer = setInterval(() => { void ask(); }, ONLINE_CHECK_MS);
    const unwake = onWake(() => { void ask(); });
    return () => { live = false; clearInterval(timer); unwake(); };
  }, [leftToFinish, open, stopRoom]);

  const stale = code !== null && Date.now() - code.at > CODE_FRESH_MS;
  const actions = useMemo(() => ({
    join: (name: string) => { void join(name); },
    again: () => { setCode(heldJoinCode()); dispatch({ t: 'again', code: heldJoinCode() !== null }); },
    look: () => { void look(); },
    stopLooking: () => { attempt.current += 1; void stopRoom(); dispatch({ t: 'look-stopped' }); },
    openSettings: openNearbySettings
  }), [join, look, stopRoom]);
  return useMemo(() => ({ stage, pictures, stale, inBuild: radio !== null, actions }), [stage, pictures, stale, radio, actions]);
}
