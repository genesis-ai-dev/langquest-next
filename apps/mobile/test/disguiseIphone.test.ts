import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// An iPhone build has no disguise (decisions.md 171, amended 2026-11-03).
// Apple refused build 48 twice under App Review Guideline 2.5.19 and asked
// for the feature and all its code to go, so the iPhone app carries no other
// icon, no native module to change it, and no calculator or notepad in front
// of the app. Android keeps all of it.

const ROOT = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const app = JSON.parse(read('app.json')) as { expo: { plugins: (string | [string, unknown])[] } };
const pkg = JSON.parse(read('package.json')) as { expo?: { autolinking?: { ios?: { exclude?: string[] } } } };
const pluginNames = app.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
const icons = (app.expo.plugins.find((p) => Array.isArray(p) && p[0] === './plugins/withAndroidAppIcons') as [string, Record<string, unknown>[]])[1];

/** What a file exports by name: `export function x`, `export async function x`, `export const x`. */
const exportsOf = (file: string) => [...read(file).matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]).sort();

describe('an iPhone build has no disguise', () => {
  it("does not run expo-alternate-app-icons' own plugin, whose iOS steps put the icons in the app", () => {
    expect(pluginNames).not.toContain('expo-alternate-app-icons');
    expect(pluginNames).toContain('./plugins/withAndroidAppIcons');
  });

  it('gives no icon an iPhone picture', () => {
    expect(icons).toHaveLength(10);
    for (const icon of icons) expect(Object.keys(icon).sort()).toEqual(['android', 'name']);
  });

  it("leaves the icon changer's native module out of the iPhone app", () => {
    expect(pkg.expo?.autolinking?.ios?.exclude).toContain('expo-alternate-app-icons');
  });

  it("runs only the package's Android steps", () => {
    const plugin = createRequire(import.meta.url)('../plugins/withAndroidAppIcons.js') as (config: object, icons: unknown[]) => { mods?: Record<string, Record<string, unknown>> };
    const config = plugin({ name: 'LangQuest Next', slug: 'langquest-next' }, icons);
    expect(Object.keys(config.mods ?? {})).toEqual(['android']);
    expect(Object.keys(config.mods?.android ?? {})).toEqual(expect.arrayContaining(['manifest', 'dangerous']));
  });

  it("has an iPhone file for each of Android's, offering the same names", () => {
    expect(exportsOf('src/disguise/disguise.ios.ts')).toEqual(exportsOf('src/disguise/disguise.ts'));
    expect(exportsOf('src/disguise/DisguiseGate.ios.tsx')).toEqual(exportsOf('src/disguise/DisguiseGate.tsx'));
    expect(exportsOf('src/disguise/DisguiseRow.ios.tsx')).toEqual(exportsOf('src/disguise/DisguiseRow.tsx'));
  });

  it('brings in nothing of the disguise on an iPhone: no faces, looks, pictures or icon changer', () => {
    for (const file of ['src/disguise/disguise.ios.ts', 'src/disguise/DisguiseGate.ios.tsx', 'src/disguise/DisguiseRow.ios.tsx']) {
      const body = read(file);
      const imports = [...body.matchAll(/^import (?!type )[^;]*? from '([^']+)'/gm)].map((m) => m[1]);
      expect(imports, file).not.toEqual(expect.arrayContaining([expect.stringMatching(/faces|disguiseModel|^\.\/disguise$|assets\/disguise|^expo$/)]));
      expect(body, file).not.toMatch(/ExpoAlternateAppIcons|require\(/);
    }
  });

  it('clears what an older iPhone build kept, under the keys the phones write', () => {
    expect(read('src/disguise/disguise.ts')).toMatch(/import \{ CODE_KEY, LOOK_KEY, NOTES_KEY \} from '\.\/disguiseKeys'/);
    expect(read('src/disguise/disguise.ts')).not.toMatch(/'disguise-(look|notes|code)'/);
    const gate = read('src/disguise/DisguiseGate.ios.tsx');
    expect(gate).toMatch(/import \{ CODE_KEY, LOOK_KEY, NOTES_KEY \} from '\.\/disguiseKeys'/);
    for (const call of ['Storage.removeItemSync(LOOK_KEY)', 'Storage.removeItemSync(NOTES_KEY)', 'SecureStore.deleteItemAsync(CODE_KEY)']) expect(gate).toContain(call);
  });
});
