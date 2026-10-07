// Put one hosted environment's secrets where they are used
// (docs/environments.md). Deploys never carry secrets; this is the one way
// they reach Cloudflare and Supabase, run by a person when a secret changes.
//
//   npm run secrets -- preview             compare (names only), ask, apply
//   npm run secrets -- production --check  exit 1 if anything is missing or differs
//   npm run secrets -- preview --yes       apply without asking
//
// Sources: the encrypted .env.<env> at the repository root, the project ref
// in supabase/config.toml [remotes.<env>], and the project's service-role key,
// read from Supabase each time rather than stored. Destinations: each
// Worker's secrets, the Edge Function secrets, the two Vault secrets the
// projection cron job reads, and that job itself (by running its
// scheduling migration again). Every step is idempotent.
// Supabase values are compared by SHA-256 digest; Worker secrets cannot be
// read back, so only their presence is compared and apply always sets them.
// Nothing is printed but names.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { authArgs, targetArgs } from './cloudflare-deploy.mjs';
import { HOSTED, decrypt, envKeyNames, parseJsonc, projectRef, root, secretsPath } from './env-files.mjs';

/** Keys .env.<env> may hold. DIAG_DATABASE_URL is read on a laptop (npm run diag -- --hosted), never pushed. */
export const FILE_KEYS = ['INVITE_RELAY_SECRET', 'PROJECTION_WORKER_SECRET', 'DIAG_DATABASE_URL', 'BIBLE_BRAIN_ACCESS_KEY'];
export const REQUIRED_KEYS = ['INVITE_RELAY_SECRET', 'PROJECTION_WORKER_SECRET'];
/**
 * Placed when the file has them, never required: the Worker answers without
 * them (the Bible routes say 503), so neither a deploy nor this script waits
 * for one. Not in the Worker's `secrets.required` for the same reason.
 */
export const OPTIONAL_KEYS = ['BIBLE_BRAIN_ACCESS_KEY'];

export const WORKERS = {
  dashboard: 'apps/web/wrangler.jsonc',
  'invite-email': 'apps/invite-email/wrangler.jsonc'
};

/** The account's workers.dev subdomain, where the invite-email Workers answer. */
export const WORKERS_SUBDOMAIN = 'blue-darkness-7674';
const inviteEmailName = parseJsonc(readFileSync(join(root, WORKERS['invite-email']), 'utf8')).name;
export const relayUrl = (environment) =>
  `https://${inviteEmailName}${environment === 'production' ? '' : `-${environment}`}.${WORKERS_SUBDOMAIN}.workers.dev/send-invite`;

export const CRON_JOB = 'langquest-stream-projections';
/** Schedules CRON_JOB where the Vault secrets exist; safe to run again (decision 42). */
export const SCHEDULE_MIGRATION = 'supabase/migrations/20261006000001_schedule_projections.sql';

