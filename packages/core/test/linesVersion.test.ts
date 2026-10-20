import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LINES_VERSION } from '../src/passageLines';

/**
 * Why: a phone part-way through filling in a big language shows the
 * server's line for a passage whose rows have not arrived (decisions.md
 * 147), and takes server lines only of its own `LINES_VERSION`. So the
 * server's line and the phone's must be the same code's answer: when
 * `passage.ts` or `passageLines.ts` changes, this fails until someone says
 * whether what a line says changed (bump `LINES_VERSION`, and the next pass
 * writes every language's lines again) or not (record the new hash only).
 * The worker bundle is held to its source the same way.
 */
const SOURCES = ['../src/passage.ts', '../src/passageLines.ts'];

function sourceHash(): string {
  const hash = createHash('sha256');
  for (const file of SOURCES) hash.update(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/\r\n/g, '\n'));
  return hash.digest('hex').slice(0, 16);
}

describe('LINES_VERSION', () => {
  it('is bumped, or its hash recorded again, whenever passage.ts or passageLines.ts changes', () => {
    expect({ version: LINES_VERSION, hash: sourceHash() }).toEqual({ version: 1, hash: '4fc8335031ad62d7' });
  });
});
