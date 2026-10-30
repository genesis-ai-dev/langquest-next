// Feedback from help mode (decisions.md 145), the parts with no I/O: what
// makes a report ready to send, how big its screenshot and a chosen picture
// are, what waits on a phone before anyone has signed in, and what the sheet
// and its toasts say.
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

/** A screenshot: a JPEG as base64, with its size (capture.ts, capture.web.ts). */
export interface Shot { base64: string; width: number; height: number }

/**
 * A picture the person chose (LAN-198): a JPEG no longer than PICTURE_SIDE
 * on either side and no bigger than PICTURE_BYTES, inside what the server
 * takes (1 MiB). The words of a screenshot of another app still read.
 */
export const PICTURE_SIDE = 1600;
export const PICTURE_BYTES = 1_000_000;
/** Tried in turn until the picture is small enough. */
export const PICTURE_QUALITIES: readonly number[] = [0.7, 0.5, 0.35];

/** Longer than a slow phone takes to draw its window, short enough that the sheet still opens promptly. */
export const CAPTURE_MS = 4000;

/** A voice note with the report: the recording in the phone's file store (sync/blobs.ts), by its hash. */
export interface VoiceRef { hash: string; format: 'wav' | 'm4a'; durationMs: number }

/** The longest voice note a report carries: a phone's AAC, or the web's 16 kHz WAV, fits what the server takes. */
export const MAX_VOICE_MS = 2 * 60_000;

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
  /** So does a picture the person chose (LAN-198). */
  picture?: boolean;
  /** Said rather than (or as well as) typed. */
  voice?: VoiceRef | null;
}

/** A kind, and words or a voice note (or both), within what the server takes. */
export function feedbackReady(kind: FeedbackKind | null, body: string, voice: VoiceRef | null = null): kind is FeedbackKind {
  if (kind === null || body.length > MAX_FEEDBACK_CHARS || voiceTooLong(voice)) return false;
  return body.trim().length > 0 || voice !== null;
}

export function voiceTooLong(voice: VoiceRef | null): boolean {
  return !!voice && voice.durationMs > MAX_VOICE_MS;
}

/** Room kept between Send feedback and the edges of the area it is dragged in. */
export const PILL_MARGIN = 8;

/**
 * Where Send feedback is drawn: centred, `bottom` above the area's foot,
 * moved by where the person dragged it, and never past the area's edges.
 * Also the drag as it ends up once kept inside them, so the next drag
 * starts from where it shows.
 */
export function pillPlace(area: { width: number; height: number }, pill: { width: number; height: number }, bottom: number,
  drag: { dx: number; dy: number }): { left: number; top: number; drag: { dx: number; dy: number } } {
  const homeLeft = (area.width - pill.width) / 2;
  const homeTop = area.height - bottom - pill.height;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const left = clamp(homeLeft + drag.dx, PILL_MARGIN, area.width - pill.width - PILL_MARGIN);
  const top = clamp(homeTop + drag.dy, PILL_MARGIN, area.height - pill.height - PILL_MARGIN);
  return { left, top, drag: { dx: left - homeLeft, dy: top - homeTop } };
}

/** The screenshot's size: the window's shape, SHOT_WIDTH wide, never wider than the window itself. */
export function shotSize(window: { width: number; height: number }, scale: number): { width: number; height: number } {
  const full = Math.max(1, Math.round(window.width * scale));
  const width = Math.min(SHOT_WIDTH, full);
  return { width, height: Math.max(1, Math.round((width * window.height) / Math.max(1, window.width))) };
}

/** A picture's size once made smaller: its shape, no side longer than `maxSide`, never larger than it was. */
export function pictureSize(natural: { width: number; height: number }, maxSide = PICTURE_SIDE): { width: number; height: number } {
  const longer = Math.max(natural.width, natural.height, 1);
  const scale = Math.min(1, maxSide / longer);
  return { width: Math.max(1, Math.round(natural.width * scale)), height: Math.max(1, Math.round(natural.height * scale)) };
}

/** How many bytes some base64 holds. */
export function base64Bytes(base64: string): number {
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - pad;
}

/** A JPEG (its first bytes FF D8 FF are "/9j/" in base64) no bigger than PICTURE_BYTES: what the server takes. */
export function pictureFits(base64: string): boolean {
  return base64.startsWith('/9j/') && base64Bytes(base64) <= PICTURE_BYTES;
}

/** The chosen picture on the sheet: as wide as `width`, never taller than `maxHeight`, in its own shape. */
export function previewSize(picture: { width: number; height: number }, width: number, maxHeight: number): { width: number; height: number } {
  const ratio = picture.height / Math.max(1, picture.width);
  const height = Math.min(maxHeight, width * ratio);
  return { width: Math.round(height / ratio), height: Math.round(height) };
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
