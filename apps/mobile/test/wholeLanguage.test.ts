import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { PASSAGE_PARTS, READS_EVERY_PASSAGE } from '@langquest-next/core';
// @ts-expect-error: a plain ESM module of the lint config, without types.
import wholeLanguage, { ALLOWED, PASSAGE_MAPS, READS_EVERY_PASSAGE as LINT_EVERY } from '../../../scripts/lint/wholeLanguage.mjs';

/**
 * A language kept on disk (decisions.md 143) holds in memory only the
 * passages a screen has open, and the app never reads every passage from
 * memory. Lint holds that (`whole-language/no-every-passage`, in
 * scripts/lint/wholeLanguage.mjs); this test holds the rule to core: its
 * lists are core's, so a map or an answer added to core is caught too, and
 * the rule catches what it is for.
 */
const APP = join(__dirname, '..');

function lint(code: string, file = 'src/feature/thing.ts') {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(code, [{
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser as Linter.Parser },
    plugins: { 'whole-language': wholeLanguage },
    rules: { 'whole-language/no-every-passage': 'error' }
  }], { filename: join(APP, file) }).map((m) => m.message.split(':')[0]);
}

describe('the app never reads every passage from memory (decisions.md 143)', () => {
  it("lint's lists are core's", () => {
    expect([...PASSAGE_MAPS].sort()).toEqual(PASSAGE_PARTS.map((p) => p.map).sort());
    expect([...LINT_EVERY].sort()).toEqual([...READS_EVERY_PASSAGE].sort());
  });

  it('every file the rule allows exists, and says why', () => {
    for (const [file, a] of Object.entries(ALLOWED as Record<string, { reads: string[]; why: string }>)) {
      expect(existsSync(join(APP, file)), file).toBe(true);
      expect(a.why.length, file).toBeGreaterThan(10);
    }
  });

  it('catches a loop over passage records, however written, and an import of an answer about every passage', () => {
    expect(lint('Object.values(state.recordings);')).toEqual(['recordings reads every passage']);
    expect(lint('Object.entries(s?.takes ?? {});')).toEqual(['takes reads every passage']);
    expect(lint('for (const id in state.notes!) {}')).toEqual(['notes reads every passage']);
    expect(lint("import { languageLines } from '@langquest-next/core';")).toEqual(['languageLines reads every passage']);
    // Types are fine, and so are maps that are not passage records.
    expect(lint("import { type languageLines } from '@langquest-next/core'; import type { upNext } from '@langquest-next/core';")).toEqual([]);
    expect(lint('Object.values(state.units); Object.keys(other.recordings[id]);')).toEqual([]);
  });

  it('lets a listed file read what it is listed for, and only that, and says when a listed read is gone', () => {
    expect(lint("import { usualTarget } from '@langquest-next/core';", 'src/passage/sendTarget.ts')).toEqual([]);
    expect(lint("import { usualTarget, upNext } from '@langquest-next/core';", 'src/passage/sendTarget.ts')).toEqual(['upNext reads every passage']);
    expect(lint('export const x = 1;', 'src/passage/sendTarget.ts')[0]).toMatch(/ALLOWED lists this file as reading usualTarget, and it no longer does/);
  });
});
