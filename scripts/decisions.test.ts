import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The ADR log is docs/decisions.md (entries 1 to 175, cited by number) and,
// from 2026-10-27, one file per decision in docs/decisions/, named by its date
// and a few words (docs/decisions/2026-10-27-one-file-per-decision.md). Code
// and docs cite both, so the numbers stay as they are, no new numbered entry
// is added, every cited file exists, and every decision says when, by whom
// and whether it still holds.

const root = new URL('..', import.meta.url);
const LAST_NUMBERED = 175;

const src = readFileSync(new URL('docs/decisions.md', root), 'utf8');
const lines = src.replace(/```[\s\S]*?```/g, '').split('\n');

const entries = lines.flatMap((line, i) => {
  const m = /^## (\d+)\. (.+)$/.exec(line);
  return m ? [{ n: Number(m[1]), title: m[2], meta: lines[i + 2] ?? '' }] : [];
});

/** A decision's file name without `.md`: its date and a few words. */
const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const META = /^Date: (\d{4}-\d{2}-\d{2}) · By: ([^·]+?) · Status: (accepted|(?:partly )?superseded by (\d+|\d{4}-\d{2}-\d{2}-[a-z0-9-]+))$/;

const files = readdirSync(new URL('docs/decisions/', root))
  .filter((f) => f !== 'README.md')
  .sort()
  .map((f) => {
    const text = readFileSync(new URL(`docs/decisions/${f}`, root), 'utf8');
    const fileLines = text.split('\n');
    return { f, name: f.replace(/\.md$/, ''), text, lines: fileLines };
  });
const names = new Set(files.map((d) => d.name));

describe('decision log, entries 1 to 175', () => {
  it('numbers entries 1, 2, 3 … with no gaps or repeats', () => {
    expect(entries.map((e) => e.n)).toEqual(entries.map((_, i) => i + 1));
  });

  it('adds no numbered entry: a new decision is a file in docs/decisions/', () => {
    expect(entries.length, 'write a new decision as a file in docs/decisions/ (its README says how)').toBe(LAST_NUMBERED);
  });

  it('gives every entry a date, an author and a status', () => {
    const bad = entries.filter((e) => !META.test(e.meta)).map((e) => `${e.n}: "${e.meta}"`);
    expect(bad).toEqual([]);
  });

  it('only supersedes an entry with a later one', () => {
    const bad = entries.flatMap((e) => {
      const by = META.exec(e.meta)?.[4];
      if (!by) return [];
      const later = /^\d+$/.test(by) ? Number(by) > e.n && Number(by) <= entries.length : names.has(by);
      return later ? [] : [`${e.n} -> ${by}`];
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

describe('decisions in docs/decisions/, one file each', () => {
  it('names each file by its date and a few words, in lowercase with hyphens', () => {
    expect(files.filter((d) => !d.f.endsWith('.md') || !NAME.test(d.name)).map((d) => d.f)).toEqual([]);
  });

  it('opens with the decision as a heading, then its date, author and status', () => {
    const bad = files.filter((d) => !/^# \S/.test(d.lines[0] ?? '') || d.lines[1] !== '' || !META.test(d.lines[2] ?? '')).map((d) => d.f);
    expect(bad).toEqual([]);
  });

  it('dates each decision as its file name does', () => {
    const bad = files.filter((d) => META.exec(d.lines[2] ?? '')?.[1] !== NAME.exec(d.name)?.[1]).map((d) => d.f);
    expect(bad).toEqual([]);
  });

  it('gives each decision its reason and what would reverse it', () => {
    expect(files.filter((d) => !/^Reason: /m.test(d.text) || !/^Reverse if: /m.test(d.text)).map((d) => d.f)).toEqual([]);
  });

  it('only supersedes a decision with a later one that exists', () => {
    const bad = files.flatMap((d) => {
      const by = META.exec(d.lines[2] ?? '')?.[4];
      return by && !(names.has(by) && by !== d.name && by.slice(0, 10) >= d.name.slice(0, 10)) ? [`${d.name} -> ${by}`] : [];
    });
    expect(bad).toEqual([]);
  });

  it('dates and names every amendment', () => {
    const bad = files.flatMap((d) => d.lines.filter((l) => /^Amended\b/.test(l) && !/^Amended \(\d{4}-\d{2}-\d{2}, [^)]+\):/.test(l)).map((l) => `${d.f}: ${l}`));
    expect(bad).toEqual([]);
  });

  it('has a file for every decision cited by its path', () => {
    // Tracked files, and new ones not yet added (git grep --untracked leaves out what .gitignore does).
    const grep = spawnSync('git', ['grep', '--untracked', '-I', '-h', '-o', '-E', 'decisions/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]*[a-z0-9]'], {
      cwd: fileURLToPath(root),
      encoding: 'utf8'
    });
    const cited = new Set(grep.stdout.split('\n').filter(Boolean).map((m) => m.replace(/^decisions\//, '')));
    expect([...cited].filter((name) => !names.has(name)).sort()).toEqual([]);
  });
});
