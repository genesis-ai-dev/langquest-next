// Make a hosted Supabase project's secrets match supabase/.env.<environment>
// (docs/environments.md). The GitHub integration deploys migrations and
// functions but not secrets, so this is the one way they get there.
//
//   npm run supabase:secrets -- preview            show what differs (names only), ask, apply
//   npm run supabase:secrets -- production --check exit 1 if anything differs
//   npm run supabase:secrets -- preview --yes      apply without asking
//
// It sets the Edge Function secrets, the two Vault secrets the projection
// cron job reads, and (re)schedules that job (server/schedule-projections.sql).
// Every step is idempotent. It compares SHA-256 digests and prints no value.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { decrypt, envKeyNames, envPath, publicKey, root } from './env-files.mjs';

/** Edge Function secrets, read with Deno.env.get in supabase/functions. */
export const FUNCTION_SECRETS = ['INVITE_RELAY_URL', 'INVITE_RELAY_SECRET', 'PROJECTION_WORKER_SECRET'];
/** Keys the file holds for scripts on a laptop; never pushed. */
export const LOCAL_KEYS = ['SUPABASE_PROJECT_REF', 'DIAG_DATABASE_URL'];
export const CRON_JOB = 'langquest-project-projections';

/** Vault secret name to value, as server/schedule-projections.sql reads them. */
export function vaultSecrets(env) {
  return {
    langquest_project_url: `https://${env.SUPABASE_PROJECT_REF}.supabase.co`,
    langquest_projection_worker_secret: env.PROJECTION_WORKER_SECRET
  };
}

export const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** SQL that creates or updates each Vault secret by name. */
export function vaultSql(secrets) {
  return Object.entries(secrets).map(([name, value]) => `do $$
declare existing uuid;
begin
  select id into existing from vault.secrets where name = ${literal(name)};
  if existing is null then
    perform vault.create_secret(${literal(value)}, ${literal(name)});
  else
    perform vault.update_secret(existing, ${literal(value)});
  end if;
end $$;`).join('\n');
}

/** SQL returning each named Vault secret's digest, never its value. */
export function vaultDigestSql(names) {
  return `select name, encode(sha256(convert_to(decrypted_secret, 'utf8')), 'hex') as digest
from vault.decrypted_secrets where name in (${names.map(literal).join(', ')});`;
}

/**
 * Keys in the file this script does not know. Each key must be a function
 * secret or a local key, so nothing is pushed, or skipped, by accident.
 */
export function unknownKeys(names) {
  return names.filter((name) => !FUNCTION_SECRETS.includes(name) && !LOCAL_KEYS.includes(name));
}

/**
 * Per name: 'same', 'differs' or 'missing', comparing wanted values with
 * hosted digests.
 * @param {Record<string, string>} wanted
 * @param {Record<string, string>} hostedDigests
 */
export function drift(wanted, hostedDigests) {
  return Object.fromEntries(Object.entries(wanted).map(([name, value]) => {
    const hosted = hostedDigests[name];
    return [name, hosted === undefined ? 'missing' : hosted === digest(value) ? 'same' : 'differs'];
  }));
}

function supabase(args, { json = false } = {}) {
  const result = spawnSync('npx', ['supabase', ...args], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || '').trim() || `supabase ${args[0]} failed`);
  return json ? JSON.parse(result.stdout) : result.stdout;
}

