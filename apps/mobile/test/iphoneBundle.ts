import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// The app's files an iPhone build bundles, as Metro finds them, for the tests that hold what an
// iPhone carries: no disguise (disguiseIphone.test.ts), and Share nearby without joining offline
// (nearbyIphone.test.ts).

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

/** Every file of the app under `root` an iPhone build bundles, from package.json's main through each relative import, relative to `root`. */
export function iphoneFiles(root: string): string[] {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { main: string };
  const seen = new Set<string>();
  const queue = [join(root, pkg.main)];
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
      else if (!/\.(png|jpe?g|svg|ttf|otf|mp3|m4a|wav|webp|gif)$/.test(m[1]!)) throw new Error(`${relative(root, file)}: cannot find ${m[1]}`);
      else seen.add(join(dirname(file), m[1]!));
    }
  }
  return [...seen].map((f) => relative(root, f)).sort();
}
