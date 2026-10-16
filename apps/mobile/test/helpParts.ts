// Finds parts of the app that do not explain themselves in help mode
// (decision 71 as amended 2026-10-15): everything a person can tap, type in
// or switch is a part, and a part says what tapping it does, not only its
// name. Run by helpMode.test.ts with the rest of `npm test`.
//
// What it checks, file by file:
// - a raw `Pressable`, `Touchable*`, `TextInput` or `Switch` that acts holds a
//   `<HelpBadge spot>` (from `useHelpSpot`), or `<HelpLit>` (the ?), or has a
//   `<HelpCover>` beside it (kit's fields and switches);
// - the kit's buttons and chips (`IconBtn`, `SmallBtn`, `LinkBtn`, `GhostBtn`,
//   `Chip`) and a tappable `Card` carry `help`, the line saying what tapping
//   does, and a tappable `Card` its `accessibilityLabel`, which names it;
// - a tappable `Row` carries `sub` or `help`.
// Something that rightly has no line (a sheet's backdrop, a toast) is marked
// with a `help-ignore:` comment on its line or the line above, saying why.
//
// And across the app (decision 71 as amended 2026-10-16): each row a list
// draws (`.map`, `.flatMap`, a FlatList's `renderItem`) that holds parts is a
// `<HelpRow>`, so one row speaks for the list. A list whose items each do
// something different (tabs, filters, a menu of actions) says so with a
// `help-each:` comment on the line of the `.map` or the line above.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { appFiles, type Finding } from './uiText';

const RAW = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'TextInput', 'Switch']);
const NEEDS_HELP = new Set(['IconBtn', 'SmallBtn', 'LinkBtn', 'GhostBtn', 'Chip']);
/** Marks that light a part: what a raw control holds, or has beside it. */
const LIGHTS = /<(HelpBadge|HelpLit|HelpCover)\b/;
/** The help layer itself, and the developer menu, which only developers see. */
const SKIP = /src\/(helpMode\/helpMode|shell\/DevMenu)\.tsx$/;

function attr(el: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
}

function spreads(el: ts.JsxOpeningLikeElement): boolean {
  return el.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p));
}

/** An attribute set to nothing that acts: absent, `undefined`, or `{undefined}`. */
function acts(a: ts.JsxAttribute | undefined): boolean {
  if (!a) return false;
  const v = a.initializer;
  return !(v && ts.isJsxExpression(v) && v.expression && ts.isIdentifier(v.expression) && v.expression.text === 'undefined');
}

