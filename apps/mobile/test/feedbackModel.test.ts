// Feedback from help mode (decisions.md 145): when a report may be sent, how
// big its screenshot and a chosen picture are, what waits before anyone
// signs in, and what the sheet and its toasts say.
import { describe, expect, it } from 'vitest';
import {
  base64Bytes, feedbackReady, GUEST_LIMIT, MAX_FEEDBACK_CHARS, MAX_VOICE_MS, parseWaiting, PICTURE_BYTES, PICTURE_SIDE, pictureFits, pictureSize,
  PILL_MARGIN, pillPlace, previewSize, profileChoice, sentMessage, SHOT_WIDTH, shotSize, voiceTooLong, withWaiting, type FeedbackPayload, type VoiceRef, type WaitingFeedback
} from '../src/feedback/feedbackModel';

const payload: FeedbackPayload = { kind: 'bug', body: 'It froze', installId: 'inst', context: {}, shareProfile: false, shot: false };
const waiting = (id: string): WaitingFeedback => ({ id, payload, queuedAt: 0 });

describe('a report', () => {
  it('needs a kind and some words, within what the server takes', () => {
    expect(feedbackReady(null, 'It froze')).toBe(false);
    expect(feedbackReady('bug', '   ')).toBe(false);
    expect(feedbackReady('idea', 'Bigger buttons')).toBe(true);
    expect(feedbackReady('bug', 'a'.repeat(MAX_FEEDBACK_CHARS))).toBe(true);
    expect(feedbackReady('bug', 'a'.repeat(MAX_FEEDBACK_CHARS + 1))).toBe(false);
  });

  it('may be said instead of typed, up to two minutes', () => {
    const said = (durationMs: number): VoiceRef => ({ hash: 'h', format: 'm4a', durationMs });
    expect(feedbackReady('bug', '', said(30_000))).toBe(true);
    expect(feedbackReady(null, '', said(30_000))).toBe(false);
    expect(feedbackReady('idea', 'and typed', said(MAX_VOICE_MS))).toBe(true);
    expect(voiceTooLong(said(MAX_VOICE_MS + 1))).toBe(true);
    expect(feedbackReady('bug', 'words too', said(MAX_VOICE_MS + 1))).toBe(false);
  });
});

describe('the Send feedback button', () => {
  const area = { width: 400, height: 800 }, pill = { width: 200, height: 52 };

  it('starts centred, its distance above the foot', () => {
    expect(pillPlace(area, pill, 16, { dx: 0, dy: 0 })).toEqual({ left: 100, top: 800 - 16 - 52, drag: { dx: 0, dy: 0 } });
  });

  it('goes where it is dragged, and never past the edges', () => {
    expect(pillPlace(area, pill, 16, { dx: -40, dy: -300 })).toMatchObject({ left: 60, top: 432 });
    const far = pillPlace(area, pill, 16, { dx: 999, dy: -9999 });
    expect(far).toMatchObject({ left: 400 - 200 - PILL_MARGIN, top: PILL_MARGIN });
    // What is kept is where it shows, so the next drag starts there.
    expect(pillPlace(area, pill, 16, far.drag)).toEqual(far);
  });

  it('stays in sight when the window gets smaller', () => {
    const kept = pillPlace(area, pill, 16, { dx: 0, dy: -600 }).drag;
    expect(pillPlace({ width: 320, height: 400 }, pill, 16, kept)).toMatchObject({ left: 60, top: PILL_MARGIN });
  });
});

describe('the screenshot', () => {
  it('keeps the window\'s shape at a fixed width', () => {
    expect(shotSize({ width: 412, height: 915 }, 2.625)).toEqual({ width: SHOT_WIDTH, height: Math.round((SHOT_WIDTH * 915) / 412) });
  });

  it('is never drawn wider than the window\'s own pixels', () => {
    expect(shotSize({ width: 320, height: 640 }, 1)).toEqual({ width: 320, height: 640 });
  });
});

describe('a picture the person chose (LAN-198)', () => {
  it('is made no longer than PICTURE_SIDE on either side, in its own shape, and never larger', () => {
    expect(pictureSize({ width: 4032, height: 3024 })).toEqual({ width: PICTURE_SIDE, height: 1200 });
    expect(pictureSize({ width: 1179, height: 2556 })).toEqual({ width: Math.round((1179 * PICTURE_SIDE) / 2556), height: PICTURE_SIDE });
    expect(pictureSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it('goes only as a JPEG no bigger than the server takes', () => {
    const jpeg = (bytes: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(bytes - 3)]).toString('base64');
    expect(base64Bytes(jpeg(1000))).toBe(1000);
    expect(base64Bytes(jpeg(1001))).toBe(1001);
    expect(pictureFits(jpeg(PICTURE_BYTES))).toBe(true);
    expect(pictureFits(jpeg(PICTURE_BYTES + 1))).toBe(false);
    // A PNG starts 89 50 4E 47.
    expect(pictureFits(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]).toString('base64'))).toBe(false);
    // The server takes at most 1 MiB.
    expect(PICTURE_BYTES).toBeLessThanOrEqual(1048576);
  });

  it('shows as wide as the sheet, or narrower when it would be too tall', () => {
    expect(previewSize({ width: 1600, height: 1200 }, 400, 360)).toEqual({ width: 400, height: 300 });
    expect(previewSize({ width: 1179, height: 2556 }, 400, 360)).toEqual({ width: Math.round(360 * 1179 / 2556), height: 360 });
  });
});

describe('reports written before sign-in', () => {
  it('keep the newest few, and say which went', () => {
    let list: WaitingFeedback[] = [];
    let dropped: WaitingFeedback[] = [];
    for (let i = 0; i <= GUEST_LIMIT; i++) ({ kept: list, dropped } = withWaiting(list, waiting(`f${i}`)));
    expect(list).toHaveLength(GUEST_LIMIT);
    expect(list[0]!.id).toBe('f1');
    expect(dropped.map((d) => d.id)).toEqual(['f0']);
  });

  it('are kept once, however often they are saved', () => {
    const { kept } = withWaiting([waiting('a')], waiting('a'));
    expect(kept.map((w) => w.id)).toEqual(['a']);
  });

  it('read back what was stored, and nothing from a damaged store', () => {
    expect(parseWaiting(JSON.stringify([waiting('a'), { nope: 1 }]))).toEqual([waiting('a')]);
    expect(parseWaiting('{not json')).toEqual([]);
    expect(parseWaiting(null)).toEqual([]);
  });
});

describe('what the sheet says', () => {
  it('shows what the profile switch would send: an email, or a sign-in name for an account made by invite', () => {
    expect(profileChoice('Grace Akello', 'grace@example.org')).toEqual({ label: 'Add my name and email', sub: 'Grace Akello · grace@example.org' });
    expect(profileChoice('Nyibol', 'nyibol-123@people.langquest.org')).toEqual({ label: 'Add my name and sign-in name', sub: 'Nyibol · nyibol-123' });
    expect(profileChoice('Peter', null)).toEqual({ label: 'Add my name', sub: 'Peter' });
  });

  it('says whether it went, or when it will', () => {
    expect(sentMessage(true, true)).toBe('Sent. Thank you!');
    expect(sentMessage(false, true)).toBe('Saved. It is sent when you are connected.');
    expect(sentMessage(false, false)).toBe('Saved. It is sent after you sign in.');
  });
});
