// Feedback from help mode (decisions.md 141), the parts with no I/O: what
// makes a report ready to send, how big its screenshot is, what waits on a
// phone before anyone has signed in, and what the sheet and its toasts say.
import { t } from '../i18n';
import { signInName } from '../auth/accounts';

/** A problem, or an idea. */
export type FeedbackKind = 'bug' | 'idea';
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'idea'];

/** What the server takes (public.feedback_submit). */
export const MAX_FEEDBACK_CHARS = 4000;

/** Screenshot width in pixels: the screen's words still read, and months of waiting reports stay small. */
export const SHOT_WIDTH = 720;
export const SHOT_QUALITY = 0.6;

/** What a report says about itself, as queued in the account outbox. Never a name or an email: the server reads those, if shared. */
export interface FeedbackPayload {
  kind: FeedbackKind;
  body: string;
  /** The install id diagnostics use (the event envelope's deviceId). */
  installId: string;
  /** The diag context, the screen it was sent from and the app's language. */
  context: Record<string, string>;
  shareProfile: boolean;
  /** A screenshot waits beside it on the phone (feedbackShots.ts), under the report's id. */
  shot: boolean;
}

export function feedbackReady(kind: FeedbackKind | null, body: string): kind is FeedbackKind {
  return kind !== null && body.trim().length > 0 && body.length <= MAX_FEEDBACK_CHARS;
}

/** The screenshot's size: the window's shape, SHOT_WIDTH wide, never wider than the window itself. */
export function shotSize(window: { width: number; height: number }, scale: number): { width: number; height: number } {
  const full = Math.max(1, Math.round(window.width * scale));
  const width = Math.min(SHOT_WIDTH, full);
  return { width, height: Math.max(1, Math.round((width * window.height) / Math.max(1, window.width))) };
}

/** A report written before anyone signed in on this phone: sent as whoever signs in next. */
export interface WaitingFeedback {
  id: string;
  payload: FeedbackPayload;
  queuedAt: number;
}

/** Reports kept from before sign-in. A phone left signed out keeps the newest few. */
export const GUEST_LIMIT = 10;

export function withWaiting(list: readonly WaitingFeedback[], next: WaitingFeedback): { kept: WaitingFeedback[]; dropped: WaitingFeedback[] } {
  const all = [...list.filter((w) => w.id !== next.id), next];
  const cut = Math.max(0, all.length - GUEST_LIMIT);
  return { kept: all.slice(cut), dropped: all.slice(0, cut) };
}

export function parseWaiting(raw: string | null): WaitingFeedback[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((w): w is WaitingFeedback =>
      !!w && typeof w === 'object' && typeof (w as WaitingFeedback).id === 'string' && !!(w as WaitingFeedback).payload) : [];
  } catch {
    return [];
  }
}

/** The switch that adds the person's name and how they sign in: the words, and what would be sent. */
export function profileChoice(name: string, email: string | null): { label: string; sub: string } {
  const handle = signInName(email);
  if (handle) return { label: t('feedback.addNameAndSignIn'), sub: t('feedback.nameAndHandle', { name, handle }) };
  if (email) return { label: t('feedback.addNameAndEmail'), sub: t('feedback.nameAndHandle', { name, handle: email }) };
  return { label: t('feedback.addName'), sub: name };
}

export function kindLabel(kind: FeedbackKind): string {
  return kind === 'bug' ? t('feedback.kind.bug') : t('feedback.kind.idea');
}

export function bodyPlaceholder(kind: FeedbackKind | null): string {
  return kind === 'idea' ? t('feedback.placeholder.idea') : t('feedback.placeholder.bug');
}

/** What the toast says once it is saved: sent, or waiting for a connection (or a sign-in). */
export function sentMessage(sent: boolean, signedIn: boolean): string {
  if (sent) return t('feedback.toast.sent');
  return signedIn ? t('feedback.toast.saved') : t('feedback.toast.savedUntilSignIn');
}
