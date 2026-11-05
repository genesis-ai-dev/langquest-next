#!/usr/bin/env node
// Compare two decrypted env files by key and value, printing key names only.
//
//   node scripts/env-diff.mjs <repo.env> <eas.env>
//
// Exit 0 when they match, 1 when they differ. Used by scripts/eas-env.sh to
// show what a push would change and to catch edits made in the EAS dashboard.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const IGNORED = /^DOTENV_PUBLIC_KEY/;

function load(src) {
  const env = parseEnv(src);
  for (const key of Object.keys(env)) if (IGNORED.test(key)) delete env[key];
  return env;
}

/** Keys added, changed or only in `remote`, comparing `local` (the repo) to `remote` (EAS). */
export function diffEnv(localSrc, remoteSrc) {
  const local = load(localSrc);
  const remote = load(remoteSrc);
  const added = Object.keys(local).filter((k) => !(k in remote)).sort();
  const changed = Object.keys(local).filter((k) => k in remote && local[k] !== remote[k]).sort();
  const remoteOnly = Object.keys(remote).filter((k) => !(k in local)).sort();
  return { added, changed, remoteOnly };
}

function main() {
  const [localPath, remotePath] = process.argv.slice(2);
  const { added, changed, remoteOnly } = diffEnv(readFileSync(localPath, 'utf8'), readFileSync(remotePath, 'utf8'));
  for (const k of added) console.log(`  + ${k}  (in the repo, not yet in EAS)`);
  for (const k of changed) console.log(`  ~ ${k}  (value differs; the repo wins on push)`);
  for (const k of remoteOnly) console.log(`  ! ${k}  (only in EAS: add it to the repo file, or delete it in EAS)`);
  process.exit(added.length + changed.length + remoteOnly.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
