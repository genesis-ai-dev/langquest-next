// Finds words written straight into the app's code where a person would see
// them (decision on localization, LAN-42). Every word on a screen comes from
// the catalogs in src/i18n through `t()`; this is the check that keeps it so,
// run by i18n.test.ts with the rest of `npm test`.
//
// What counts as words on screen:
// - text between JSX tags (`<Text>Save</Text>`), or a string as a JSX child;
// - a string with any letter in a prop that is shown or read aloud
//   (`label`, `title`, `placeholder`, `accessibilityLabel`, ...);
// - anywhere else, a string that reads like prose: two words with a space
//   between them, or one capitalised word ("Save", "Translator").
// Not counted: imports, property names, literal types, comparisons and
// `case` labels (ids, not words), and the arguments of calls that only log
// (`noteExpected`, `reportError`, `console.*`) or read storage.
//
// A string that is not for people (an id, a log line, a sample) is marked
// with an `i18n-ignore` comment on its line or the line above, saying why.
// A whole file is skipped with `i18n-ignore-file` and a reason in its first
// lines; only developer tools may do that.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface Finding {
  file: string;
  line: number;
  text: string;
}

/** Props whose string is shown or spoken, so any letter in them is a word on screen. */
export const TEXT_PROPS = new Set([
  'title', 'sub', 'subtitle', 'label', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'aria-label',
  'body', 'text', 'message', 'summary', 'detail', 'help', 'hint', 'caption', 'heading', 'description', 'empty',
  'confirmLabel', 'cancelLabel', 'actionLabel', 'emptyText', 'note', 'tooltip', 'alt'
]);

/** Calls whose string arguments never reach a person. */
const QUIET_CALLS = new Set([
  'noteExpected', 'reportError', 'reportFault', 'failureMessage', 'failure', 'require', 'describe', 'it', 'test', 'expect', 'addBreadcrumb',
  'console.log', 'console.warn', 'console.error', 'console.info', 'console.debug',
  'AsyncStorage.getItem', 'AsyncStorage.setItem', 'AsyncStorage.removeItem', 'AsyncStorage.multiRemove',
  'Error', 'TypeError', 'RangeError', 'Symbol', 'RegExp', 'Intl.DateTimeFormat', 'Intl.NumberFormat',
  'useNav', 'navigate', 'nav.go', 'go', 'push', 'replace', 'reset', 'getItem', 'setItem', 'removeItem',
  'addEventListener', 'removeEventListener', 'addListener', 'on', 'off', 'emit', 'querySelector', 'getElementById',
  'setAttribute', 'createElement', 'fetch', 'rpc', 'from', 'select', 'eq', 'channel', 'invoke', 'storage.from', 'sql', 'exec', 'execAsync',
  'runAsync', 'getAllAsync', 'getFirstAsync', 'prepareAsync', 'withTransactionAsync'
]);

const LETTER = /\p{L}/u;
/** Two words with whitespace between, or one capitalised word on its own. */
const PROSE = /\p{L}{2,}[,.;:!?’'"”)…]*\s+[(“"‘']*\p{L}|^\s*\p{Lu}\p{Ll}+[\s,.;:!?…]*$/u;
/** SQL keeps its English keywords. */
const SQL = /^\s*(select|insert|update|delete|create|drop|alter|pragma|with|begin|commit|rollback|savepoint|release)\s/i;

function calleeName(e: ts.Expression): string {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) {
    const left = calleeName(e.expression);
    return left ? `${left}.${e.name.text}` : e.name.text;
  }
  return '';
}

function quietCall(call: ts.CallExpression | ts.NewExpression): boolean {
  const name = calleeName(call.expression);
  if (!name) return false;
  if (QUIET_CALLS.has(name)) return true;
  const last = name.split('.').pop()!;
  return QUIET_CALLS.has(last) && name.includes('.');
}

/** The prop a string is the value of, through conditionals, `??`, `||`, templates and parentheses. */
function jsxContext(node: ts.Node): { kind: 'prop'; name: string } | { kind: 'child' } | null {
  let n: ts.Node = node;
  for (;;) {
    const p = n.parent;
    if (!p) return null;
    if (ts.isJsxAttribute(p)) return { kind: 'prop', name: p.name.getText() };
    if (ts.isJsxExpression(p)) {
      if (p.parent && ts.isJsxAttribute(p.parent)) return { kind: 'prop', name: p.parent.name.getText() };
      if (p.parent && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent))) return { kind: 'child' };
      return null;
    }
    if (ts.isParenthesizedExpression(p) || ts.isTemplateSpan(p) || ts.isTemplateExpression(p)
      || (ts.isConditionalExpression(p) && p.condition !== n)
      || (ts.isBinaryExpression(p) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken].includes(p.operatorToken.kind) && (p.right === n || p.operatorToken.kind === ts.SyntaxKind.PlusToken))) {
      n = p;
      continue;
    }
    return null;
  }
}

