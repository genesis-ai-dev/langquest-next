import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASELINES, reportFor, scorePairs } from '../packages/core/src/keyTermEval';
import { loadSet } from './key-term-eval';

/** Why: the evaluation script must read a set the way eval/key-terms/README.md says, and refuse a broken one before it reports anything. */
function wav(n: number): Buffer {
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

function folder(manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'kt-eval-'));
  mkdirSync(join(dir, 'terms')); mkdirSync(join(dir, 'passages'));
  for (const f of ['terms/a-1.wav', 'terms/b-1.wav', 'passages/p1.wav', 'passages/p2.wav']) writeFileSync(join(dir, f), wav(160));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

describe('key-term evaluation set', () => {
  const manifest = {
    language: 'Test',
    terms: [{ termId: 'a', examples: ['terms/a-1.wav'] }, { termId: 'b', examples: ['terms/b-1.wav'] }],
    passages: [{ id: 'p1', file: 'passages/p1.wav', heard: ['a'] }, { id: 'p2', file: 'passages/p2.wav', heard: ['b'] }]
  };

  it('is read from its folder and measured against the baselines', async () => {
    const set = loadSet(folder(manifest));
    expect(set.terms.map((t) => t.termId)).toEqual(['a', 'b']);
    expect(set.passages[0]!.clip).toMatchObject({ sampleRate: 16000 });
    expect(set.passages[0]!.clip.samples).toHaveLength(160);
    const always = reportFor(BASELINES[0]!, await scorePairs(BASELINES[0]!, set), 0.5);
    expect(always.overall).toMatchObject({ recall: 1, precision: 0.5 });
  });

  it('refuses a manifest that cannot measure anything, naming the file', () => {
    expect(() => loadSet(folder({ ...manifest, passages: [] }))).toThrow(/manifest\.json: The manifest needs at least one passage/);
  });
});
