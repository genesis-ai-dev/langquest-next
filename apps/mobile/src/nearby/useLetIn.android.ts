import type { JoinPass } from '@langquest-next/core/nearby';
import type { NearbySession } from '@langquest-next/sync/nearby';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { noteChainName } from '../account/chainNames';
import { noteExpected } from '../diagnostics/report';
import type { Ctx } from '../shell/ctx';
import { useAppCovered } from '../shell/useAppCovered';
import { takeGiveHandOver } from './giveHandOver';
import { codeShown, LET_IN_START, letInCodeMs, letInEndOf, letInReducer, letInRoles, letInWhyNot, type LetInWhyNot } from './letInModel';
import { letInPermit } from './letInPermitModel';
import type { PassShape } from './nearbyModel';
import { radiosMayRun } from './nearbyModel';
import { letInWithPass } from './nearbyJoin.android';
import { nearbyRadio } from './nearbyLink.native';
import { nearbyFlag } from './nearbyFlag';
import { androidSdk, askingForNearby, askNearbyPermissions, checkNearbyPermissions, openNearbySettings } from './nearbyPermissions.android';
import { afterPrompt, permissionsStateOf, type PermissionAnswers } from './nearbyPermissionsModel';
import { joinPassFor } from './nearbyPhone.native';
import { useFocus } from './useNearby.native';
import { nearbyOwner } from './nearbyOwner';
import { useRadioClaim } from './useRadioClaim';
import type { LetInHandle } from './useLetIn';

const KEEP_AWAKE = 'nearby-let-in';
/** While Give the app's handed group waits for the press: the screen sleeping would send the app to the background and end it. */
const KEEP_AWAKE_HANDED = 'nearby-let-in-handed';

/**
 * Let someone in on an Android phone (docs/nearby-sync-plan.md 14.1, 3; 5.8). Nothing runs until
 * the person chooses a role and presses Show the code, which is the press a phone that wears a
 * cover needs. The group, the code and the link run only while `radiosMayRun` holds: a blur, the
 * background or a lock takes the group down and the code away at once, and only a new press makes
 * a new one. The one tap waits on the person; a No sends nothing. Progress stays in this hook's state.
 *
 * While Give the app serves, the code runs on its group (14.5, `letInWithPass`). When Give the app's
 * Let them in handed its session here (giveHandOver.ts), this screen owns it from opening: leaving
 * before Show the code ends it, and from the press the attempt owns it and ends it with itself.
 */
