import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What react-native-web says on the console of `npm run app:web`, held at the
 * source: the rendered checks run on the release export, where the style
 * validator and these warnings are off, so a dev build is the only place
 * they would show.
 */
const SRC = join(__dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
});
const all = [...files(SRC), join(SRC, '..', 'App.tsx')];
const matching = (pattern: RegExp) => all.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f));

describe('the web console of a dev build', () => {
  it("a view's direction goes through alwaysLtr: on web the dev validator deletes `direction`", () => {
    expect(matching(/\bdirection:\s*'(ltr|rtl)'/)).toEqual(['ui/alwaysLtr.ts']);
  });

  it('pointerEvents goes through touches: the prop is deprecated, and an inline box-none reaches the browser as invalid CSS', () => {
    expect(matching(/<[\w.]+[^>]*\spointerEvents=/)).toEqual([]);
    expect(matching(/\{\s*pointerEvents:/)).toEqual(['ui/touches.ts']);
  });

  it('the shell does not ask for hardware Back on web, which has none', () => {
    expect(readFileSync(join(SRC, 'shell/useRootBack.ts'), 'utf8')).toMatch(/Platform\.OS === 'web'\) return;\s+const sub = BackHandler\.addEventListener/);
  });

  it('helps.tsx does not import reference.tsx, which imports it', () => {
    expect(readFileSync(join(SRC, 'helps/helps.tsx'), 'utf8')).not.toMatch(/from '\.\/reference'/);
  });
});
