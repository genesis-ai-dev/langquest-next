import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

// An iPhone build has no disguise (decisions.md 171, amended 2026-11-03 and
// 2026-11-05). Apple refused build 48 twice under App Review Guideline
// 2.5.19 and asked for the feature and all its code to go. Build 50 had no
// icons and no native module, and was refused again while it still carried
// the disguise's words and Android's icon list. So the iPhone app carries
// none of it: no icon, no native module to change it, no calculator or
// notepad, none of its code and none of its words, not even in the app
// settings that Expo copies into every build. Android keeps all of it.

const ROOT = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const app = JSON.parse(read('app.json')) as { expo: { plugins: (string | [string, unknown])[] } & Record<string, unknown> };
const pkg = JSON.parse(read('package.json')) as { main: string; expo?: { autolinking?: { ios?: { exclude?: string[] } } } };
const load = createRequire(import.meta.url);
const plugin = load('../plugins/withAndroidAppIcons.js') as ((config: object) => { mods?: Record<string, Record<string, unknown>> }) & { ICONS: Record<string, unknown>[] };

/** The disguise in any form a scan of the app could read. */
const DISGUISE = /disguis|calculat|notepad|notes[1-5]\b/i;

/** What the build's own settings hold: app.json through app.config.js, as Expo embeds them in every build. */
function embeddedConfig(): string {
  const dynamic = load('../app.config.js') as (args: { config: object }) => object;
  return JSON.stringify(dynamic({ config: app.expo }));
}

const EXTS = ['ts', 'tsx', 'js', 'jsx', 'json'];
/** A file as Metro finds it for an iPhone: `x.ios.ts` before `x.native.ts` before `x.ts`, then `x/index`. */
function resolveIos(from: string, spec: string): string | null {
  const base = join(dirname(from), spec);
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const stem of [base, join(base, 'index')]) {
    for (const ext of EXTS) for (const platform of ['.ios', '.native', '']) {
      const file = `${stem}${platform}.${ext}`;
      if (existsSync(file)) return file;
    }
  }
  return null;
}

const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)'(\.{1,2}\/[^']+)'/g;

/** Every file of the app an iPhone build bundles, from package.json's main through each relative import. */
function iphoneFiles(): string[] {
  const seen = new Set<string>();
  const queue = [join(ROOT, pkg.main)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.[jt]sx?$/.test(file)) continue;
    // Types are not bundled: `import type` and `export type` bring in nothing.
    const body = readFileSync(file, 'utf8').replace(/^(?:import|export) type [^;]*;/gm, '');
    for (const m of body.matchAll(SPEC)) {
      const found = resolveIos(file, m[1]!);
      if (found) queue.push(found);
      else if (!/\.(png|jpe?g|svg|ttf|otf|mp3|m4a|wav|webp|gif)$/.test(m[1]!)) throw new Error(`${relative(ROOT, file)}: cannot find ${m[1]}`);
      else seen.add(join(dirname(file), m[1]!));
    }
  }
  return [...seen].map((f) => relative(ROOT, f)).sort();
}

/** A file's code without its comments, which the bundle leaves out: its names, strings and JSX text. */
function codeWords(file: string): string[] {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) out.push(node.text);
    else if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('an iPhone build has no disguise', () => {
  const files = iphoneFiles();

  it("does not run expo-alternate-app-icons' own plugin, whose iOS steps put the icons in the app", () => {
    const names = app.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).not.toContain('expo-alternate-app-icons');
    expect(names).toContain('./plugins/withAndroidAppIcons');
  });

  it('keeps it out of the settings Expo copies into every build: no icon list, no plugin named for it', () => {
    expect(app.expo.plugins).toContain('./plugins/withAndroidAppIcons');
    expect(embeddedConfig()).not.toMatch(DISGUISE);
  });

  it('gives no icon an iPhone picture', () => {
    expect(plugin.ICONS).toHaveLength(10);
    for (const icon of plugin.ICONS) expect(Object.keys(icon).sort()).toEqual(['android', 'name']);
  });

  it("leaves the icon changer's native module out of the iPhone app", () => {
    expect(pkg.expo?.autolinking?.ios?.exclude).toContain('expo-alternate-app-icons');
  });

  it("runs only Android steps: the package's, the names under the icons and the links", () => {
    const config = plugin({ name: 'LangQuest Next', slug: 'langquest-next' });
    expect(Object.keys(config.mods ?? {})).toEqual(['android']);
    expect(Object.keys(config.mods?.android ?? {})).toEqual(expect.arrayContaining(['manifest', 'dangerous']));
  });

  it('bundles none of its files, pictures or words: an iPhone reaches src/disguise from nowhere', () => {
    expect(files).toContain('App.tsx');
    expect(files).toContain('src/screens/account.tsx');
    expect(files).toContain('src/shell/AppCover.tsx');
    expect(files).not.toContain('src/shell/AppCover.android.tsx');
    expect(files.filter((f) => /(^|\/)disguise\//.test(f))).toEqual([]);
  });

  it('names nothing of it in the code an iPhone runs, nor in its words', () => {
    const named = files.filter((f) => /\.[jt]sx?$/.test(f)).flatMap((f) => codeWords(f).filter((w) => DISGUISE.test(w)).map((w) => `${f}: ${w}`));
    expect(named).toEqual([]);
    const words = files.filter((f) => f.endsWith('.json')).filter((f) => DISGUISE.test(read(f)));
    expect(words).toEqual([]);
  });
});