/** Positions where a string is an id, a key or a type, never a word on screen. */
function quietPosition(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isImportTypeNode(p.parent ?? p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isEnumMember(p)) && p.name === node) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isBinaryExpression(p) && [
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword
  ].includes(p.operatorToken.kind)) return true;
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(node as ts.Expression) && quietCall(p)) return true;
  if (ts.isExpressionStatement(p)) return true; // 'use strict'
  return false;
}

function ignored(source: ts.SourceFile, node: ts.Node, lines: string[]): boolean {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const end = source.getLineAndCharacterOfPosition(node.getEnd()).line;
  for (let l = line - 1; l <= end; l++) if (lines[l]?.includes('i18n-ignore')) return true;
  return false;
}

/** The words in one file that a person would see and that skip the catalogs. */
export function findUiText(path: string, text: string, display = path): Finding[] {
  if (/i18n-ignore-file/.test(text.split('\n').slice(0, 15).join('\n'))) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split('\n');
  const found: Finding[] = [];
  const add = (node: ts.Node, value: string) => {
    if (ignored(source, node, lines)) return;
    found.push({ file: display, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: value.trim().slice(0, 120) });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (LETTER.test(node.text)) add(node, node.text);
      return;
    }
    let value: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = node.text;
    else if (ts.isTemplateExpression(node)) value = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' {} ');
    if (value !== null) {
      if (ts.isTemplateExpression(node) && (ts.isTaggedTemplateExpression(node.parent))) return;
      if (!quietPosition(node) && !SQL.test(value)) {
        const ctx = jsxContext(node);
        const shown = ctx?.kind === 'child' || (ctx?.kind === 'prop' && TEXT_PROPS.has(ctx.name));
        if (ctx?.kind === 'prop' && !TEXT_PROPS.has(ctx.name) ? PROSE.test(value) : shown ? LETTER.test(value) : PROSE.test(value)) add(node, value);
      }
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * `t()` called outside any function: it runs once, when the module loads,
 * before the person's language is known, so the words would stay English.
 */
export function findModuleScopeT(path: string, text: string, display = path): Finding[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Finding[] = [];
  const visit = (node: ts.Node, inFunction: boolean) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) inFunction = true;
    if (!inFunction && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      found.push({ file: display, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: node.getText(source).slice(0, 120) });
    }
    ts.forEachChild(node, (c) => visit(c, inFunction));
  };
  visit(source, false);
  return found;
}

/** Keys the code names: string literals that are a key, and the fixed start of `t(`area.${x}`)`. */
export function keysNamed(path: string, text: string): { literals: Set<string>; prefixes: Set<string> } {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const literals = new Set<string>();
  const prefixes = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node.text);
    if (ts.isTemplateExpression(node) && node.parent && ts.isCallExpression(node.parent) && node.parent.arguments[0] === node
      && ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 't' && node.head.text) prefixes.add(node.head.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { literals, prefixes };
}

/** Every .ts and .tsx file of the app that can draw or say something. */
export function appFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== 'i18n' && name !== 'node_modules') walk(path); continue; }
      if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
    }
  };
  walk(join(root, 'src'));
  out.push(join(root, 'App.tsx'));
  return out.sort();
}

export function scanApp(root: string): Finding[] {
  return appFiles(root).flatMap((path) => findUiText(path, readFileSync(path, 'utf8'), relative(root, path)));
}

// `npx tsx apps/mobile/test/uiText.ts` lists what is left (`--counts`: by file).
if (process.argv[1] && /uiText\.ts$/.test(process.argv[1])) {
  const root = join(import.meta.dirname, '..');
  const found = scanApp(root);
  const byFile = new Map<string, Finding[]>();
  for (const f of found) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const sorted = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
  if (process.argv.includes('--counts')) for (const [file, fs] of sorted) console.log(`${fs.length}\t${file}`);
  else for (const f of found) console.log(`${f.file}:${f.line}\t${f.text}`);
  console.log(`${found.length} strings in ${byFile.size} files`);
}
