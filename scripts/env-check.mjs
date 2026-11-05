#!/usr/bin/env node
// Fails when an env file git would commit holds a secret in plaintext, or a
// key in the wrong file (docs/environments.md).
//
//   npm run env:check
//
// Public settings (`EXPO_PUBLIC_*`, which the app bundle carries anyway) are
// plain and live only in apps/mobile/.env.*. Everything else is a secret,
// encrypted with dotenvx, and lives only in the root .env.<environment>.
// `.env.example` documents names only and is skipped. Ignored files
// (`.env.keys`, `*.local`) are never checked because git never sees them.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = /^\.env(\..+)?$/;
const SKIP = new Set(['.env.example', '.env.keys']);

const isPublic = (key) => key.startsWith('EXPO_PUBLIC_');

/** Keys in `src` that are not public and whose values are neither empty nor dotenvx-encrypted. */
export function plaintextKeys(src) {
  const keys = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (key.startsWith('DOTENV_PUBLIC_KEY') || isPublic(key)) continue;
    const value = rawValue.replace(/^(['"`])(.*)\1$/, '$2');
    if (value === '' || value.startsWith('encrypted:')) continue;
    keys.push(key);
  }
  return keys;
}

/** Keys in the wrong file: secrets under apps/mobile (EAS and the bundle get those files), public keys elsewhere. */
export function misplacedKeys(file, src) {
  const app = file.startsWith('apps/mobile/');
  return [...src.matchAll(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1])
    .filter((key) => !key.startsWith('DOTENV_') && isPublic(key) !== app);
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
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const key of plaintextKeys(src)) {
      console.error(`x ${file}: ${key} is not encrypted. Run: npm run env:update -- <environment> ${key}`);
      bad++;
    }
    for (const key of misplacedKeys(file, src)) {
      console.error(`x ${file}: ${key} belongs in ${key.startsWith('EXPO_PUBLIC_') ? 'apps/mobile/.env.<environment>' : 'the root .env.<environment>'} (docs/environments.md).`);
      bad++;
    }
  }
  if (bad) process.exit(1);
  console.log('✓ every committed secret is encrypted and in its place');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
