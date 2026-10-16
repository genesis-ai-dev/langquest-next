// A step's card line (decisions.md 129): what it hides, or what it still shows when that is shorter.
import { describe, expect, it } from 'vitest';
import { shownLine } from '../src/checks/showsModel';

const all = { bibleAudio: true, bibleText: true, guideAudio: true, guideText: true, terms: true, notes: true, earlier: true };

describe("a step's card line", () => {
  it('is nothing when the step shows everything', () => {
    expect(shownLine(all)).toBeNull();
  });

  it('names what is hidden, by a struck eye', () => {
    expect(shownLine({ ...all, bibleText: false, guideText: false })).toEqual({ icon: 'eyeOff', line: 'Bible text · Guide text' });
  });

  it('names what still shows when most is hidden, by an open eye', () => {
    const none = Object.fromEntries(Object.keys(all).map((k) => [k, false])) as typeof all;
    expect(shownLine({ ...none, bibleAudio: true })).toEqual({ icon: 'eye', line: 'Bible audio' });
    expect(shownLine(none)).toEqual({ icon: 'eyeOff', line: 'All hidden' });
  });
});