/** Every secret, by where it goes. */
export function destinations(environment, values, ref, serviceRoleKey) {
  return {
    workers: {
      dashboard: {
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        ...(values.BIBLE_BRAIN_ACCESS_KEY ? { BIBLE_BRAIN_ACCESS_KEY: values.BIBLE_BRAIN_ACCESS_KEY } : {})
      },
      'invite-email': { INVITE_RELAY_SECRET: values.INVITE_RELAY_SECRET }
    },
    // Read with Deno.env.get in supabase/functions. The relay URL is public
    // but has no other way into a function.
    functions: {
      INVITE_RELAY_URL: relayUrl(environment),
      INVITE_RELAY_SECRET: values.INVITE_RELAY_SECRET,
      PROJECTION_WORKER_SECRET: values.PROJECTION_WORKER_SECRET
    },
    // Read by the projection job (SCHEDULE_MIGRATION).
    vault: {
      langquest_project_url: `https://${ref}.supabase.co`,
      langquest_projection_worker_secret: values.PROJECTION_WORKER_SECRET
    }
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

/** Keys in the file this script does not know, so nothing is skipped by accident. */
export const unknownKeys = (names) => names.filter((name) => !FILE_KEYS.includes(name));

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

/** The useful part of a failed command's output: npm's notices dropped, a JSON error's message pulled out. */
export function failure(stdout, stderr) {
  const lines = `${stderr ?? ''}\n${stdout ?? ''}`.split('\n')
    .filter((line) => line.trim() && !line.startsWith('npm notice'));
  const messages = lines.map((line) => {
    try { return JSON.parse(line)?.error?.message ?? line; } catch { return line; }
  });
  return messages.join('\n').trim();
}

function run(cmd, args) {
  const result = spawnSync('npx', [cmd, ...args], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(failure(result.stdout, result.stderr) || `${cmd} ${args[0]} failed`);
  return result.stdout;
}

/** Run fn with a private temp file holding `content`, removed afterwards. */
function withTempFile(name, content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'lq-secrets-'));
  try {
    const file = join(dir, name);
    writeFileSync(file, content, { mode: 0o600 });
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Rows from `db query` JSON: a plain array, or `{ rows }` when the CLI thinks an agent is running it. */
export const queryRows = (output) => (Array.isArray(output) ? output : output?.rows ?? []);

// `db query` reaches a hosted project only as the linked one; main() checks
// the link is the target before anything runs. `--agent no` keeps its output
// the same whoever runs it.
const query = (ref, sql) => withTempFile('q.sql', sql, (file) => queryRows(JSON.parse(
  run('supabase', ['db', 'query', '--linked', '--project-ref', ref, '--output-format', 'json', '--agent', 'no', '-f', file]))));

function workerSecretNames(config, environment) {
  try {
    const listed = JSON.parse(run('wrangler', ['secret', 'list', ...targetArgs(config, environment), '--format', 'json', ...authArgs()]));
    return listed.map((s) => s.name);
  } catch {
    // Most often a Worker that does not exist yet, which has no secrets;
    // `secret bulk` creates it. Any other failure shows again when applying.
    return [];
  }
}

function hostedState(environment, ref, wanted) {
  const listed = JSON.parse(run('supabase', ['secrets', 'list', '--project-ref', ref, '-o', 'json']));
  const functionDigests = Object.fromEntries(listed.map((s) => [s.name, s.value ?? s.digest]));
  const vaultDigests = Object.fromEntries(
    query(ref, vaultDigestSql(Object.keys(wanted.vault))).map((r) => [r.name, r.digest]));
  const scheduled = query(ref, `select jobname from cron.job where jobname = ${literal(CRON_JOB)};`).length > 0;
  const workers = Object.fromEntries(Object.entries(WORKERS).map(([worker, config]) => {
    const present = workerSecretNames(config, environment);
    return [worker, Object.fromEntries(Object.keys(wanted.workers[worker]).map((name) =>
      [name, present.includes(name) ? 'set' : 'missing']))];
  }));
  return {
    functions: drift(wanted.functions, functionDigests),
    vault: drift(wanted.vault, vaultDigests),
    workers,
    scheduled
  };
}

/** Lines for the report, and whether anything is missing or differs. */
export function summarize(state) {
  const lines = [];
  let behind = false;
  const mark = (s) => (s === 'same' || s === 'set' ? '✓' : s === 'missing' ? '+' : '~');
  for (const [worker, names] of Object.entries(state.workers)) {
    for (const [name, s] of Object.entries(names)) {
      lines.push(`  ${mark(s)} ${worker} Worker secret ${name}${s === 'set' ? ' (set; its value cannot be read back)' : ' (missing)'}`);
      if (s !== 'set') behind = true;
    }
  }
  for (const [label, states] of [['function secret', state.functions], ['vault secret', state.vault]]) {
    for (const [name, s] of Object.entries(states)) {
      lines.push(`  ${mark(s)} ${label} ${name}${s === 'same' ? '' : ` (${s})`}`);
      if (s !== 'same') behind = true;
    }
  }
  lines.push(`  ${state.scheduled ? '✓' : '+'} cron job ${CRON_JOB}${state.scheduled ? '' : ' (missing)'}`);
  if (!state.scheduled) behind = true;
  return { lines, behind };
}

async function main() {
  const [environment, flag] = process.argv.slice(2);
  if (!HOSTED.includes(environment)) {
    console.error('usage: npm run secrets -- <preview|production> [--check|--yes]');
    process.exit(2);
  }
  const file = secretsPath(environment);
  const unknown = unknownKeys(envKeyNames(readFileSync(join(root, file), 'utf8')));
  if (unknown.length) {
    console.error(`x ${file} holds ${unknown.join(', ')}, which scripts/secrets.mjs does not place. Add it to FILE_KEYS and destinations, or remove it.`);
    process.exit(1);
  }
  const values = decrypt(file, [...REQUIRED_KEYS, ...OPTIONAL_KEYS]);
  const missing = REQUIRED_KEYS.filter((name) => !values[name]);
  if (missing.length) {
    console.error(`x ${file} is missing ${missing.join(', ')}.`);
    for (const name of missing) console.error(`  npm run env:update -- ${environment} ${name} "$(openssl rand -hex 32)"`);
    process.exit(1);
  }
  const ref = projectRef(readFileSync(join(root, 'supabase/config.toml'), 'utf8'), environment);
  if (!ref) {
    console.error(`x supabase/config.toml has no [remotes.${environment}] project_id.`);
    process.exit(1);
  }
  let linked = null;
  try { linked = readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim(); } catch { /* not linked */ }
  if (linked !== ref) {
    console.error(`x the linked Supabase project is ${linked ?? 'none'}, not ${environment}'s ${ref}. Run: npx supabase link --project-ref ${ref}`);
    process.exit(1);
  }
  const keys = JSON.parse(run('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json']));
  const serviceRoleKey = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!serviceRoleKey) {
    console.error(`x project ${ref} reported no service_role key`);
    process.exit(1);
  }
  const wanted = destinations(environment, values, ref, serviceRoleKey);

  console.log(`Comparing ${file} with ${environment} (project ${ref}):`);
  const before = summarize(hostedState(environment, ref, wanted));
  console.log(before.lines.join('\n'));
  if (flag === '--check') process.exit(before.behind ? 1 : 0);
  const question = before.behind
    ? `Apply to ${environment}? [y/N] `
    : `Everything comparable matches. Set the Worker secrets again anyway? [y/N] `;
  if (flag !== '--yes') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(question);
    rl.close();
    if (!/^y$/i.test(answer.trim())) {
      console.log('Nothing applied.');
      process.exit(before.behind ? 1 : 0);
    }
  }

  for (const [worker, secrets] of Object.entries(wanted.workers)) {
    withTempFile('secrets.json', JSON.stringify(secrets), (f) =>
      run('wrangler', ['secret', 'bulk', f, ...targetArgs(WORKERS[worker], environment), ...authArgs()]));
  }
  withTempFile('functions.env', Object.entries(wanted.functions).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n',
    (f) => run('supabase', ['secrets', 'set', '--project-ref', ref, '--env-file', f]));
  query(ref, vaultSql(wanted.vault));
  // The migration ran before Vault had these on a new project, so it
  // scheduled nothing; it unschedules by name first, so running it again is safe.
  query(ref, readFileSync(join(root, SCHEDULE_MIGRATION), 'utf8'));

  const after = summarize(hostedState(environment, ref, wanted));
  if (after.behind) {
    console.error(`x applied, but some still differ:\n${after.lines.filter((l) => !l.includes('✓')).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ ${environment} has every secret from ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`x ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
