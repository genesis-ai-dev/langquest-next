import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every doc in docs/ says its kind on the line under its title, and
// docs/README.md lists it under that kind
// (docs/decisions/2026-11-19-each-doc-answers-one-question.md). A plan says
// its status there too. The decision log (docs/decisions/) has its own test,
// and the UI suite's chapters and the routines' prompts are read as parts of
// their folders.

const root = new URL('..', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const KINDS = ['reference', 'plan', 'report', 'history'] as const;
type Kind = (typeof KINDS)[number];
const STATUSES = ['draft', 'accepted', 'in progress', 'built', 'dropped'];
const KIND_LINE = /^Kind: (\w+)(?: · Status: (.+))?$/;
const HEADINGS: Record<string, Kind> = { Reference: 'reference', Plans: 'plan', Reports: 'report', History: 'history' };

/** Paths under docs/ that must carry a kind line and an index entry. */
function docs(): string[] {
  const md = (dir: string) =>
    readdirSync(new URL(`docs/${dir}`, root)).filter((f) => f.endsWith('.md')).map((f) => `${dir}${f}`);
  const top = md('').filter((f) => f !== 'README.md' && f !== 'decisions.md');
  const folders = ['routines/README.md', 'ui-test-suite/README.md', 'journey-tests/README.md'];
  return [...top, ...md('ux/'), ...folders].sort();
}

function kindLine(path: string): string | undefined {
  const lines = read(`docs/${path}`).split('\n');
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  return lines.slice(h1 + 1).find((l) => l.trim() !== '');
}

/** The index's links, each with the kind of the section it is under (intro links have none). */
function indexed(): { path: string; kind: Kind | undefined }[] {
  let kind: Kind | undefined;
  const out: { path: string; kind: Kind | undefined }[] = [];
  for (const line of read('docs/README.md').split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) kind = HEADINGS[heading[1]];
    for (const m of line.matchAll(/\]\(\.\/([^)#]+)\)/g)) out.push({ path: m[1], kind });
  }
  return out;
}

describe('docs', () => {
  it('each doc says its kind on the line under its title, and a plan its status', () => {
    const wrong = docs().flatMap((path) => {
      const line = kindLine(path) ?? '';
      const m = KIND_LINE.exec(line);
      if (!m || !KINDS.includes(m[1] as Kind)) return [`${path}: "${line.slice(0, 60)}" is not "Kind: ${KINDS.join('|')}"`];
      if (m[1] === 'plan' && !STATUSES.some((s) => m[2]?.startsWith(s))) {
        return [`${path}: a plan's line says "· Status: ${STATUSES.join('|')}…"`];
      }
      if (m[1] !== 'plan' && m[2]) return [`${path}: only a plan has a status`];
      return [];
    });
    expect(wrong).toEqual([]);
  });

  it('docs/README.md lists each doc once, under its kind', () => {
    const links = indexed();
    const wrong = docs().flatMap((path) => {
      const kind = KIND_LINE.exec(kindLine(path) ?? '')?.[1];
      const entries = links.filter((l) => l.path === path);
      if (entries.length !== 1) return [`${path}: listed ${entries.length} times`];
      if (entries[0].kind !== kind) return [`${path}: a ${kind} doc listed under ${entries[0].kind ?? 'no kind'}`];
      return [];
    });
    expect(wrong).toEqual([]);
  });

  it("every link in docs/README.md leads to a file", () => {
    const missing = indexed().map((l) => l.path).filter((p) => !existsSync(new URL(`docs/${p}`, root)));
    expect(missing).toEqual([]);
  });
});
