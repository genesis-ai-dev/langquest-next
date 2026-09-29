#!/usr/bin/env node
// Fails when an env file git would commit holds a plaintext value.
//
//   npm run env:check
//
// Env files are committed encrypted with dotenvx; only the public key header
// and empty values may be plain. `.env.example` documents names only and is
// skipped. Ignored files (`.env.keys`, `*.local`) are never checked because
// git never sees them.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = /^\.env(\..+)?$/;
const SKIP = new Set(['.env.example', '.env.keys']);

/** Keys in `src` whose values are neither empty nor dotenvx-encrypted. */
export function plaintextKeys(src) {
  const keys = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (key.startsWith('DOTENV_PUBLIC_KEY')) continue;
    const value = rawValue.replace(/^(['"`])(.*)\1$/, '$2');
    if (value === '' || value.startsWith('encrypted:')) continue;
    keys.push(key);
  }
  return keys;
}

/** Env files git tracks or would add, relative to the repository root. */
export function committableEnvFiles(cwd) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd, encoding: 'utf8' });
  return out.split('\n').filter((f) => {
    const name = basename(f);
    return ENV_FILE.test(name) && !SKIP.has(name);
  });
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  let bad = 0;
  for (const file of committableEnvFiles(root)) {
    const keys = plaintextKeys(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    for (const key of keys) {
      console.error(`x ${file}: ${key} is not encrypted. Run: npm run env:set -- ${key} <value> -f ${file}`);
      bad++;
    }
  }
  if (bad) process.exit(1);
  console.log('✓ every committed env value is encrypted');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
