import { readFileSync } from 'node:fs';

// docs/decisions.md is the ADR log. Code and docs cite entries by number, so
// numbering must stay sequential, and every entry must say when, by whom and
// whether it still holds.

const src = readFileSync(new URL('../docs/decisions.md', import.meta.url), 'utf8');
const lines = src.replace(/```[\s\S]*?```/g, '').split('\n');

const entries = lines.flatMap((line, i) => {
  const m = /^## (\d+)\. (.+)$/.exec(line);
  return m ? [{ n: Number(m[1]), title: m[2], meta: lines[i + 2] ?? '' }] : [];
});

const META = /^Date: (\d{4}-\d{2}-\d{2}) · By: ([^·]+?) · Status: (accepted|(?:partly )?superseded by (\d+))$/;

describe('decision log', () => {
  it('numbers entries 1, 2, 3 … with no gaps or repeats', () => {
    expect(entries.map((e) => e.n)).toEqual(entries.map((_, i) => i + 1));
  });

  it('gives every entry a date, an author and a status', () => {
    const bad = entries.filter((e) => !META.test(e.meta)).map((e) => `${e.n}: "${e.meta}"`);
    expect(bad).toEqual([]);
  });

  it('only supersedes an entry with a later one', () => {
    const bad = entries.flatMap((e) => {
      const by = META.exec(e.meta)?.[4];
      return by && !(Number(by) > e.n && Number(by) <= entries.length) ? [`${e.n} -> ${by}`] : [];
    });
    expect(bad).toEqual([]);
  });

  it('keeps dates in order', () => {
    const dates = entries.map((e) => META.exec(e.meta)?.[1] ?? '');
    expect(dates).toEqual([...dates].sort());
  });

  it('dates and names every amendment', () => {
    const bad = lines.filter((l) => /^Amended\b/.test(l) && !/^Amended \(\d{4}-\d{2}-\d{2}, [^)]+\):/.test(l));
    expect(bad).toEqual([]);
  });
});
