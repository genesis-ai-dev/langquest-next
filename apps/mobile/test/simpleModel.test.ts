import { describe, expect, it } from 'vitest';
import {
  bookOf, DEFAULT_MIC, MIC_TRIES, mmss, parseMicSettings, partLabel, partsLookClipped, partsRange, passageClock, recorderLines, refChips,
  SHORT_PART_MS, stepAfterDone, stepGroups, thresholdFromNoise, totalMs, verseRefs
} from '../src/simple/model';

describe('the recorder cards (decision 71, demo ADR-036)', () => {
  it('counts parts, since parts carry no verse labels yet', () => {
    expect(partLabel(0)).toBe('Part 1');
    expect(partsRange(1)).toBe('Part 1');
    expect(partsRange(3)).toBe('Parts 1–3');
    const l = recorderLines(3);
    expect(l.next).toBe('Part 4');
    expect(l.recorded).toBe('Parts 1–3 recorded');
    expect(l.groupSub(52_000)).toBe('3 parts · 0:52');
    expect(recorderLines(1).groupSub(18_000)).toBe('1 part · 0:18');
    expect(recorderLines(0).recorded).toBe('');
    expect(recorderLines(0).next).toBe('Part 1');
  });

  it('adds lengths only when every one is known', () => {
    expect(totalMs([12_000, 20_000, 20_000])).toBe(52_000);
    expect(totalMs([12_000, undefined])).toBeUndefined();
    expect(mmss(84_000)).toBe('1:24');
    expect(mmss(undefined)).toBe('–:––');
  });

  it('offers microphone setup when the last three parts all came out very short', () => {
    expect(partsLookClipped([400, 600, 900])).toBe(true);
    expect(partsLookClipped([400, 600])).toBe(false);
    expect(partsLookClipped([5000, 400, 600])).toBe(false);
    expect(partsLookClipped([5000, 400, 600, SHORT_PART_MS - 1])).toBe(true);
  });
});

describe('the reference chips (demo ADR-035)', () => {
  const all = { bible: true, guide: true, terms: true, notes: true, earlier: true };
  it('keep one order: the workspace leads with the Bible and adds Earlier, the study leads with the guide', () => {
    expect(refChips('workspace', all)).toEqual(['bible', 'guide', 'terms', 'notes', 'earlier']);
    expect(refChips('study', all)).toEqual(['guide', 'bible', 'terms', 'notes']);
  });
  it('show only what is attached: no Bible for an outline item, no Guide without one', () => {
    expect(refChips('workspace', { ...all, guide: false, earlier: false })).toEqual(['bible', 'terms', 'notes']);
    expect(refChips('study', { ...all, bible: false, terms: false, notes: false })).toEqual(['guide']);
  });
});

describe('key words', () => {
  it('names the book of a passage title', () => {
    expect(bookOf('Luke 15:1–10')).toBe('Luke');
    expect(bookOf('1 John 3:11–18')).toBe('1 John');
    expect(bookOf('Song of Songs 2:1-7')).toBe('Song of Songs');
    expect(bookOf('Lesson 3 · Clean water')).toBe('Lesson 3 · Clean water');
  });
  it('says where a word is as people say verses', () => {
    expect(verseRefs(['15:4'])).toBe('15:4');
    expect(verseRefs(['15:2', '15:1'])).toBe('15:1–2');
    expect(verseRefs(['15:6', '15:7', '15:9'])).toBe('15:6–7, 9');
    expect(verseRefs(['15:32', '16:1'])).toBe('15:32, 16:1');
    expect(verseRefs(['15:4', '15:4'])).toBe('15:4');
  });
});

describe('the study reader', () => {
  const steps = (done: boolean[]) => done.map((d) => ({ done: d }));
  it('moves on to the next step nobody finished, then wraps to the first one left', () => {
    expect(stepAfterDone(steps([false, false, false]), 0)).toBe(1);
    expect(stepAfterDone(steps([false, true, false]), 0)).toBe(2);
    expect(stepAfterDone(steps([false, false, false]), 2)).toBe(0);
    expect(stepAfterDone(steps([true, true, false]), 2)).toBeNull();
  });
  it('groups steps by their part of the method, in order', () => {
    const g = stepGroups([{ phase: 'Hear' }, { phase: 'Hear' }, { phase: 'Speak' }, {}]);
    expect(g.map((x) => [x.phase, x.items.map((i) => i.index)])).toEqual([['Hear', [0, 1]], ['Speak', [2]], ['', [3]]]);
  });
});

describe('the Bible clock', () => {
  it('counts from the passage start across chapter files', () => {
    const parts = [{ fromMs: 10_000, toMs: 40_000 }, { fromMs: 0, toMs: 48_000 }];
    expect(passageClock(parts, 0, 25_000)).toEqual({ elapsed: 15, total: 78 });
    expect(passageClock(parts, 1, 12_000)).toEqual({ elapsed: 42, total: 78 });
  });
  it('has no total when a part plays a whole chapter without timings', () => {
    expect(passageClock([{ fromMs: 0, toMs: null }], 0, 5_000)).toEqual({ elapsed: 5, total: null });
  });
});

describe('microphone setup by ear (demo ADR-037)', () => {
  it('sets the sensitivity a margin above the loud end of the room', () => {
    expect(thresholdFromNoise([])).toBe(DEFAULT_MIC.threshold);
    // A quiet room: the floor, never lower than the recorder allows.
    expect(thresholdFromNoise(Array(50).fill(0.002))).toBe(0.04);
    // A noisy one: three times its loud end.
    const noisy = [...Array(90).fill(0.03), ...Array(10).fill(0.05)];
    expect(thresholdFromNoise(noisy)).toBe(0.15);
    // Never so high that speech cannot pass.
    expect(thresholdFromNoise(Array(20).fill(0.6))).toBe(0.5);
  });
  it('tries three pauses around the recorder default, the middle one the default', () => {
    expect(MIC_TRIES.map((t) => t.id)).toEqual(['A', 'B', 'C']);
    expect(MIC_TRIES[1]!.pauseMs).toBe(DEFAULT_MIC.pauseMs);
    expect(MIC_TRIES[0]!.pauseMs).toBeLessThan(MIC_TRIES[2]!.pauseMs);
  });
  it('reads back only settings the recorder can use', () => {
    expect(parseMicSettings(JSON.stringify({ threshold: 0.08, pauseMs: 700 }))).toEqual({ threshold: 0.08, pauseMs: 700 });
    expect(parseMicSettings(null)).toBeNull();
    expect(parseMicSettings('not json')).toBeNull();
    expect(parseMicSettings(JSON.stringify({ threshold: 2, pauseMs: 700 }))).toBeNull();
    expect(parseMicSettings(JSON.stringify({ threshold: 0.08 }))).toBeNull();
  });
});