function query(ref, sql) {
  const dir = mkdtempSync(join(tmpdir(), 'lq-sql-'));
  try {
    const file = join(dir, 'q.sql');
    writeFileSync(file, sql, { mode: 0o600 });
    return supabase(['db', 'query', '--project-ref', ref, '--output-format', 'json', '-f', file], { json: true }).rows ?? [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function hostedState(ref) {
  const listed = supabase(['secrets', 'list', '--project-ref', ref, '-o', 'json'], { json: true });
  const functionDigests = Object.fromEntries(listed.map((s) => [s.name, s.value ?? s.digest]));
  const vaultDigests = Object.fromEntries(
    query(ref, vaultDigestSql(Object.keys(vaultSecrets({})))).map((r) => [r.name, r.digest]));
  const scheduled = query(ref, `select jobname from cron.job where jobname = ${literal(CRON_JOB)};`).length > 0;
  return { functionDigests, vaultDigests, scheduled };
}

function report(label, states) {
  for (const [name, state] of Object.entries(states)) {
    const mark = state === 'same' ? '✓' : state === 'missing' ? '+' : '~';
    console.log(`  ${mark} ${label} ${name}${state === 'same' ? '' : ` (${state})`}`);
  }
}

async function main() {
  const [environment, flag] = process.argv.slice(2);
  if (environment !== 'preview' && environment !== 'production') {
    console.error('usage: npm run supabase:secrets -- <preview|production> [--check|--yes]');
    process.exit(2);
  }
  const file = envPath('supabase', environment);
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    console.error(`x ${file} does not exist. Fill it with: npm run env:update -- ${environment} supabase KEY`);
    process.exit(1);
  }
  const mobileKey = publicKey(readFileSync(join(root, envPath('mobile', environment)), 'utf8'), environment);
  if (publicKey(text, environment) !== mobileKey) {
    console.error(`x ${file} is not encrypted with the ${environment} key (docs/environments.md, re-keying).`);
    process.exit(1);
  }
  const unknown = unknownKeys(envKeyNames(text));
  if (unknown.length) {
    console.error(`x ${file} holds ${unknown.join(', ')}, which scripts/supabase-secrets.mjs does not list as a function secret or a local key.`);
    process.exit(1);
  }
  const env = decrypt(file, ['SUPABASE_PROJECT_REF', ...FUNCTION_SECRETS]);
  const missing = ['SUPABASE_PROJECT_REF', ...FUNCTION_SECRETS].filter((name) => !env[name]);
  if (missing.length) {
    console.error(`x ${file} is missing ${missing.join(', ')}.`);
    for (const name of missing) console.error(`  npm run env:update -- ${environment} supabase ${name}`);
    process.exit(1);
  }
  const relay = decrypt(envPath('invite-email', environment), ['INVITE_RELAY_SECRET']).INVITE_RELAY_SECRET;
  if (relay !== env.INVITE_RELAY_SECRET) {
    console.error(`x INVITE_RELAY_SECRET differs between ${file} and ${envPath('invite-email', environment)}; set the same value in both.`);
    process.exit(1);
  }

  const ref = env.SUPABASE_PROJECT_REF;
  const functions = Object.fromEntries(FUNCTION_SECRETS.map((name) => [name, env[name]]));
  const vault = vaultSecrets(env);
  const before = hostedState(ref);
  const functionDrift = drift(functions, before.functionDigests);
  const vaultDrift = drift(vault, before.vaultDigests);
  console.log(`Comparing ${file} with project ${ref}:`);
  report('function secret', functionDrift);
  report('vault secret', vaultDrift);
  console.log(`  ${before.scheduled ? '✓' : '+'} cron job ${CRON_JOB}${before.scheduled ? '' : ' (missing)'}`);
  const changed = [...Object.values(functionDrift), ...Object.values(vaultDrift)].some((s) => s !== 'same') || !before.scheduled;
  if (!changed) {
    console.log(`✓ ${environment} secrets match the repo`);
    return;
  }
  if (flag === '--check') process.exit(1);
  if (flag !== '--yes') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Apply to the ${environment} project ${ref}? [y/N] `);
    rl.close();
    if (!/^y$/i.test(answer.trim())) {
      console.log('Nothing applied.');
      process.exit(1);
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'lq-secrets-'));
  try {
    const envFile = join(dir, 'functions.env');
    writeFileSync(envFile, Object.entries(functions).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n', { mode: 0o600 });
    supabase(['secrets', 'set', '--project-ref', ref, '--env-file', envFile]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  query(ref, vaultSql(vault));
  // cron.schedule replaces a job of the same name, so this is safe to repeat.
  query(ref, readFileSync(join(root, 'server/schedule-projections.sql'), 'utf8'));

  const after = hostedState(ref);
  const left = [
    ...Object.entries(drift(functions, after.functionDigests)),
    ...Object.entries(drift(vault, after.vaultDigests))
  ].filter(([, state]) => state !== 'same').map(([name]) => name);
  if (!after.scheduled) left.push(CRON_JOB);
  if (left.length) {
    console.error(`x applied, but these still differ: ${left.join(', ')}`);
    process.exit(1);
  }
  console.log(`✓ ${environment} project ${ref} matches ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`x ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
