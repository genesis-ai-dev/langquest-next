// Feedback from help mode (decisions.md 145): when a report may be sent, how
// big its screenshot is, what waits before anyone signs in, and what the
// sheet and its toasts say.
import { describe, expect, it } from 'vitest';
import {
  feedbackReady, GUEST_LIMIT, MAX_FEEDBACK_CHARS, MAX_VOICE_MS, parseWaiting, PILL_MARGIN, pillPlace, profileChoice, sentMessage, SHOT_WIDTH, shotSize,
  voiceTooLong, withWaiting, type FeedbackPayload, type VoiceRef, type WaitingFeedback
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
