import { recordedCard, recordedDurationMs, recordingsOf } from '../src/cards';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { applyLanguageEvent, foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';

/**
 * Why: playing a clip looked each card's length and format up by scanning
 * every recording in the language, for every card on every draw (37,000
 * recordings in Koro Miyan). The lookups are kept per state and revision,
 * so they must give the old answers and follow every event folded into the
 * same state object.
 */
let n = 0;
const ev = <T extends EventType>(type: T, payload: EventPayloads[T]): AnyEvent => {
  n += 1;
  return { id: `c${n}`, type, orgId: 'org1', streamId: 'L1', actorId: 't1', deviceId: 'dA', hlc: `00170000020000${String(n).padStart(2, '0')}:000000:dA`, payload } as AnyEvent;
};
const recording = (recordingId: string, unitId: string, cards: { hash: string; durationMs: number; format?: 'wav' | 'm4a' }[]) =>
  ev('v1.RecordingAdded', { recordingId, unitId, kind: 'target', cards });

describe('recorded cards by file (clip length and format)', () => {
  it('finds a card from the first recording that holds it, and its length from the first that gives one', () => {
    const state = foldLanguage([
      recording('r1', 'u1', [{ hash: 'a', durationMs: 0 }, { hash: 'b', durationMs: 2000, format: 'm4a' }]),
      recording('r2', 'u2', [{ hash: 'a', durationMs: 1500, format: 'm4a' }])
    ], emptyLanguageState());
    expect(recordedCard(state, 'a')?.format).toBeUndefined();
    expect(recordedDurationMs(state, 'a')).toBe(1500);
    expect(recordedCard(state, 'b')?.format).toBe('m4a');
    expect(recordedCard(state, 'voice-note')).toBeUndefined();
    expect(recordedDurationMs(state, 'voice-note')).toBe(0);
    expect(recordingsOf(state, 'u1').map((r) => r.cards.length)).toEqual([2]);
    expect(recordingsOf(state, 'nowhere')).toEqual([]);
  });

  it('follows a recording folded into the same state', () => {
    const state = foldLanguage([recording('r1', 'u1', [{ hash: 'a', durationMs: 1000 }])], emptyLanguageState());
    expect(recordedDurationMs(state, 'z')).toBe(0);
    expect(recordingsOf(state, 'u1')).toHaveLength(1);
    applyLanguageEvent(state, recording('r3', 'u1', [{ hash: 'z', durationMs: 900 }]));
    expect(recordedDurationMs(state, 'z')).toBe(900);
    expect(recordingsOf(state, 'u1')).toHaveLength(2);
  });
});
