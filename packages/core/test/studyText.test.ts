import { describe, expect, it } from 'vitest';
import {
  clock, inlineParts, isQuestionSection, passageReading, plainText, secondsOf,
  sectionIdFor, sectionLabel, studySections
} from '../src/studyText';
import { bibleUnitId } from '../src/dynamicBible';

// Why: a study note is anchored to a section id. The ids must come only from
// the order of the text, so the same document always yields the same ids on
// every device, and a "Stop here" box is its own tappable section rather
// than being swallowed into a paragraph.
const STEP = [
  '# Hear and Heart',
  'Listen to the passage',
  'twice, in two translations.',
  '',
  '1. What stood out to you?',
  '- Who is in the story?',
  '> [!action]',
  '> Stop here and discuss **together**.',
  'See the [map of Eden](#c47) and the word __helper__.'
].join('\n');

describe('studySections', () => {
  it('splits a step into headings, joined paragraphs, list items and action boxes, in order', () => {
    const s = studySections(STEP);
    expect(s.map((x) => x.kind)).toEqual(['heading', 'para', 'item', 'item', 'action', 'para']);
    expect(s.map((x) => x.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
    expect(s[1]!.text).toBe('Listen to the passage twice, in two translations.');
    expect(s[2]).toMatchObject({ kind: 'item', n: 1, text: 'What stood out to you?' });
    expect(s[4]!.text).toBe('Stop here and discuss **together**.');
  });

  it('gives the same ids for the same text, so anchors survive a reload', () => {
    expect(studySections(STEP)).toEqual(studySections(STEP));
    expect(sectionIdFor(STEP, 'Who is in')).toBe('s3');
    expect(sectionIdFor(STEP, 'not in the text')).toBe('s0');
  });

  it('treats a section ending in a question mark as a question to answer', () => {
    const s = studySections(STEP);
    expect(isQuestionSection(s[2]!)).toBe(true);
    expect(isQuestionSection(s[1]!)).toBe(false);
  });
});

describe('inline text', () => {
  it('keeps links to media, maps and terms, and bold, without the markup', () => {
    const parts = inlineParts('See the [map of Eden](#c47) and the word __helper__.');
    expect(parts).toEqual([
      { type: 'text', text: 'See the ' },
      { type: 'link', text: 'map of Eden', ref: 'c47' },
      { type: 'text', text: ' and the word ' },
      { type: 'bold', text: 'helper' },
      { type: 'text', text: '.' }
    ]);
    expect(plainText('**Stop** [here](#m1)')).toBe('Stop here');
  });

  it('shortens long labels with an ellipsis and leaves short ones alone', () => {
    const [long] = studySections('A'.repeat(60));
    expect(sectionLabel(long!, 10)).toBe('AAAAAAAA…');
    expect(sectionLabel(studySections('Short')[0]!)).toBe('Short');
  });

  it('converts between seconds and m:ss both ways', () => {
    expect(clock(192)).toBe('3:12');
    expect(clock(-4)).toBe('0:00');
    expect(secondsOf('3:12')).toBe(192);
    expect(secondsOf(clock(65))).toBe(65);
  });
});

describe('passageReading', () => {
  // Why: the study's Passage view highlights verses from real narration
  // timings (PLAN 16, analysis J-STUDY-3). A verse must never get a timing
  // that belongs to another verse, and a unit we cannot resolve must yield
  // nothing rather than a guess from its label.
  it('returns the BSB verses of a dynamic passage with their own timings', () => {
    const reading = passageReading(bibleUnitId('L1', { book: 'jon', start: 1, end: 3 }))!;
    expect(reading.book).toBe('jon');
    expect(reading.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual(['1:1', '1:2', '1:3']);
    expect(reading.verses[0]!.text.length).toBeGreaterThan(10);
    for (const [i, v] of reading.verses.entries()) {
      if (v.startSeconds === undefined) continue;
      expect(v.endSeconds!).toBeGreaterThan(v.startSeconds);
      const next = reading.verses[i + 1];
      if (next?.startSeconds !== undefined) expect(next.startSeconds).toBeGreaterThanOrEqual(v.endSeconds!);
    }
  });

  it('resolves a FIA pericope across a chapter boundary', () => {
    const reading = passageReading('fia@1/gen-p1')!;
    expect(reading.verses[0]).toMatchObject({ chapter: 1, verse: 1 });
    expect(reading.verses.at(-1)).toMatchObject({ chapter: 2, verse: 3 });
    expect(reading.verses).toHaveLength(31 + 3);
  });

  it('has no reading for a unit it cannot place in the Bible', () => {
    expect(passageReading('custom-unit')).toBeNull();
    expect(passageReading('fia@1/not-a-pericope')).toBeNull();
  });
});
