// The public keys phones trust for nearby sync (docs/nearby-sync-plan.md 5.12),
// in their two public homes: NEARBY_CERT_KEYS in apps/web/wrangler.jsonc (top
// level for production, env.preview for preview) and EXPO_PUBLIC_NEARBY_CERT_KEYS
// in apps/mobile/.env.<env>. Both are `kid:base64url,...` and must be equal
// (nearbyCertKeys.test.ts). A rotation appends, so phones built before it keep
// trusting chains signed with the old key, and a retired kid stays listed.
//
//   node scripts/nearby-cert-keys.mjs <preview|production> <kid:base64url>
//
// writes the longer list into wrangler.jsonc and prints it, for
// scripts/nearby-signing-key.sh to set in the app's file with env:update. Only
// public keys pass through here.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseJsonc, wranglerFor } from './env-files.mjs';

export const WRANGLER = 'apps/web/wrangler.jsonc';
export const appEnvFile = (environment) => `apps/mobile/.env.${environment}`;
export const APP_KEY = 'EXPO_PUBLIC_NEARBY_CERT_KEYS';
export const WORKER_VAR = 'NEARBY_CERT_KEYS';

const ENTRY = /^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{43}$/;

/** The entries of a list, refusing one that is not `kid:key`. */
export function certKeyEntries(list) {
  const entries = (list ?? '').split(',').map((e) => e.trim()).filter(Boolean);
  for (const entry of entries) if (!ENTRY.test(entry)) throw new Error(`not a kid:key entry: ${entry.slice(0, 80)}`);
  return entries;
}

/** The list with one more key; its kid must be new. */
export function appendCertKey(list, entry) {
  const entries = certKeyEntries(list);
  certKeyEntries(entry);
  const kid = entry.slice(0, entry.indexOf(':'));
  if (entries.some((e) => e.startsWith(`${kid}:`))) throw new Error(`kid ${kid} is already listed`);
  return [...entries, entry].join(',');
}

/** The app's list in one of its plain env files; '' when the file has none yet. */
export function appCertKeys(envText) {
  const m = new RegExp(`^${APP_KEY}=(.*)$`, 'm').exec(envText);
  return m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2') : '';
}

/** The Worker's list for one environment. */
export const workerCertKeys = (wranglerText, environment) => wranglerFor(parseJsonc(wranglerText), environment).vars?.[WORKER_VAR] ?? '';

/**
 * wrangler.jsonc with one environment's list replaced, comments kept. The
 * production list is the first `"NEARBY_CERT_KEYS"` and preview's the second;
 * the result is read back to be sure the right one changed.
 */
export function withWorkerCertKeys(wranglerText, environment, list) {
  certKeyEntries(list);
  const pattern = new RegExp(`"${WORKER_VAR}":\\s*"[^"]*"`, 'g');
  const found = [...wranglerText.matchAll(pattern)];
  if (found.length !== 2) throw new Error(`${WRANGLER} should name ${WORKER_VAR} twice (production, then preview); it names it ${found.length} times`);
  const at = found[environment === 'production' ? 0 : 1];
  const out = `${wranglerText.slice(0, at.index)}"${WORKER_VAR}": "${list}"${wranglerText.slice(at.index + at[0].length)}`;
  const other = environment === 'production' ? 'preview' : 'production';
  if (workerCertKeys(out, environment) !== list || workerCertKeys(out, other) !== workerCertKeys(wranglerText, other)) {
    throw new Error(`could not place ${WORKER_VAR} for ${environment} in ${WRANGLER}`);
  }
  return out;
}

function main([environment, entry]) {
  if (environment !== 'preview' && environment !== 'production') throw new Error('usage: node scripts/nearby-cert-keys.mjs <preview|production> <kid:base64url>');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const wranglerText = readFileSync(`${root}${WRANGLER}`, 'utf8');
  const app = appCertKeys(readFileSync(`${root}${appEnvFile(environment)}`, 'utf8'));
  const worker = workerCertKeys(wranglerText, environment);
  if (app !== worker) throw new Error(`${appEnvFile(environment)} and ${WRANGLER} list different nearby keys for ${environment}; put them right before adding one`);
  const list = appendCertKey(worker, entry);
  writeFileSync(`${root}${WRANGLER}`, withWorkerCertKeys(wranglerText, environment, list));
  process.stdout.write(`${list}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`x ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
