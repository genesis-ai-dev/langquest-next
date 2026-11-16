import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, BackHandler, StyleSheet, View } from 'react-native';
import { ChosenPicture, PatternPad } from '../auth/patternPad';
import { failureMessage, noteExpected } from '../diagnostics/report';
import { t } from '../i18n';
import { ModalCoverContext } from '../ui/coverContext';
import { openBackStep } from '../ui/hardwareBack';
import { GhostBtn, LinkBtn, PrimaryBtn } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { leftApp, ownPicture, setActor, signOutFromLock, tryPattern } from './appLock';
import { showsLock } from './appLockModel';
import { PadMessage } from './PadMessage';
import { useAppLock } from './useAppLock';

/**
 * The app lock in front of the whole app (decisions.md 253). Someone who
 * turned it on draws their own sign-in pattern, under their picture, each
 * time the app opens, and each time they come back to it. The app goes on
 * under it (sync too), and comes back as it was left. Every modal draws
 * the lock as well (ModalCoverContext), since a modal sits above this
 * view; a disguise's cover, when Android has one, stays on top of it.
 * `actorId`: who is signed in, null for nobody, undefined until known.
 */
export function AppLockGate(props: { actorId: string | null | undefined; children: ReactNode }) {
  const lock = useAppLock();
  const shows = showsLock(lock);
  useEffect(() => { if (props.actorId !== undefined) setActor(props.actorId); }, [props.actorId]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') leftApp();
    });
    return () => sub.remove();
  }, []);
  const Outer = useContext(ModalCoverContext);
  const cover = useMemo(() => function Covers() {
    return <><LockInModal />{Outer ? <Outer /> : null}</>;
  }, [Outer]);
  return (
    <ModalCoverContext.Provider value={cover}>
      <View style={styles.fill} accessibilityElementsHidden={shows} importantForAccessibility={shows ? 'no-hide-descendants' : 'auto'}>
        {props.children}
      </View>
      {shows && typeof lock.actorId === 'string' ? <LockFace actorId={lock.actorId} /> : null}
    </ModalCoverContext.Provider>
  );
}

/** The lock inside a modal (kit's Sheet and the rest), while it stands. */
function LockInModal() {
  const lock = useAppLock();
  return showsLock(lock) && typeof lock.actorId === 'string' ? <LockFace actorId={lock.actorId} /> : null;
}

/** Their picture, the nine dots, and Forgot?, which signs out. No words but what a try needs. */
function LockFace(props: { actorId: string }) {
  const [picture, setPicture] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [padKey, setPadKey] = useState(0);
  const [until, setUntil] = useState(0);
  const [forgot, setForgot] = useState(false);
  const now = useNow(until);
  const waiting = until > now;
  useEffect(() => {
    let active = true;
    ownPicture(props.actorId).then((p) => { if (active) setPicture(p); }, (e: unknown) => noteExpected('app lock: picture', e));
    return () => { active = false; };
  }, [props.actorId]);
  // Android's Back leaves the app from here, never reaching a screen behind the lock. Newest step open (decision 137).
  useEffect(() => openBackStep({ showing: () => true, run: () => BackHandler.exitApp() }), []);
  async function drew(dots: number[]) {
    setBusy(true);
    setError('');
    try {
      const result = await tryPattern(dots);
      if (result.kind === 'ok') return;
      if (result.kind === 'wait') setUntil(Date.now() + result.ms);
      else setError(t('entry.lock.wrong'));
    } catch (e) {
      setError(failureMessage('app lock', e));
    } finally {
      setBusy(false);
      setPadKey((k) => k + 1);
    }
  }
  async function signOut() {
    setBusy(true);
    setError('');
    try { await signOutFromLock(); } catch (e) { setError(failureMessage('app lock: sign out', e)); setBusy(false); }
  }
  return (
    // The only thing a screen reader reaches while it shows, inside a modal too.
    <View style={[StyleSheet.absoluteFill, styles.face]} accessibilityViewIsModal testID="app-lock">
      <View style={styles.column}>
        {picture !== null ? <ChosenPicture picture={picture} /> : null}
        {forgot ? (
          <>
            <Text style={[txt.h2, { textAlign: 'center' }]} accessibilityRole="header">{t('account.signOut.question')}</Text>
            <View style={styles.buttons}>
              <PrimaryBtn label={busy ? t('account.signOut.signingOut') : t('account.signOut.button')} tone="red" help={t('account.appLock.signOutHelp')}
                onPress={() => void signOut()} disabled={busy} />
              <GhostBtn label={t('common.back')} help={t('account.appLock.backHelp')} onPress={() => { setForgot(false); setError(''); }} disabled={busy} />
            </View>
          </>
        ) : (
          <>
            <PatternPad onDone={(dots) => void drew(dots)} disabled={busy || waiting} error={!!error} resetKey={padKey} onStart={() => setError('')} />
            <PadMessage tone={busy ? 'muted' : 'error'}
              text={busy ? t('account.appLock.opening')
                : waiting ? t('account.appLock.waitFor', { count: Math.max(1, Math.ceil((until - now) / 60_000)) })
                : error} />
            <LinkBtn label={t('account.appLock.forgot')} help={t('account.appLock.forgotHelp')} onPress={() => { setForgot(true); setError(''); }} style={{ alignSelf: 'center' }} />
          </>
        )}
        {forgot && error ? <Text style={[txt.error, { textAlign: 'center' }]} accessibilityRole="alert">{error}</Text> : null}
      </View>
    </View>
  );
}

/** The time now, ticking each second until `until`, then still. */
function useNow(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    setNow(Date.now());
    const tick = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= until) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [until]);
  return now;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  face: { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  column: { width: '100%', maxWidth: 360, alignItems: 'center', gap: space.md },
  buttons: { alignSelf: 'stretch', gap: space.sm }
});
