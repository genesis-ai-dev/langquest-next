// Create the R2 buckets apps/web/wrangler.jsonc binds, for one hosted
// environment, when they do not exist yet (decisions.md 69). Safe to run
// again: a bucket that exists is left as it is. Buckets are private: no
// public access and no r2.dev address is ever turned on here, and the
// Worker is the only way in. The location hint is Eastern North America,
// beside the Supabase project (us-east-2).
//
//   node scripts/r2-buckets.mjs preview
//   node scripts/r2-buckets.mjs production
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { authArgs } from './cloudflare-deploy.mjs';
import { HOSTED, parseJsonc, root, wranglerFor } from './env-files.mjs';

export const LOCATION = 'enam';
const CONFIG = 'apps/web/wrangler.jsonc';

/** The bucket names one environment's Worker binds. */
export function bucketsFor(config, environment) {
  return (wranglerFor(config, environment).r2_buckets ?? []).map((b) => b.bucket_name);
}

function wrangler(args) {
  return spawnSync('npx', ['wrangler', ...args, ...authArgs()], { cwd: root, encoding: 'utf8' });
}

function main() {
  const environment = process.argv[2];
  if (!HOSTED.includes(environment)) {
    console.error(`usage: node scripts/r2-buckets.mjs <${HOSTED.join('|')}>`);
    process.exit(2);
  }
  const config = parseJsonc(readFileSync(join(root, CONFIG), 'utf8'));
  const wanted = bucketsFor(config, environment);
  const listed = wrangler(['r2', 'bucket', 'list']);
  if (listed.status !== 0) {
    console.error(listed.stderr || 'x wrangler r2 bucket list failed');
    process.exit(1);
  }
  const have = new Set([...listed.stdout.matchAll(/^name:\s+(\S+)/gm)].map((m) => m[1]));
  for (const name of wanted) {
    if (have.has(name)) {
      console.log(`= ${name} exists`);
      continue;
    }
    const made = wrangler(['r2', 'bucket', 'create', name, '--location', LOCATION]);
    if (made.status !== 0) {
      console.error(made.stderr || `x could not create ${name}`);
      process.exit(1);
    }
    console.log(`+ ${name} created (${LOCATION})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
