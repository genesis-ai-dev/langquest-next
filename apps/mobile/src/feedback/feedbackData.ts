// Feedback from help mode (decisions.md 145). A report is an account change:
// it waits in the account outbox as the person who wrote it, so it survives
// months offline and a restart, holds sign-out like any saved change, goes
// with a shared phone's hand-over and is sent as its author (decisions.md
// 60). Its screenshot waits beside it (feedbackShots.ts). Written before
// anyone signed in on this phone, it waits in a list of its own and joins the
// outbox of whoever signs in next: the server takes nothing from a phone
// without an account (decision 112).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { ensureDeviceId } from '@langquest-next/sync';
import { accountOutbox, queueAccountAction } from '../account/accountData';
import { phoneContext } from '../diagnostics/diagnostics';
import { noteExpected } from '../diagnostics/report';
import { currentLocale } from '../i18n';
import { getStore } from '../sync/store';
import { dropShot, keepShot } from './feedbackShots';
import { dropVoice } from './voiceBytes';
import { parseWaiting, withWaiting, type FeedbackKind, type FeedbackPayload, type VoiceRef } from './feedbackModel';

const WAITING_KEY = 'feedback-before-sign-in';

export interface FeedbackDraft {
  kind: FeedbackKind;
  body: string;
  shareProfile: boolean;
  /** The screenshot as base64 JPEG, when the person turned it on. */
  shot: string | null;
  /** A voice note, in the phone's file store until it has gone. */
  voice: VoiceRef | null;
  /** The screen it was sent from (its ScreenId). */
  screen: string;
}

let writes: Promise<unknown> = Promise.resolve();
function changeWaiting<T>(fn: (raw: string | null) => Promise<T>): Promise<T> {
  const next = writes.then(async () => fn(await AsyncStorage.getItem(WAITING_KEY)));
  writes = next.catch(() => {});
  return next;
}

/** The report as queued; read before its screenshot is kept, so a failure here leaves no file behind. */
async function payloadOf(d: FeedbackDraft, shot: boolean): Promise<FeedbackPayload> {
  const { installId, ...phone } = await phoneContext();
  return {
    kind: d.kind,
    body: d.body.trim(),
    installId: installId ?? await ensureDeviceId(await getStore(), () => Crypto.randomUUID()),
    context: { ...phone, screen: d.screen, uiLanguage: currentLocale() },
    shareProfile: d.shareProfile,
    shot,
    voice: d.voice
  };
}

/**
 * Keep the report and try to send it now. Resolves to whether it reached the
 * server within `waitMs`; otherwise it is saved and goes when it can.
 * `actorId` null: nobody is signed in on this phone yet.
 */
export async function sendFeedback(actorId: string | null, draft: FeedbackDraft, waitMs = 4000): Promise<boolean> {
  const id = Crypto.randomUUID();
  const words = await payloadOf(draft, false);
  let shot = false;
  if (draft.shot) {
    try { await keepShot(id, draft.shot); shot = true; } catch (e) { noteExpected('feedback: keep screenshot', e); }
  }
  const payload = { ...words, shot };
  if (actorId === null) {
    // Before sign-in there is no profile to share.
    const waiting = { id, payload: { ...payload, shareProfile: false }, queuedAt: Date.now() };
    const dropped = await changeWaiting(async (raw) => {
      const { kept, dropped } = withWaiting(parseWaiting(raw), waiting);
      await AsyncStorage.setItem(WAITING_KEY, JSON.stringify(kept));
      return dropped;
    });
    for (const d of dropped) {
      if (d.payload.shot) await dropShot(d.id);
      if (d.payload.voice) await dropVoice(d.payload.voice);
    }
    return false;
  }
  await queueAccountAction(actorId, 'feedback', { ...payload }, id);
  const outbox = accountOutbox(actorId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    outbox.flush().catch(() => false),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); })
  ]);
  clearTimeout(timer);
  return (await outbox.list()).find((a) => a.id === id)?.status === 'sent';
}

/** Someone signed in: what was written before sign-in on this phone goes as them. */
export async function adoptWaitingFeedback(actorId: string): Promise<void> {
  if (actorId === 'guest') return;
  await changeWaiting(async (raw) => {
    const list = parseWaiting(raw);
    if (list.length === 0) return;
    for (const w of list) await queueAccountAction(actorId, 'feedback', { ...w.payload }, w.id);
    await AsyncStorage.removeItem(WAITING_KEY);
  }).catch((e: unknown) => { noteExpected('feedback: adopt', e); });
}