export function findUnexplained(path: string, source: string, file = path): Finding[] {
  if (SKIP.test(path) || !path.endsWith('.tsx')) return [];
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = source.split('\n');
  const ignored = (line: number) => /help-ignore:/.test(lines[line] ?? '') || /help-ignore:/.test(lines[line - 1] ?? '');
  const out: Finding[] = [];
  const report = (node: ts.Node, text: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    if (!ignored(line)) out.push({ file, line: line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(sf);
      const element = ts.isJsxOpeningElement(node) ? node.parent : node;
      if (RAW.has(tag)) {
        const isField = tag === 'TextInput' || tag === 'Switch';
        const doing = isField || acts(attr(node, 'onPress')) || acts(attr(node, 'onLongPress'));
        // A field or switch is lit by a HelpCover beside it, in the same parent.
        const parent = element.parent;
        const around = isField && parent && (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) ? parent.getText(sf) : '';
        if (doing && !LIGHTS.test(element.getText(sf)) && !LIGHTS.test(around)) report(node, `${tag} acts without explaining itself`);
      } else if (NEEDS_HELP.has(tag)) {
        if (!attr(node, 'help') && !spreads(node)) report(node, `${tag} without help`);
      } else if (tag === 'Card' && acts(attr(node, 'onPress'))) {
        if (!attr(node, 'help') || !attr(node, 'accessibilityLabel')) report(node, 'tappable Card without help and accessibilityLabel');
      } else if (tag === 'Row' && acts(attr(node, 'onPress'))) {
        if (!attr(node, 'sub') && !attr(node, 'help') && !spreads(node)) report(node, 'tappable Row without sub or help');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Kit and help pieces that are parts, or hold them, wherever they are drawn. */
const PARTS = new Set(['HelpBadge', 'HelpInfo', 'HelpCover', ...RAW, ...NEEDS_HELP]);
/** Drawn plain unless tapped: a part only with `onPress`. */
const PART_IF_PRESSED = new Set(['Card', 'Row']);

const isMap = (node: ts.Node): node is ts.CallExpression => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && ['map', 'flatMap'].includes(node.expression.name.text);
const isFn = (node: ts.Node | undefined): node is ts.ArrowFunction | ts.FunctionExpression => !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

/** Functions a file defines by name (`function card()`, `const card = () =>`), which its lists may draw rows with. */
function helpers(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) out.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFn(node.initializer)) out.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * A file's lists, each with what draws its rows: `.map` and `.flatMap` with a
 * callback or a function the file defines (`.map(card)`), and `renderItem`.
 */
function rowFns(sf: ts.SourceFile, fns: ReadonlyMap<string, ts.Node>): { fn: ts.Node; site: ts.Node }[] {
  const out: { fn: ts.Node; site: ts.Node }[] = [];
  const visit = (node: ts.Node) => {
    if (isMap(node)) {
      const arg = node.arguments[0];
      if (isFn(arg)) out.push({ fn: arg, site: node });
      else if (arg && ts.isIdentifier(arg) && fns.has(arg.text)) out.push({ fn: fns.get(arg.text)!, site: node });
    }
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'renderItem' && node.initializer && ts.isJsxExpression(node.initializer) && isFn(node.initializer.expression)) {
      out.push({ fn: node.initializer.expression, site: node });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * The JSX tags drawn in `node`, through the file's functions it calls
 * (`card(i)`), leaving out the lists inside it (their rows answer for themselves).
 */
function tagsIn(node: ts.Node, sf: ts.SourceFile, rows: ReadonlySet<ts.Node>, fns: ReadonlyMap<string, ts.Node>): ts.JsxOpeningLikeElement[] {
  const out: ts.JsxOpeningLikeElement[] = [];
  const followed = new Set<ts.Node>([node]);
  const visit = (n: ts.Node) => {
    if (n !== node && rows.has(n) && !followed.has(n)) return;
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) out.push(n);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const fn = fns.get(n.expression.text);
      if (fn && !followed.has(fn)) { followed.add(fn); visit(fn); }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** Components (capitalised functions) defined in a file, with what they draw. */
function components(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) out.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text) && node.initializer) out.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function findUnlistedRows(files: readonly { path: string; source: string; file?: string }[]): Finding[] {
  const parsed = files.filter((f) => f.path.endsWith('.tsx') && !SKIP.test(f.path))
    .map((f) => { const sf = ts.createSourceFile(f.path, f.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); return { ...f, sf, fns: helpers(sf) }; });
  const none = new Set<ts.Node>();
  // Which components hold parts: those that draw one, then those that draw them, until nothing changes.
  const drawn = new Map<string, Set<string>>();
  const holds = new Set<string>(PARTS);
  const partTag = (el: ts.JsxOpeningLikeElement, sf: ts.SourceFile) => {
    const tag = el.tagName.getText(sf);
    if (PART_IF_PRESSED.has(tag)) return acts(attr(el, 'onPress'));
    return holds.has(tag) || !!attr(el, 'help');
  };
  for (const f of parsed) {
    for (const [name, body] of components(f.sf)) {
      const tags = tagsIn(body, f.sf, none, f.fns);
      if (tags.some((el) => partTag(el, f.sf))) holds.add(name);
      drawn.set(name, new Set([...(drawn.get(name) ?? []), ...tags.map((el) => el.tagName.getText(f.sf))]));
    }
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, tags] of drawn) if (!holds.has(name) && [...tags].some((t) => holds.has(t) && !PART_IF_PRESSED.has(t))) { holds.add(name); grew = true; }
  }
  const out: Finding[] = [];
  for (const f of parsed) {
    const lines = f.source.split('\n');
    const each = (line: number) => /help-each:/.test(lines[line] ?? '') || /help-each:/.test(lines[line - 1] ?? '');
    const lists = rowFns(f.sf, f.fns);
    const rows = new Set(lists.map((l) => l.fn));
    for (const { fn, site } of lists) {
      const tags = tagsIn(fn, f.sf, rows, f.fns);
      if (!tags.some((el) => partTag(el, f.sf)) || tags.some((el) => el.tagName.getText(f.sf) === 'HelpRow')) continue;
      const line = f.sf.getLineAndCharacterOfPosition(site.getStart(f.sf)).line;
      // The comment may sit on the line of the `.map`, which can be below where the call starts.
      const mapLine = isMap(site) ? f.sf.getLineAndCharacterOfPosition((site.expression as ts.PropertyAccessExpression).name.getStart(f.sf)).line : line;
      if (!each(line) && !each(mapLine)) out.push({ file: f.file ?? f.path, line: mapLine + 1, text: 'list rows hold parts without a HelpRow' });
    }
  }
  return out;
}

export function scanRows(root: string): Finding[] {
  return findUnlistedRows(appFiles(root).map((path) => ({ path, source: readFileSync(path, 'utf8'), file: relative(root, path) })));
}

export function scanHelp(root: string): Finding[] {
  return appFiles(root).flatMap((path) => findUnexplained(path, readFileSync(path, 'utf8'), relative(root, path)));
}

// `npx tsx apps/mobile/test/helpParts.ts` lists what is left.
if (process.argv[1] && /helpParts\.ts$/.test(process.argv[1])) {
  const root = join(import.meta.dirname, '..');
  for (const f of [...scanHelp(root), ...scanRows(root)]) console.log(`${f.file}:${f.line} ${f.text}`);
}
