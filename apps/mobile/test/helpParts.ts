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

export function scanHelp(root: string): Finding[] {
  return appFiles(root).flatMap((path) => findUnexplained(path, readFileSync(path, 'utf8'), relative(root, path)));
}

// `npx tsx apps/mobile/test/helpParts.ts` lists what is left.
if (process.argv[1] && /helpParts\.ts$/.test(process.argv[1])) {
  for (const f of scanHelp(join(import.meta.dirname, '..'))) console.log(`${f.file}:${f.line} ${f.text}`);
}
