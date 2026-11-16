#!/usr/bin/env node
// Sets one key in an env file, with the value read from stdin, so the value is
// never an argument: `npx` writes its arguments to npm's debug log on disk
// (~/.npm/_logs), and any process can read a running program's arguments
// (security review, 2026-11-10). env-update.sh is its only caller.
//
//   printf '%s' "$value" | node scripts/dotenvx-set.mjs KEY .env.production secret
//   printf '%s' "$value" | node scripts/dotenvx-set.mjs KEY apps/mobile/.env.preview public
//
// A secret is encrypted with the public key in the file and its private key in
// .env.keys, as `dotenvx set -fk .env.keys` does; a public value goes in plain.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { set } = require('@dotenvx/dotenvx');

const [key, file, kind] = process.argv.slice(2);
if (!key || !file || (kind !== 'secret' && kind !== 'public')) {
  console.error('usage: printf %s "$value" | node scripts/dotenvx-set.mjs KEY FILE secret|public');
  process.exit(2);
}

let value = '';
for await (const chunk of process.stdin) value += chunk;
if (!value) {
  console.error(`x empty value for ${key}`);
  process.exit(1);
}

const result = await set(key, value, {
  path: file,
  envKeysFile: '.env.keys',
  plain: kind === 'public',
  noNative: true,
  quiet: true
});
value = '';
const failed = result.processedEnvs.filter((e) => e.error);
if (failed.length > 0) {
  // The error's own words, which name the key and file, never the value.
  for (const e of failed) console.error(`x ${key} not set in ${file}: ${e.error.message}`);
  process.exit(1);
}
