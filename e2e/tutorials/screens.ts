// Which of the app's code draws each screen a tutorial video shows
// (docs/tutorial-videos.md "Why a video is filmed again"). The app's screen
// table (SCREENS in apps/mobile/App.tsx) names the module of each screen id;
// a module's code is the files it imports, and the files they import, inside
// apps/mobile, resolved as the web export resolves them (a .web.tsx first),
// since the videos are filmed on the web. A file that many screens' modules
// import (the kit, the theme, the catalogs, the shell) is shared code: a
// change to it is every screen's, so it slots no video by itself, and is
// named only when a video's words changed and no screen's own code did.
//
// Read from the files, not imported: the filming must not load the app.
import path from 'node:path';
import type { Tutorial } from './tutorial';

/** A file that this many screens' modules or more import is shared code, not a screen's own. */
export const SHARED = 4;

const APP = 'apps/mobile/App.tsx';
/** Where the app's packages are named and pinned. */
const PACKAGES = ['apps/mobile/package.json', 'package-lock.json'];
/** As Metro resolves an import for the web: the web's own file first, then the file any platform takes. */
const ENDINGS = ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.json', '/index.web.tsx', '/index.web.ts', '/index.tsx', '/index.ts', '/index.js'];

export interface Files {
  /** A file's text, or null when there is no such file. Paths are from the repository's root, with `/`. */
  read(file: string): string | null;
}

/** Each screen id in the app's SCREENS table, with the module that draws it (as App.tsx imports it, `./src/screens/work`). */
export function screenModules(app: string): Map<string, string> {
  const modules = new Map<string, string>();
  for (const m of app.matchAll(/import \* as (\w+) from '(\.[^']+)'/g)) modules.set(m[1]!, m[2]!);
  for (const m of app.matchAll(/const (\w+) = \(\) => import\('(\.[^']+)'\)/g)) modules.set(m[1]!, m[2]!);
  const start = app.indexOf('const SCREENS');
  if (start < 0) throw new Error(`${APP} has no SCREENS table`);
  const table = app.slice(start, app.indexOf('\n};', start));
  const screens = new Map<string, string>();
  for (const m of table.matchAll(/(\w+): (?:(\w+)\.\w+|lazyScreen\((\w+), '\w+'\))/g)) {
    const module = modules.get(m[2] ?? m[3]!);
    if (module) screens.set(m[1]!, module);
  }
  return screens;
}

/** What a file imports, by the specifier as written; type-only imports draw nothing and are left out. */
export function importsOf(source: string): string[] {
  const code = source.replace(/^\s*(?:import|export)\s+type\b[^;]*;/gm, '');
  return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

/** The file a relative import names, as the web export finds it, or null (a package, or a file outside apps/mobile). */
function resolve(files: Files, from: string, specifier: string, cache: Map<string, boolean>): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(from), specifier);
  if (!base.startsWith('apps/mobile/')) return null;
  for (const ending of ['', ...ENDINGS]) {
    const file = base + ending;
    if (ending === '' && !/\.(tsx?|jsx?|json)$/.test(file)) continue;
    let there = cache.get(file);
    if (there === undefined) cache.set(file, (there = files.read(file) !== null));
    if (there) return file;
  }
  return null;
}

/** A module and every file it imports, on and on. */
function closure(files: Files, start: string, cache: Map<string, boolean>, imports: Map<string, string[]>): Set<string> {
  const seen = new Set([start]);
  for (const queue = [start]; queue.length;) {
    const file = queue.pop()!;
    let next = imports.get(file);
    if (!next) {
      const text = file.endsWith('.json') ? '' : files.read(file) ?? '';
      next = importsOf(text).map((s) => resolve(files, file, s, cache)).filter((f): f is string => f !== null);
      imports.set(file, next);
    }
    for (const f of next) {
      if (seen.has(f)) continue;
      seen.add(f);
      queue.push(f);
    }
  }
  return seen;
}

export interface ScreenCode {
  /** Each screen id's own code: its module's files that fewer than SHARED modules import. */
  own: Map<string, Set<string>>;
  /** The code many screens share. */
  shared: Set<string>;
}

/** The code that draws each screen, from the app's files. */
export function screenCode(files: Files): ScreenCode {
  const app = files.read(APP);
  if (app === null) throw new Error(`No ${APP}`);
  const screens = screenModules(app);
  const cache = new Map<string, boolean>();
  const imports = new Map<string, string[]>();
  const byModule = new Map<string, Set<string>>();
  for (const module of new Set(screens.values())) {
    const file = resolve(files, APP, module, cache);
    if (file) byModule.set(module, closure(files, file, cache, imports));
  }
  const reach = new Map<string, number>();
  for (const code of byModule.values()) for (const f of code) reach.set(f, (reach.get(f) ?? 0) + 1);
  // The packages every screen is built with are shared code too: an upgrade can change how any screen reads.
  const shared = new Set([...[...reach].filter(([, n]) => n >= SHARED).map(([f]) => f), ...PACKAGES]);
  const own = new Map<string, Set<string>>();
  for (const [screen, module] of screens) {
    const code = byModule.get(module);
    if (code) own.set(screen, new Set([...code].filter((f) => !shared.has(f))));
  }
  return { own, shared };
}

/** The screen each step of a video is on, in order. */
export const stepScreens = (tutorial: Pick<Tutorial, 'steps'>): string[] => tutorial.steps.map((s) => s.screen);
