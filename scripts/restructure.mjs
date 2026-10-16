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
//
// `movedExports` lists names that moved from one file to another (a hook out of
// a component file, say). Every import or re-export of such a name from the old
// file is pointed at the new one, and the old file's own re-export of it goes.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
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

const movedExports = (spec.movedExports ?? []).map((m) => ({
  from: base(posix.join(APP, m.from)), to: base(posix.join(APP, m.to)), names: new Set(m.names)
}));
let ts = null;
const typescript = () => (ts ??= createRequire(join(ROOT, 'package.json'))('typescript'));

/** Point imports of moved names at their new file, and drop the old file's re-exports of them. */
function repointExports(file, text) {
  if (!movedExports.length || !/\.(tsx?|mts|cts)$/.test(file)) return text;
  const t = typescript();
  const sf = t.createSourceFile(file, text, t.ScriptTarget.Latest, true, file.endsWith('x') ? t.ScriptKind.TSX : t.ScriptKind.TS);
  const self = base(file);
  const edits = [];
  const imports = sf.statements.filter((s) => t.isImportDeclaration(s));
  const added = new Map();
  for (const s of sf.statements) {
    const isImport = t.isImportDeclaration(s);
    if (!isImport && !t.isExportDeclaration(s)) continue;
    const named = isImport ? s.importClause?.namedBindings : s.exportClause;
    if (!named || !t.isNamedImports(named) && !t.isNamedExports(named)) continue;
    const spec = s.moduleSpecifier && t.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : null;
    const source = spec === null ? self : spec.startsWith('.') ? base(posix.normalize(posix.join(posix.dirname(file), spec))) : null;
    if (source === null) continue;
    const typeOnly = isImport ? s.importClause.isTypeOnly : s.isTypeOnly;
    const keep = [];
    const out = new Map();
    for (const e of named.elements) {
      const name = (e.propertyName ?? e.name).text;
      // In the old file: its re-export of a moved name (from the new file, or a bare export list) goes.
      if (!isImport && movedExports.some((x) => x.names.has(name) && x.from === self && (spec === null || source === x.to))) continue;
      // Anywhere else: a moved name is taken from its new file.
      const m = movedExports.find((x) => x.names.has(name) && x.from === source && x.from !== self);
      if (m) { out.set(m.to, [...(out.get(m.to) ?? []), e.getText()]); continue; }
      keep.push(e.getText());
    }
    if (keep.length === named.elements.length) continue;
    const lines = [];
    const kw = isImport ? 'import' : 'export';
    if (keep.length) lines.push(text.slice(s.getStart(), named.getStart()) + `{ ${keep.join(', ')} }` + text.slice(named.getEnd(), s.getEnd()));
    else if (isImport && s.importClause.name) lines.push(`import ${s.importClause.name.text} from ${s.moduleSpecifier.getText()};`);
    for (const [to, names] of out) {
      const next = rel(file, to);
      const existing = isImport && imports.find((i) => i !== s && t.isStringLiteral(i.moduleSpecifier) && i.moduleSpecifier.text === next &&
        i.importClause && !i.importClause.isTypeOnly === !typeOnly && i.importClause.namedBindings && t.isNamedImports(i.importClause.namedBindings));
      if (existing) { added.set(existing, [...(added.get(existing) ?? []), ...names]); continue; }
      lines.push(`${kw} ${typeOnly ? 'type ' : ''}{ ${names.join(', ')} } from '${next}';`);
    }
    if (lines.length) edits.push({ start: s.getStart(), end: s.getEnd(), text: lines.join('\n') });
    else edits.push({ start: s.getFullStart(), end: s.getEnd(), text: '' });
  }
  for (const [i, names] of added) {
    const nb = i.importClause.namedBindings;
    const have = new Set(nb.elements.map((e) => e.getText()));
    const all = [...nb.elements.map((e) => e.getText()), ...names.filter((n) => !have.has(n))];
    edits.push({ start: nb.getStart(), end: nb.getEnd(), text: `{ ${all.join(', ')} }` });
  }
  for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}

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
  if (isCode) after = repointExports(now, after);
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
