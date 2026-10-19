// Feedback from help mode (decisions.md 141): when a report may be sent, how
// big its screenshot is, what waits before anyone signs in, and what the
// sheet and its toasts say.
import { describe, expect, it } from 'vitest';
import {
  feedbackReady, GUEST_LIMIT, MAX_FEEDBACK_CHARS, parseWaiting, profileChoice, sentMessage, SHOT_WIDTH, shotSize, withWaiting,
  type FeedbackPayload, type WaitingFeedback
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
