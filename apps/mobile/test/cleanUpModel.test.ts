import { buildIndexes, commands, emptyLanguageState, foldLanguage, type AnyEvent, type EventPayloads, type EventType } from '@langquest-next/core';
import { mixGain } from '../modules/microphone-energy/src/deepFilter';
import { buttonLabel, cleanSums, cleanUpOffer, gainOf, limitAt, mixBars, placeOf, SLIDER_START, snapPlace, toneBars, type CleanSums } from '../src/recording/cleanUpModel';

describe('the slider (decision 177; Caleb, 2026-10-28)', () => {
  it('starts at 12 dB, goes from 6 dB at Less to no limit at More, and reads back its place', () => {
    expect(limitAt(SLIDER_START)).toBe(12);
    expect(limitAt(0)).toBe(6);
    expect(limitAt(2 / 3)).toBe(24);
    expect(limitAt(0.999)).toBe(48);
    expect(limitAt(1)).toBeNull();
    for (const p of [0, 1 / 3, 2 / 3, 1]) expect(placeOf(limitAt(p))).toBeCloseTo(p, 5);
  });

  it('counts a finger near an end as at it, so a drag reaches More', () => {
    expect(limitAt(snapPlace(0.98))).toBeNull();
    expect(snapPlace(0.97)).toBe(1);
    expect(snapPlace(0.02)).toBe(0);
    expect(snapPlace(-0.2)).toBe(0);
    expect(snapPlace(1.3)).toBe(1);
    expect(snapPlace(0.5)).toBe(0.5);
    expect(snapPlace(SLIDER_START)).toBe(SLIDER_START);
  });

  it('mixes back what the phones mix back', () => {
    // Why: the bars drawn must be the sound kept; deepFilter.ts is the arithmetic the phones port.
    for (const limit of [6, 12, 24, 48, null]) expect(gainOf(limit)).toBeCloseTo(mixGain(limit), 12);
  });
});

describe('the bars of a part and its cleaned sound', () => {
  // Two slices: the first all voice, the second voice with as much noise again (x = y + noise, the noise apart from the voice).
  const sums: CleanSums = { n: [100, 100], xx: [4, 2], xy: [4, 1], yy: [4, 1] };
  it('draws the part as recorded with its noise, and the cleaned sound shorter where the noise was', () => {
    const original = toneBars(sums);
    expect(original.voice[0]).toBeCloseTo(original.bars[0]!, 9);
    expect(original.voice[1]!).toBeLessThan(original.bars[1]!);
    const all = toneBars(sums, null);
    expect(all.voice).toEqual(all.bars);
    expect(all.bars[1]!).toBeLessThan(original.bars[1]!);
    const some = toneBars(sums, 6);
    expect(some.bars[1]!).toBeGreaterThan(all.bars[1]!);
    expect(some.bars[1]!).toBeLessThan(original.bars[1]!);
    expect(mixBars(sums, 6)).toEqual(some.bars);
  });

  it('reads what the module measured, and nothing from a broken answer', () => {
    expect(cleanSums([[1], [2], [3], [4]])).toEqual({ n: [1], xx: [2], xy: [3], yy: [4] });
    expect(cleanSums([[1], [2]])).toBeNull();
    expect(cleanSums([[1, 2], [2], [3], [4]])).toBeNull();
  });
});

describe('which parts Clean up is offered for', () => {
  let n = 0;
  const ev = <T extends EventType>(type: T, payload: EventPayloads[T]): AnyEvent =>
    ({ id: `e${++n}`, type, orgId: 'o', streamId: 'l', actorId: 'me', deviceId: 'd', hlc: `${String(n).padStart(15, '0')}:000000:d`, payload } as AnyEvent);
  it('leaves out a cleaned sound and a part that was cleaned, and offers a part kept as recorded again', () => {
    let state = foldLanguage([
      ev('v1.UnitAdded', { unitId: 'p', parentUnitId: null, kind: 'passage', label: '1:1', order: 'a' }),
      ev('v1.RecordingAdded', { recordingId: 'r', unitId: 'p', kind: 'target', cards: [{ hash: 'a', durationMs: 1 }, { hash: 'b', durationMs: 1 }, { hash: 'c', durationMs: 1 }] }),
      ev('v1.TakeComposed', { takeId: 't', unitId: 'p', cardHashes: ['a', 'b', 'c'], parentTakeId: null })
    ], emptyLanguageState());
    const specs = commands(state, buildIndexes(state)).cleanUpParts({ commandId: 'c', unitId: 'p', actorId: 'me', cardHashes: ['a', 'b', 'c'], tool: 'dfn3',
      parts: [{ hash: 'a', use: 'cleaned', cleaned: { hash: 'a2', format: 'm4a' } }, { hash: 'b', use: 'original' }] });
    state = foldLanguage(specs.map((s) => ({ ...ev(s.type, s.payload), id: s.id })), state);
    expect(cleanUpOffer(state, 'p', ['a2', 'b', 'c'])).toEqual({ offered: [1, 2], before: [0] });
  });
});

describe('the sheet\'s button', () => {
  it('says what it keeps', () => {
    expect(buttonLabel(['cleaned'])).toBe('Use cleaned');
    expect(buttonLabel(['original'])).toBe('Use original');
    expect(buttonLabel(['cleaned', 'cleaned'])).toBe('Use 2 cleaned');
    expect(buttonLabel(['original', 'original'])).toBe('Use 2 original');
    expect(buttonLabel(['cleaned', 'original', 'cleaned', 'cleaned'])).toBe('Use 3 cleaned, 1 original');
  });
});
