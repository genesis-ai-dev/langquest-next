// More settings › Lock the app (decisions.md 253): a switch, which asks for
// the person's own sign-in pattern before it changes. Someone with no
// pattern yet chooses a picture and draws one twice first, as at their first
// sign-out (decision 168): that is the pattern the lock asks for, and the one
// they sign back in with.
import { useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { ChosenPicture, PatternPad, PictureGrid } from '../auth/patternPad';
import { useLockWays } from '../auth/useLockWays';
import { failureMessage } from '../diagnostics/report';
import { t } from '../i18n';
import { isPattern, MIN_DOTS, PICTURES } from '../session/lockModel';
import { GhostBtn, PrimaryBtn, Row, Sheet } from '../ui/kit';
import { checkOwnPattern, choosePattern, setOn } from './appLock';
import { PadMessage } from './PadMessage';
import { useAppLock } from './useAppLock';

type Step = 'check' | 'picture' | 'pattern';

export function AppLockRow(props: { ctx: Ctx; last?: boolean }) {
  const actorId = props.ctx.session.actorId;
  const on = useAppLock().people.includes(actorId);
  const lock = useLockWays(actorId);
  const [step, setStep] = useState<Step | null>(null);
  // A picture whose pattern opened an older key (a password changed since) is drawn again with its pattern.
  const hasPattern = lock.picture !== null && !!lock.ways?.includes('pattern');
  return (
    <>
      <Row icon="lock" label={t('account.appLock.row')} help={t('account.appLock.rowHelp')} role="switch" checked={on} disabled={lock.ways === null}
        onPress={() => setStep(on || hasPattern ? 'check' : 'picture')} last={props.last} testID="app-lock-row" />
      {step ? <AppLockSheet ctx={props.ctx} step={step} setStep={setStep} on={on} picture={lock.picture} taken={lock.taken} /> : null}
    </>
  );
}

function AppLockSheet(props: { ctx: Ctx; step: Step; setStep: (s: Step | null) => void; on: boolean; picture: number | null; taken: number[] }) {
  const { ctx, step, setStep } = props;
  const actorId = ctx.session.actorId;
  const [picture, setPicture] = useState<number | null>(props.picture);
  // The pattern drawn once, waiting to be drawn again; the pad clears when its key changes.
  const [first, setFirst] = useState<number[] | null>(null);
  const [padKey, setPadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => setStep(null);
  function done(on: boolean) {
    setOn(actorId, on);
    ctx.toast(on ? t('account.appLock.on') : t('account.appLock.off'));
    close();
  }
  /** Their own pattern, once: it turns the lock on or off. */
  async function checked(dots: number[]) {
    setBusy(true);
    setError('');
    try {
      const result = await checkOwnPattern(actorId, dots);
      if (result.kind === 'ok') return done(!props.on);
      setError(result.kind === 'wait'
        ? t('account.appLock.waitFor', { count: Math.max(1, Math.ceil(result.ms / 60_000)) })
        : t('entry.lock.wrong'));
    } catch (e) {
      setError(failureMessage('app lock: check', e));
    } finally {
      setBusy(false);
      setPadKey((k) => k + 1);
    }
  }
  /** A new pattern: drawn once, then again to be sure; the second time keeps it and turns the lock on. */
  async function drew(dots: number[]) {
    setPadKey((k) => k + 1);
    if (!isPattern(dots)) { setError(t('account.lock.tooShort', { n: MIN_DOTS })); return; }
    if (first === null) { setFirst(dots); setError(''); return; }
    if (first.join() !== dots.join()) { setFirst(null); setError(t('account.lock.patternsDiffer')); return; }
    setBusy(true);
    setError('');
    try {
      // Someone took that picture meanwhile: choose again.
      if ((await choosePattern(actorId, dots, picture ?? -1)).kind !== 'ok') { setBusy(false); setFirst(null); setStep('picture'); return; }
      done(true);
    } catch (e) {
      setError(failureMessage('app lock: new pattern', e));
      setBusy(false);
    }
  }
  if (step === 'picture') {
    return (
      <Sheet visible title={t('account.lock.pictureTitle')} onClose={close}
        footer={<PrimaryBtn label={t('common.next')} help={t('account.lock.nextHelp')} onPress={() => setStep('pattern')} disabled={picture === null} />}>
        <PictureGrid pictures={PICTURES.map((_, i) => i).filter((i) => !props.taken.includes(i))} selected={picture} onPick={setPicture}
          help={t('account.lock.pictureHelp')} />
      </Sheet>
    );
  }
  if (step === 'pattern') {
    const back = () => { setStep('picture'); setFirst(null); setError(''); };
    return (
      <Sheet visible title={first === null ? t('account.lock.drawTitle') : t('account.lock.drawAgain')} onClose={close} onBack={back}
        footer={<GhostBtn label={t('common.back')} help={t('help.details.back')} onPress={back} disabled={busy} />}>
        {picture !== null ? <ChosenPicture picture={picture} /> : null}
        <PatternPad onDone={(dots) => void drew(dots)} disabled={busy} error={!!error} resetKey={padKey} onStart={() => setError('')} />
        <PadMessage tone="error" text={error} />
      </Sheet>
    );
  }
  return (
    <Sheet visible title={t('account.appLock.row')} onClose={close}>
      {props.picture !== null ? <ChosenPicture picture={props.picture} /> : null}
      <PatternPad onDone={(dots) => void checked(dots)} disabled={busy} error={!!error} resetKey={padKey} onStart={() => setError('')} />
      <PadMessage tone={busy ? 'muted' : 'error'} text={busy ? t('account.appLock.checking') : error} />
    </Sheet>
  );
}