export function useLetIn(ctx: Ctx): LetInHandle {
  const radio = nearbyRadio();
  const { actorId, readOnly, isLocal } = ctx.session;
  const { orgId, languageId } = ctx.language;
  const { covered, worn } = useAppCovered();
  const [state, dispatch] = useReducer(letInReducer, LET_IN_START);
  const [pass, setPass] = useState<PassShape | null | undefined>(undefined);
  const [answers, setAnswers] = useState<PermissionAnswers | undefined>(undefined);
  const [wifiOn, setWifiOn] = useState<boolean | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => {
    joinPassFor(actorId, orgId, languageId).then((p) => setPass(p as PassShape | null)).catch((e: unknown) => { noteExpected('let in: pass', e); setPass(null); });
    checkNearbyPermissions().then(setAnswers).catch((e: unknown) => noteExpected('let in: permissions', e));
    radio?.facts().then((f) => setWifiOn(f.wifiOn)).catch((e: unknown) => noteExpected('let in: capabilities', e));
  }, [actorId, orgId, languageId, radio]);
  useEffect(refresh, [refresh]);
  const focused = useFocus(refresh);
  // The quiet room of sharing while LangQuest is open steps aside while this screen is open (15.6).
  useRadioClaim(focused);
  const [onScreen, setOnScreen] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      // Android's own question takes the app to the background, which is not leaving (5.8).
      if (s !== 'active' && askingForNearby()) return;
      setOnScreen(s === 'active');
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const roles = useMemo(() => letInRoles(pass ?? null, ctx.org.state), [pass, ctx.org.state]);
  const features = nearbyFlag(actorId).features;
  const sdk = androidSdk();
  const permitted = answers === undefined ? undefined : ['granted', 'none'].includes(permissionsStateOf(sdk, answers));
  // Asked here, as Give the app asks, except on a phone that wears a cover (letInPermit, Carl 2026-11-19).
  const permit = useMemo(() => letInPermit({ sdk, answers, worn }), [sdk, answers, worn]);
  const whyNot = letInWhyNot({
    inBuild: radio !== null, readOnly: readOnly || isLocal, pass, features: features ? features[orgId] ?? [] : null, roles, now, permitted, wifiOn
  });
  // One role: nothing to choose.
  useEffect(() => { if (roles.length === 1 && state.roleId === null) dispatch({ t: 'role', roleId: roles[0]!.roleId }); }, [roles, state.roleId]);

  const running = state.stage.t === 'starting' || state.stage.t === 'showing' || state.stage.t === 'connected' || state.stage.t === 'asked' || state.stage.t === 'copying';
  // The press is Show the code itself: `pressed` holds while it runs.
  const mayRun = radiosMayRun({ focused, onScreen, covered, worn, pressed: running, stopped: false });
  // What the gate says once pressed: asked by every start path after each await.
  const openOnPress = radiosMayRun({ focused, onScreen, covered, worn, pressed: true, stopped: false });
  const gate = useRef(openOnPress);
  gate.current = openOnPress;
  const attempt = useRef(0);
  const session = useRef<NearbySession | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  /** Brings the current attempt's code down at once, rather than at its end. */
  const leaveCode = useRef<(() => void) | null>(null);
  /** Give the app's session, handed to this screen and not yet to an attempt. */
  const heldGive = useRef(false);

  // A countdown for the code, ticking only while one is up.
  useEffect(() => {
    if (state.stage.t !== 'showing') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.stage.t]);

  const stop = useCallback(() => {
    attempt.current += 1;
    leaveCode.current?.();
    leaveCode.current = null;
    session.current?.stop();
    answer.current?.(false);
    answer.current = null;
  }, []);

  // The gate closing ends it: the code is gone, and only a new press makes a new one (5.8, Let someone in keeps the same rules).
  useEffect(() => {
    if (running && !mayRun) { stop(); dispatch({ t: 'ended', why: 'stopped' }); }
  }, [running, mayRun, stop]);
  useEffect(() => () => stop(), [stop]);

  // Give the app's session, when its Let them in handed it here, is this screen's to end if it is left before the press.
  const dropGive = useCallback(() => {
    if (!heldGive.current) return;
    heldGive.current = false;
    deactivateKeepAwake(KEEP_AWAKE_HANDED).catch((e: unknown) => noteExpected('let in: keep awake', e));
    radio?.stopGiveApp().catch((e: unknown) => noteExpected('let in: stop give the app', e));
  }, [radio]);
  // Taken each time the screen comes into view, not only when it mounts: opened from here, Give the
  // app's Let them in goes back to this same screen, still mounted, so its hand-over comes later
  // (review, 2026-11-20).
  useEffect(() => {
    if (!focused || heldGive.current || !takeGiveHandOver()) return;
    heldGive.current = true;
    activateKeepAwakeAsync(KEEP_AWAKE_HANDED).catch((e: unknown) => noteExpected('let in: keep awake', e));
  }, [focused]);
  useEffect(() => { if (!openOnPress) dropGive(); }, [openOnPress, dropGive]);
  useEffect(() => () => dropGive(), [dropGive]);

  const orgState = useRef(ctx.org.state);
  orgState.current = ctx.org.state;
  const show = useCallback(async () => {
    const roleId = state.roleId;
    const open = ctx.language.nearby();
    const org = orgState.current;
    if (!radio || !roleId || !pass || !open || !org || whyNot !== null) return;
    const mine = ++attempt.current;
    const still = () => mine === attempt.current && gate.current;
    if (!gate.current) return;
    dispatch({ t: 'host' });
    activateKeepAwakeAsync(KEEP_AWAKE).catch((e: unknown) => noteExpected('let in: keep awake', e));
    const asked: { who: { profileId: string; name: string } | null } = { who: null };
    // From here the attempt owns a handed-over Give the app session, and ends it with itself.
    const giveHandedOver = heldGive.current;
    heldGive.current = false;
    // The attempt keeps the screen awake from here (KEEP_AWAKE).
    if (giveHandedOver) deactivateKeepAwake(KEEP_AWAKE_HANDED).catch((e: unknown) => noteExpected('let in: keep awake', e));
    let left: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => { left = resolve; });
    leaveCode.current = left;
    try {
      // After the quiet room of sharing while LangQuest is open, which this screen's claim stopped, has stopped (15.6).
      await nearbyOwner.settled();
      if (!still()) return;
      const out = await letInWithPass({
        radio, actorId, orgId, languageId, roleId, pass: pass as unknown as JoinPass, org, inspectOrg: () => ctx.org.inspect(),
        language: open, orgClient: ctx.org.client(), codeMs: letInCodeMs, giveHandedOver, stopped,
        onSession: (s) => { session.current = s; },
        hooks: {
          showing: (uri, until, onGiveGroup) => { setNow(Date.now()); dispatch({ t: 'showing', uri, until, onGiveGroup }); },
          connected: () => dispatch({ t: 'connected' }),
          tap: (who) => new Promise<boolean>((resolve) => {
            asked.who = who;
            answer.current = resolve;
            dispatch({ t: 'asked', name: who.name, pictures: who.pictures });
          }),
          progress: (r) => { if (r.copyServed.parts > 0) dispatch({ t: 'part' }); },
          turnedAway: () => dispatch({ t: 'turned-away' }),
          still
        }
      });
      // The person just let in shows under the name they gave, until the server knows them (14.1, 5).
      if (out.report?.join?.granted && asked.who) void noteChainName(actorId, asked.who.profileId, asked.who.name).catch((x: unknown) => noteExpected('let in: name', x));
      if (mine !== attempt.current) return;
      if (out.why) dispatch({ t: 'ended', why: out.why });
      else if (out.report) dispatch({ t: 'ended', why: letInEndOf(out.report) });
    } catch (e) {
      noteExpected('let in', e);
      if (mine === attempt.current) dispatch({ t: 'ended', why: 'failed' });
    } finally {
      if (leaveCode.current === left) leaveCode.current = null;
      session.current = null;
      answer.current = null;
      deactivateKeepAwake(KEEP_AWAKE).catch((e: unknown) => noteExpected('let in: keep awake', e));
    }
  }, [state.roleId, ctx.language, ctx.org, radio, pass, whyNot, actorId, orgId, languageId]);

  const actions = useMemo(() => ({
    choose: (roleId: string) => dispatch({ t: 'role', roleId }),
    show: () => { void show(); },
    answer: (yes: boolean) => {
      const a = answer.current;
      answer.current = null;
      dispatch({ t: 'answered', yes });
      // A No sends nothing: the session says goodbye and the link closes (14.1, 3).
      a?.(yes);
    },
    newCode: () => { stop(); dispatch({ t: 'new-code' }); },
    // Android's question for what is missing; its answers count at once, and a return from settings reads them again (refresh).
    askPermissions: () => {
      if (permit?.t !== 'explain') return;
      askNearbyPermissions(permit.permissions).then((a) => setAnswers((held) => afterPrompt(held ?? {}, a)))
        .catch((e: unknown) => noteExpected('let in: ask permissions', e));
    },
    openSettings: () => { openNearbySettings().catch((e: unknown) => noteExpected('let in: settings', e)); }
  }), [show, stop, permit]);

  return useMemo(() => ({
    whyNot, roles, state, code: codeShown(state.stage, now), secondsLeft: state.stage.t === 'showing' ? Math.max(0, Math.ceil((state.stage.until - now) / 1000)) : 0,
    worn, permit, actions
  }), [whyNot, roles, state, now, worn, permit, actions]);
}

/** Whether Share nearby offers Let someone in, or why not, from the pass and the flag alone; starts nothing. */
export function useLetInOffered(ctx: Ctx): LetInWhyNot | null {
  const { actorId, readOnly, isLocal } = ctx.session;
  const { orgId, languageId } = ctx.language;
  const [pass, setPass] = useState<PassShape | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    joinPassFor(actorId, orgId, languageId).then((p) => { if (live) setPass(p as PassShape | null); }).catch((e: unknown) => { noteExpected('let in: pass', e); if (live) setPass(null); });
    return () => { live = false; };
  }, [actorId, orgId, languageId]);
  const roles = useMemo(() => letInRoles(pass ?? null, ctx.org.state), [pass, ctx.org.state]);
  const features = nearbyFlag(actorId).features;
  return letInWhyNot({ inBuild: nearbyRadio() !== null, readOnly: readOnly || isLocal, pass, features: features ? features[orgId] ?? [] : null, roles, now: Date.now() });
}
