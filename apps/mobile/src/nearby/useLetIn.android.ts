import type { JoinPass } from '@langquest-next/core/nearby';
import type { NearbySession } from '@langquest-next/sync/nearby';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { noteChainName } from '../account/useAccount';
import { noteExpected } from '../diagnostics/report';
import type { Ctx } from '../shell/ctx';
import { useAppCovered } from '../shell/useAppCovered';
import { codeShown, LET_IN_CODE_MS, LET_IN_START, letInEndOf, letInReducer, letInRoles, letInWhyNot, type LetInWhyNot } from './letInModel';
import type { PassShape } from './nearbyModel';
import { radiosMayRun } from './nearbyModel';
import { letInWithPass } from './nearbyJoin.android';
import { nearbyRadio } from './nearbyLink.android';
import { nearbyFlag } from './nearbyFlag';
import { androidSdk, checkNearbyPermissions } from './nearbyPermissions.android';
import { permissionsStateOf } from './nearbyPermissionsModel';
import { joinPassFor } from './nearbyPhone.android';
import { useFocus } from './useNearby.android';
import type { LetInHandle } from './useLetIn';

const KEEP_AWAKE = 'nearby-let-in';

/**
 * Let someone in on an Android phone (docs/nearby-sync-plan.md 14.1, 3; 5.8). Nothing runs until
 * the person chooses a role and presses Show the code, which is the press a phone that wears a
 * cover needs. The group, the code and the link run only while `radiosMayRun` holds: a blur, the
 * background or a lock takes the group down and the code away, and only a new press makes a new one.
 * The one tap waits on the person; a No sends nothing. Progress stays in this hook's state.
 */
export function useLetIn(ctx: Ctx): LetInHandle {
  const radio = nearbyRadio();
  const { actorId, readOnly, isLocal } = ctx.session;
  const { orgId, languageId } = ctx.language;
  const { covered, worn } = useAppCovered();
  const [state, dispatch] = useReducer(letInReducer, LET_IN_START);
  const [pass, setPass] = useState<PassShape | null | undefined>(undefined);
  const [permitted, setPermitted] = useState<boolean | undefined>(undefined);
  const [wifiOn, setWifiOn] = useState<boolean | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => {
    joinPassFor(actorId, orgId, languageId).then((p) => setPass(p as PassShape | null)).catch((e: unknown) => { noteExpected('let in: pass', e); setPass(null); });
    checkNearbyPermissions().then((a) => { const s = permissionsStateOf(androidSdk(), a); setPermitted(s === 'granted' || s === 'none'); })
      .catch((e: unknown) => noteExpected('let in: permissions', e));
    radio?.facts().then((f) => setWifiOn(f.wifiOn)).catch((e: unknown) => noteExpected('let in: capabilities', e));
  }, [actorId, orgId, languageId, radio]);
  useEffect(refresh, [refresh]);
  const focused = useFocus(refresh);
  const [onScreen, setOnScreen] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { setOnScreen(s === 'active'); if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  const roles = useMemo(() => letInRoles(pass ?? null, ctx.org.state), [pass, ctx.org.state]);
  const features = nearbyFlag(actorId).features;
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

  // A countdown for the code, ticking only while one is up.
  useEffect(() => {
    if (state.stage.t !== 'showing') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.stage.t]);

  const stop = useCallback(() => {
    attempt.current += 1;
    session.current?.stop();
    answer.current?.(false);
    answer.current = null;
  }, []);

  // The gate closing ends it: the code is gone, and only a new press makes a new one (5.8, Let someone in keeps the same rules).
  useEffect(() => {
    if (running && !mayRun) { stop(); dispatch({ t: 'ended', why: 'stopped' }); }
  }, [running, mayRun, stop]);
  useEffect(() => () => stop(), [stop]);

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
    try {
      const out = await letInWithPass({
        radio, actorId, orgId, languageId, roleId, pass: pass as unknown as JoinPass, org, inspectOrg: () => ctx.org.inspect(),
        language: open, orgClient: ctx.org.client(), codeMs: LET_IN_CODE_MS,
        onSession: (s) => { session.current = s; },
        hooks: {
          showing: (uri, until) => { setNow(Date.now()); dispatch({ t: 'showing', uri, until }); },
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
    newCode: () => { stop(); dispatch({ t: 'new-code' }); }
  }), [show, stop]);

  return useMemo(() => ({
    whyNot, roles, state, code: codeShown(state.stage, now), secondsLeft: state.stage.t === 'showing' ? Math.max(0, Math.ceil((state.stage.until - now) / 1000)) : 0,
    worn, actions
  }), [whyNot, roles, state, now, worn, actions]);
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
