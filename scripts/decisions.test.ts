import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The ADR log is docs/decisions/, one file per decision
// (docs/decisions/2026-11-17-one-file-per-decision.md). Decisions 1 to 256
// are NNNN-few-words.md and keep their numbers, which code and docs cite
// ("decisions.md 34"); each later one is YYYY-MM-DD-few-words.md, so two
// branches never take the same name. Every decision says when, by whom and
// whether it still holds, and every citation leads to one that exists.

const root = new URL('..', import.meta.url);
/** The last numbered decision. No decision after it gets a number. */
const LAST_NUMBERED = 256;

const NUMBERED = /^(\d{4})-(?!\d{2}-\d{2}-)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATED = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const META = /^Date: (\d{4}-\d{2}-\d{2}) · By: ([^·]+?) · Status: (accepted|(?:partly )?superseded by (\d+|\d{4}-\d{2}-\d{2}-[a-z0-9-]+))$/;

const all = readdirSync(new URL('docs/decisions/', root))
  .filter((f) => f !== 'README.md')
  .sort()
  .map((f) => {
    const text = readFileSync(new URL(`docs/decisions/${f}`, root), 'utf8');
    const lines = text.split('\n');
    const name = f.replace(/\.md$/, '');
    const meta = META.exec(lines[2] ?? '');
    return { f, name, text, lines, meta, by: meta?.[4] };
  });
const numbered = all.filter((d) => NUMBERED.test(d.name)).map((d) => ({ ...d, n: Number(NUMBERED.exec(d.name)?.[1]) }));
const dated = all.filter((d) => DATED.test(d.name));
const names = new Set(dated.map((d) => d.name));

/** A status's target exists and comes after the decision it supersedes: a higher number, or any dated one. */
function later(from: { n?: number; name: string }, by: string) {
  if (/^\d+$/.test(by)) return from.n !== undefined && Number(by) > from.n && Number(by) <= LAST_NUMBERED;
  return names.has(by) && by !== from.name && (from.n !== undefined || by.slice(0, 10) >= from.name.slice(0, 10));
}

/** Lines of tracked files and new ones not yet added (git grep --untracked leaves out what .gitignore does). */
function grep(pattern: string) {
  const out = spawnSync('git', ['grep', '--untracked', '-I', '-h', '-o', '-E', pattern], { cwd: fileURLToPath(root), encoding: 'utf8' });
  return out.stdout.split('\n').filter(Boolean);
}

describe('decision log', () => {
  it('names each file by its number or its date, then a few words in lowercase with hyphens', () => {
    expect(all.filter((d) => !d.f.endsWith('.md') || !(NUMBERED.test(d.name) || DATED.test(d.name))).map((d) => d.f)).toEqual([]);
  });

  it('gives every decision a heading, then its date, author and status', () => {
    const bad = all.filter((d) => !/^# \S/.test(d.lines[0] ?? '') || d.lines[1] !== '' || !d.meta).map((d) => `${d.f}: "${d.lines[2] ?? ''}"`);
    expect(bad).toEqual([]);
  });

  it('only supersedes a decision with a later one that exists', () => {
    const bad = [...numbered, ...dated].flatMap((d) => (d.by && !later(d, d.by) ? [`${d.name} -> ${d.by}`] : []));
    expect(bad).toEqual([]);
  });

  it('dates and names every amendment', () => {
    const bad = all.flatMap((d) => d.lines.filter((l) => /^Amended\b/.test(l) && !/^Amended \(\d{4}-\d{2}-\d{2}, [^)]+\):/.test(l)).map((l) => `${d.f}: ${l}`));
    expect(bad).toEqual([]);
  });

  it('keeps docs/decisions.md as a page that says where decisions are, with no entry in it', () => {
    const src = readFileSync(new URL('docs/decisions.md', root), 'utf8');
    expect(src.match(/^#{1,3} \d+\. .*$/gm) ?? [], 'write a new decision as a file in docs/decisions/ (its README says how)').toEqual([]);
  });
});

describe('decisions 1 to 256, one numbered file each', () => {
  it('numbers them 1, 2, 3 … with no gaps or repeats', () => {
    expect(numbered.map((d) => d.n)).toEqual(numbered.map((_, i) => i + 1));
  });

  it('adds no numbered file: a new decision is named by its date', () => {
    expect(numbered.length, 'name a new decision YYYY-MM-DD-few-words.md (docs/decisions/README.md)').toBe(LAST_NUMBERED);
  });

  it('heads each file with its own number', () => {
    expect(numbered.filter((d) => !d.lines[0]?.startsWith(`# ${d.n}. `)).map((d) => d.f)).toEqual([]);
  });

  it('keeps dates in order', () => {
    const dates = numbered.map((d) => d.meta?.[1] ?? '');
    expect(dates).toEqual([...dates].sort());
  });
});

describe('decisions after 256, one file each named by its date', () => {
  it('gives each a heading with no number', () => {
    expect(dated.filter((d) => /^# \d+\. /.test(d.lines[0] ?? '')).map((d) => d.f)).toEqual([]);
  });

  it('dates each decision as its file name does, on or after the last numbered one', () => {
    const last = numbered.at(-1)?.meta?.[1] ?? '';
    const bad = dated.filter((d) => d.meta?.[1] !== DATED.exec(d.name)?.[1] || d.name.slice(0, 10) < last).map((d) => d.f);
    expect(bad).toEqual([]);
  });

  it('gives each decision its reason and what would reverse it', () => {
    expect(dated.filter((d) => !/^Reason: /m.test(d.text) || !/^Reverse if: /m.test(d.text)).map((d) => d.f)).toEqual([]);
  });
});

describe('citations of decisions', () => {
  it('cites by path only decisions that exist', () => {
    const files = new Set(all.map((d) => d.name));
    const cited = new Set(grep('decisions/([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4})-[a-z0-9-]*[a-z0-9]').map((m) => m.replace(/^decisions\//, '')));
    expect([...cited].filter((name) => !files.has(name)).sort()).toEqual([]);
  });

  it('cites as "decisions.md N" only a numbered decision', () => {
    const cited = new Set(grep('decisions\\.md`?,? [0-9]+').map((m) => Number(/(\d+)$/.exec(m)?.[1])));
    expect([...cited].filter((n) => n < 1 || n > LAST_NUMBERED).sort((a, b) => a - b), 'cite a new decision by its path').toEqual([]);
  });
});
