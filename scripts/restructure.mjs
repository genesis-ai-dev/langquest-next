#!/usr/bin/env node
// Decision 105, part two: apps/mobile/src by feature, as one mechanical change
// anyone can apply to their own branch (docs/merging-onto-the-restructure.md):
//
//   node scripts/restructure.mjs          move, and rewrite what points at it
//   node scripts/restructure.mjs --check  say what it would do; exit 1 if anything
//
// It moves each file in scripts/restructure/moves.json that is still at its old
// place (`git mv`, so history follows), then, in every tracked file of the
// repository, rewrites what points at a moved file: relative imports, exports,
// `import()`, `require()` and `vi.mock()` in code, and `apps/mobile/src/<file>`
// paths in docs, tests and scripts. A file that moved has its own relative
// imports rewritten for its new place. Running it again changes nothing, and
// on a branch made before the moves it fixes code that still names old paths.
// The decision log and dated audits keep their old paths: they are history.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const spec = JSON.parse(readFileSync(join(ROOT, 'scripts/restructure/moves.json'), 'utf8'));
const APP = spec.root;
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const TEXT = /\.(md|ts|tsx|mts|js|mjs|cjs|json|ya?ml|toml|sh)$/;
const HISTORY = [/^docs\/decisions\.md$/, /^docs\/journey-tests\//, /^docs\/performance-audit\.md$/, /^supabase\//, /^scripts\/restructure\//];
/** `push.web.ts` -> `push`: the path an import names, without its extension or platform. */
const base = (p) => p.replace(/(\.(web|native|ios|android))?\.(tsx?|jsx?|mjs|cjs|json)$/, '');

const moves = spec.moves.map(([from, to]) => ({ from: posix.join(APP, from), to: posix.join(APP, to) }));
const byBase = new Map();
for (const m of moves) {
  const [f, t] = [base(m.from), base(m.to)];
  if (byBase.has(f) && byBase.get(f) !== t) throw new Error(`${m.from}: two places for one module`);
  byBase.set(f, t);
}
const fileTo = new Map(moves.map((m) => [m.from, m.to]));

const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const pending = moves.filter((m) => existsSync(join(ROOT, m.from)) && !existsSync(join(ROOT, m.to)));
for (const m of moves) {
  if (existsSync(join(ROOT, m.from)) && existsSync(join(ROOT, m.to))) throw new Error(`${m.from} and ${m.to} both exist: resolve by hand`);
}

/** Where a file is once the moves are made. */
const placeOf = (p) => fileTo.get(p) ?? p;
/** Where a module a code file names is once the moves are made (`dir/x`, `dir/x.json`, a folder's index). */
function moduleAfter(abs) {
  const b = base(abs);
  const to = byBase.get(b);
  return to === undefined ? abs : to + abs.slice(b.length);
}
function rel(fromFile, target) {
  let r = posix.relative(posix.dirname(fromFile), target);
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
}

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*|\bjest\.mock\s*\(\s*|^\s*import\s*)(['"])(\.{1,2}\/[^'"]*)\2/gm;
const changes = new Map();

for (const file of tracked) {
  if (!existsSync(join(ROOT, file)) || HISTORY.some((h) => h.test(file))) continue;
  const isCode = CODE.test(file);
  if (!isCode && !TEXT.test(file)) continue;
  const before = readFileSync(join(ROOT, file), 'utf8');
  let after = before;
  const now = placeOf(file);
  if (isCode) {
    after = after.replace(SPECIFIER, (all, lead, q, s) => {
      const target = moduleAfter(posix.normalize(posix.join(posix.dirname(file), s)));
      const next = rel(now, target);
      return next === s ? all : `${lead}${q}${next}${q}`;
    });
  }
  // Paths written out in full, and in apps/mobile's own tests and scripts relative to it.
  for (const m of moves) {
    after = after.split(m.from).join(m.to);
    if (file.startsWith('apps/mobile/')) {
      const [f, t] = [m.from.slice('apps/mobile/'.length), m.to.slice('apps/mobile/'.length)];
      after = after.replace(new RegExp(`(?<![\\w./-])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), t);
    }
  }
  for (const [f, t] of spec.renamedMentions ?? []) after = after.split(f).join(t);
  if (after !== before || now !== file) changes.set(file, { now, after, edited: after !== before });
}

const leftover = tracked.filter((f) => new RegExp(`^${APP}/[^/]+\\.(ts|tsx)$`).test(f) && !fileTo.has(f) && existsSync(join(ROOT, f)));
const inSimple = tracked.filter((f) => f.startsWith(`${APP}/simple/`) && !fileTo.has(f) && existsSync(join(ROOT, f)));
const edited = [...changes.values()].filter((c) => c.edited).length;
console.log(`${pending.length} files to move, ${edited} files to rewrite.`);
if (leftover.length || inSimple.length) {
  console.log(`Not in the map (add them to scripts/restructure/moves.json, or leave them on purpose):\n  ${[...leftover, ...inSimple].join('\n  ')}`);
}
if (check) process.exit(pending.length || edited ? 1 : 0);

for (const m of pending) {
  mkdirSync(join(ROOT, dirname(m.to)), { recursive: true });
  git('mv', m.from, m.to);
}
for (const [file, c] of changes) {
  if (c.edited) writeFileSync(join(ROOT, c.now), c.after);
}
if (pending.length || edited) console.log('Done. Then: npm install, npm run typecheck, npm test, npm run lint.');
void relative;
