/** Mirror the bounded Jonah pilot; no credentials or audio enter the repo. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  SOURCE_BIBLES, sourceAudioFile, sourceAudioUrl, sourceChapters
} from '../packages/core/src/sourceBibles';

const upload = process.argv.includes('--upload');
const bucket = 'langquest-source-bibles';
const directory = await mkdtemp(join(tmpdir(), 'langquest-sources-'));
const manifest: object[] = [];
try {
  for (const bible of SOURCE_BIBLES) {
    for (const chapter of sourceChapters('book@1/jon')) {
      const url = sourceAudioUrl(bible, chapter);
      const file = sourceAudioFile(bible, chapter);
      const path = join(directory, file);
      execFileSync('curl', ['--fail', '--silent', '--show-error',
        '--location', '--retry', '3', '--max-time', '120',
        '--output', path, url], { stdio: 'inherit' });
      const bytes = await readFile(path);
      const hasMp3Header = bytes.subarray(0, 3).toString() === 'ID3' ||
        (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
      if (!hasMp3Header || bytes.length < 1000) {
        throw new Error(`Not an MP3: ${url}`);
      }
      const key = `${bible.id}/${file}`;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (upload) {
        execFileSync('npx', ['wrangler', 'r2', 'object', 'put',
          `${bucket}/${key}`, '--file', path, '--remote',
          '--content-type', 'audio/mpeg', '--cache-control', 'public, max-age=86400'],
        { stdio: 'inherit', env: { ...process.env,
          CLOUDFLARE_ACCOUNT_ID: '6a80496d1e59948a9cbaa3c643ba81d7',
          WRANGLER_LOG_PATH: join(directory, 'wrangler.log') } });
      }
      manifest.push({ key, source: url, bytes: bytes.length, sha256,
        license: 'CC0-1.0', narrator: bible.narrator });
      console.log(`${upload ? 'Uploaded' : 'Verified'} ${key}`);
    }
  }
  // Store provenance next to the public domain files for repeatable verification.
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (upload) {
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put',
      `${bucket}/manifest.json`, '--file', manifestPath, '--remote',
      '--content-type', 'application/json'], { stdio: 'inherit', env: {
      ...process.env, CLOUDFLARE_ACCOUNT_ID: '6a80496d1e59948a9cbaa3c643ba81d7',
      WRANGLER_LOG_PATH: join(directory, 'wrangler.log')
    } });
  }
  console.log(await readFile(manifestPath, 'utf8'));
} finally {
  await rm(directory, { recursive: true, force: true });
}
