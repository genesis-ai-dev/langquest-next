/**
 * Hash each chapter of the BSB read by Frederick Surrey (`npm run library:bsb-audio`).
 *
 *   npm run library:bsb-audio -- [--bsb-text <file>] [--out <file>]
 *
 * Downloads every chapter's MP3 from openbible.com once, hashes it and keeps
 * only its SHA-256 and size in `library/bsb-audio.json` (never the audio).
 * The library seed then names each chapter by hash as well as by address
 * (`scripts/sources-seed.ts`), so a phone checks what it downloads and may
 * pass a chapter on to a teammate's phone
 * (docs/decisions/2026-11-24-library-files-move-between-teammates-as-reference-files.md).
 * Run it again to fill what an earlier run missed: chapters already in the
 * file are not fetched again. About 1,189 chapters and 5 GB of downloads.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { bookOrder } from '@langquest-next/core';
import { BSB_AUDIO_HASHES, bsbAudioUrl, loadBsbText, parseBsbText, readBsbAudio } from './sources-seed';

const AT_ONCE = 4;

async function main(argv: string[]) {
  const value = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []))[0];
  const out = value('out') ?? BSB_AUDIO_HASHES;
  const text = parseBsbText(await loadBsbText(value('bsb-text')));
  const have = new Map(existsSync(out) ? readBsbAudio(JSON.parse(readFileSync(out, 'utf8'))) : []);
  const todo = [...text].flatMap(([book, chapters]) => [...chapters.keys()].map((chapter) => ({ book, chapter })))
    .filter(({ book, chapter }) => !have.has(`${book}.${chapter}`));
  console.log(`bsb audio: ${have.size} chapters hashed, ${todo.length} to fetch`);
  const save = () => {
    const sorted = [...have].sort(([a], [b]) => {
      const [ab, ac] = a.split('.'); const [bb, bc] = b.split('.');
      return bookOrder(ab!) - bookOrder(bb!) || Number(ac) - Number(bc);
    });
    writeFileSync(out, JSON.stringify(Object.fromEntries(sorted), null, 1) + '\n');
  };
  let failed = 0;
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const { book, chapter } = todo[i]!;
      const url = bsbAudioUrl(book, chapter);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        have.set(`${book}.${chapter}`, { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength });
      } catch (e) {
        failed++;
        console.warn(`  ${book} ${chapter}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (have.size % 25 === 0) save();
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  save();
  console.log(`bsb audio: ${have.size} chapters hashed${failed ? `, ${failed} failed (run again to retry them)` : ''}, in ${out}`);
  if (failed) process.exitCode = 1;
}

void main(process.argv.slice(2));
