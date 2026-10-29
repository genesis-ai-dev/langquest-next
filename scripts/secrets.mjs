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
// Worker's secrets, the Edge Function secrets, the Gemini key as a GitHub
// Actions secret of this repository (production's file only), the two Vault
// secrets the push delivery cron job reads, and that job itself (by running its
// scheduling migration again, which also keeps the projection pass off
// pg_cron: it runs in the Worker's job container, decisions.md 141, 148).
// Every step is idempotent.
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

/**
 * The ops dashboard's (apps/admin, docs/admin.md), production only and each
 * optional: one read-only token per provider. Who may open it is not a
 * secret: Global Viewers (npm run global-viewer). Named
 * ADMIN_* so none stands in for a CLI's own login (SUPABASE_ACCESS_TOKEN,
 * GITHUB_TOKEN, EXPO_TOKEN) when a script runs with this file's values.
 */
export const ADMIN_KEYS = ['ADMIN_CLOUDFLARE_TOKEN', 'ADMIN_SUPABASE_TOKEN', 'ADMIN_GITHUB_TOKEN', 'ADMIN_EXPO_TOKEN',
  'ADMIN_GOOGLE_PLAY_KEY', 'ADMIN_APP_STORE_KEY'];

/**
 * Keys .env.<env> may hold. DIAG_DATABASE_URL is read on a laptop (npm run diag -- --hosted) and by
 * the admin Worker; V2_DATABASE_URL (scripts/v2-access.sh) goes to the app's Worker for the v2
 * import's job (decisions.md 141) and is read on a laptop by npm run v2 -- --production.
 * GEMINI_API_KEY is the tutorial videos' voice and translations (docs/tutorial-videos.md):
 * production's goes to this repository's GitHub Actions secrets, for the nightly filming
 * (.github/workflows/tutorials.yml), and is read on a laptop. YOUTUBE_CLIENT_ID and
 * YOUTUBE_CLIENT_SECRET are the OAuth client the tutorial channels are connected with and
 * published to (docs/tutorial-videos.md), for the app's Worker and its job. The comments job
 * (decisions.md 186) reads the comments with that client. LINEAR_API_KEY, a Linear personal
 * API key, is how the app's Worker and its comments job file an accepted code change in Linear.
 * CLAUDE_CODE_OAUTH_TOKEN signs Claude's nightly look at the videos' feedback
 * (.github/workflows/tutorial-review.yml) in to a Claude plan: made by `claude setup-token`,
 * it lasts a year, and production's goes to this repository's GitHub Actions secrets. Anyone
 * on the team can replace it with their own plan's.
 */
export const FILE_KEYS = ['INVITE_RELAY_SECRET', 'PUSH_DELIVERY_SECRET', 'DIAG_DATABASE_URL', 'BIBLE_BRAIN_ACCESS_KEY', 'V2_SUPABASE_ANON_KEY', 'V2_DATABASE_URL', 'WEBHOOK_POKE_SECRET', 'GEMINI_API_KEY', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'LINEAR_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', ...ADMIN_KEYS];
export const REQUIRED_KEYS = ['INVITE_RELAY_SECRET', 'PUSH_DELIVERY_SECRET'];
/**
 * Placed when the file has them, never required: the Worker answers without
 * them (the Bible routes say 503), so neither a deploy nor this script waits
 * for one. Not in the Worker's `secrets.required` for the same reason.
 */
export const OPTIONAL_KEYS = ['BIBLE_BRAIN_ACCESS_KEY', 'V2_SUPABASE_ANON_KEY', 'V2_DATABASE_URL', 'WEBHOOK_POKE_SECRET', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'LINEAR_API_KEY'];

/** The repository whose Actions secrets this script sets: the Gemini key and the Claude token, which no production system reads (decisions.md 183, 186). */
export const GITHUB_REPO = 'genesis-ai-dev/langquest-next';

/** LangQuest v2's production project, read (never written) by the v2 import and v2-sign-in (docs/v2-import.md). */
export const V2_SUPABASE_URL = 'https://unsxkmlcyxgtgmtzfonb.supabase.co';

/** Where the app's Worker answers in an environment, from its own routes. */
export function appUrl(environment) {
  const config = parseJsonc(readFileSync(join(root, WORKERS.app), 'utf8'));
  const routes = environment === 'production' ? config.routes : config.env?.[environment]?.routes;
  return `https://${routes[0].pattern}`;
}

/** Read by the database's webhook poke (decisions.md 95). */
export const WEBHOOK_MIGRATION = 'supabase/migrations/20261013120000_api_webhooks.sql';

export const WORKERS = {
  // The app's Worker: the web app, /api, the job runner (apps/web; once named the dashboard).
  app: 'apps/web/wrangler.jsonc',
  'invite-email': 'apps/invite-email/wrangler.jsonc',
  admin: 'apps/admin/wrangler.jsonc'
};

/** The Workers an environment has: the admin page has no preview copy. */
export const workersIn = (environment) =>
  Object.fromEntries(Object.entries(WORKERS).filter(([worker]) => worker !== 'admin' || environment === 'production'));

/** The account's workers.dev subdomain, where the invite-email Workers answer. */
export const WORKERS_SUBDOMAIN = 'blue-darkness-7674';
const inviteEmailName = parseJsonc(readFileSync(join(root, WORKERS['invite-email']), 'utf8')).name;
export const relayUrl = (environment) =>
  `https://${inviteEmailName}${environment === 'production' ? '' : `-${environment}`}.${WORKERS_SUBDOMAIN}.workers.dev/send-invite`;

/** The one pg_cron job that needs these secrets: it calls the Edge Function push-delivery every minute (decisions.md 68, 148). */
export const CRON_JOB = 'langquest-push-delivery';
/** The function it calls, which the schedule must name. */
export const PUSH_FUNCTION = '/functions/v1/push-delivery';
/** The projection pass's old pg_cron job; the pass runs in the Worker's job container, locally too (decisions.md 141, 148). */
export const RETIRED_JOB = 'langquest-stream-projections';
/** Schedules push delivery where the Vault secrets exist, and unschedules the old projection job; safe to run again (decisions 42, 148). */
export const SCHEDULE_MIGRATION = 'supabase/migrations/20261026170400_push_delivery_when_waiting.sql';
/**
 * Function secrets no function needs any more, unset when found. Push
 * delivery's secret was PROJECTION_WORKER_SECRET until 2026-10-20
 * (decisions.md 148); the function still accepts it until this script sets
 * PUSH_DELIVERY_SECRET and unsets it.
 */
export const RETIRED_FUNCTION_SECRETS = ['PROJECTION_WORKER_SECRET'];

/**
 * The ops dashboard's Hyperdrive config (decisions.md 160, amended
 * 2026-10-23): it holds diag_reader's login, DIAG_DATABASE_URL, because a
 * Worker cannot open TLS to Supabase itself. Its id sits in the admin
 * Worker's config, as the DIAG binding, once this script has made it.
 */
export const HYPERDRIVE_NAME = 'langquest-next-diag';
export const HYPERDRIVE_PLACEHOLDER = 'made-by-npm-run-secrets';

/** The DIAG binding's id in the admin Worker's config, or null while it is the placeholder. */
export function hyperdriveId(configText) {
  const binding = (parseJsonc(configText).hyperdrive ?? []).find((h) => h.binding === 'DIAG');
  return binding && binding.id !== HYPERDRIVE_PLACEHOLDER ? binding.id : null;
}

/** The id in `wrangler hyperdrive create`'s output (32 hex digits). */
export const createdId = (output) => /\b([0-9a-f]{32})\b/.exec(output)?.[1] ?? null;

/** The config text with the placeholder replaced by a new config's id, nothing else touched. */
export function withHyperdriveId(configText, id) {
  if (!/^[0-9a-f]{32}$/.test(id ?? '')) throw new Error(`not a Hyperdrive id: ${id}`);
  const placeholder = `"id": "${HYPERDRIVE_PLACEHOLDER}"`;
  if (!configText.includes(placeholder)) throw new Error(`${WORKERS.admin} has no ${placeholder} to replace`);
  return configText.replace(placeholder, `"id": "${id}"`);
}

/** Every secret, by where it goes. */
export function destinations(environment, values, ref, serviceRoleKey) {
  return {
    workers: {
      app: {
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        ...(values.BIBLE_BRAIN_ACCESS_KEY ? { BIBLE_BRAIN_ACCESS_KEY: values.BIBLE_BRAIN_ACCESS_KEY } : {}),
        ...(values.WEBHOOK_POKE_SECRET ? { WEBHOOK_POKE_SECRET: values.WEBHOOK_POKE_SECRET } : {}),
        // The v2 import's job reads v2 with these (apps/web/worker/jobsModel.ts jobEnv): it refuses to start without the key, and names people only with the login.
        ...(values.V2_SUPABASE_ANON_KEY ? { V2_SUPABASE_ANON_KEY: values.V2_SUPABASE_ANON_KEY } : {}),
        ...(values.V2_DATABASE_URL ? { V2_DATABASE_URL: values.V2_DATABASE_URL } : {}),
        // Connect YouTube and the publish job (decisions.md 180): both or neither, as one is no use alone.
        ...(values.YOUTUBE_CLIENT_ID && values.YOUTUBE_CLIENT_SECRET ? { YOUTUBE_CLIENT_ID: values.YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET: values.YOUTUBE_CLIENT_SECRET } : {}),
        // An accepted code change to Linear (decisions.md 186).
        ...(values.LINEAR_API_KEY ? { LINEAR_API_KEY: values.LINEAR_API_KEY } : {})
      },
      'invite-email': { INVITE_RELAY_SECRET: values.INVITE_RELAY_SECRET },
      // The ops dashboard's provider tokens, each optional. Its database login is not a Worker
      // secret but the Hyperdrive config's (below); never the service-role key (docs/admin.md).
      ...(environment === 'production' && ADMIN_KEYS.some((key) => values[key]) ? {
        admin: Object.fromEntries(ADMIN_KEYS.filter((key) => values[key]).map((key) => [key, values[key]]))
      } : {})
    },
    hyperdrive: environment === 'production' && values.DIAG_DATABASE_URL ? { connectionString: values.DIAG_DATABASE_URL } : null,
    // The nightly filming's voice (.github/workflows/tutorials.yml) and Claude's nightly look at the videos'
    // feedback (tutorial-review.yml). Never a production key: scripts/workflows.test.ts.
    github: environment === 'production' ? {
      ...(values.GEMINI_API_KEY ? { GEMINI_API_KEY: values.GEMINI_API_KEY } : {}),
      ...(values.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: values.CLAUDE_CODE_OAUTH_TOKEN } : {})
    } : {},
    // Read with Deno.env.get in supabase/functions. The relay URL is public
    // but has no other way into a function.
    functions: {
      INVITE_RELAY_URL: relayUrl(environment),
      INVITE_RELAY_SECRET: values.INVITE_RELAY_SECRET,
      PUSH_DELIVERY_SECRET: values.PUSH_DELIVERY_SECRET,
      // v2's publishable key is public (its app ships it); without it, signing in with a v2 account answers 503.
      ...(values.V2_SUPABASE_ANON_KEY ? { V2_SUPABASE_URL, V2_SUPABASE_ANON_KEY: values.V2_SUPABASE_ANON_KEY } : {})
    },
    // Read by the push delivery job (SCHEDULE_MIGRATION).
    vault: {
      langquest_project_url: `https://${ref}.supabase.co`,
      langquest_push_delivery_secret: values.PUSH_DELIVERY_SECRET,
      // Read by events_notify (WEBHOOK_MIGRATION); without them it pokes nobody and the cron catches up.
      ...(values.WEBHOOK_POKE_SECRET ? { langquest_dashboard_url: appUrl(environment), langquest_webhook_poke_secret: values.WEBHOOK_POKE_SECRET } : {})
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

function githubSecretNames() {
  const result = spawnSync('gh', ['secret', 'list', '--repo', GITHUB_REPO, '--json', 'name', '--jq', '.[].name'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(failure(result.stdout, result.stderr) || 'gh secret list failed (gh auth login?)');
  return result.stdout.split('\n').filter(Boolean);
}

/** Sets a repository's Actions secret, the value on gh's input, never its arguments. */
function setGithubSecret(name, value) {
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', GITHUB_REPO], { cwd: root, encoding: 'utf8', input: value });
  if (result.status !== 0) throw new Error(failure(result.stdout, result.stderr) || `gh secret set ${name} failed`);
}

function hostedState(environment, ref, wanted) {
  const listed = JSON.parse(run('supabase', ['secrets', 'list', '--project-ref', ref, '-o', 'json']));
  const functionDigests = Object.fromEntries(listed.map((s) => [s.name, s.value ?? s.digest]));
  const vaultDigests = Object.fromEntries(
    query(ref, vaultDigestSql(Object.keys(wanted.vault))).map((r) => [r.name, r.digest]));
  // Push delivery scheduled on its own function, and the projection pass not: it runs in the Worker's job container.
  const jobs = query(ref, `select jobname from cron.job where (jobname = ${literal(CRON_JOB)} and command like ${literal(`%${PUSH_FUNCTION}%`)}) or jobname = ${literal(RETIRED_JOB)};`).map((r) => r.jobname);
  const scheduled = jobs.includes(CRON_JOB) && !jobs.includes(RETIRED_JOB);
  const workers = Object.fromEntries(Object.keys(wanted.workers).map((worker) => {
    const present = workerSecretNames(WORKERS[worker], environment);
    return [worker, Object.fromEntries(Object.keys(wanted.workers[worker]).map((name) =>
      [name, present.includes(name) ? 'set' : 'missing']))];
  }));
  // The config's login cannot be read back, so this says only whether it exists.
  let hyperdrive = null;
  if (wanted.hyperdrive) {
    const id = hyperdriveId(readFileSync(join(root, WORKERS.admin), 'utf8'));
    hyperdrive = 'missing';
    if (id) {
      try { run('wrangler', ['hyperdrive', 'get', id, '-c', WORKERS.admin, ...authArgs()]); hyperdrive = 'set'; } catch { /* gone: made again */ }
    }
  }
  // GitHub, like Cloudflare, says only which secrets a repository has.
  const githubPresent = Object.keys(wanted.github).length ? githubSecretNames() : [];
  return {
    hyperdrive,
    github: Object.fromEntries(Object.keys(wanted.github).map((name) => [name, githubPresent.includes(name) ? 'set' : 'missing'])),
    functions: drift(wanted.functions, functionDigests),
    retired: RETIRED_FUNCTION_SECRETS.filter((name) => name in functionDigests),
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
  for (const [name, s] of Object.entries(state.github ?? {})) {
    lines.push(`  ${mark(s)} GitHub Actions secret ${name}${s === 'set' ? ' (set; its value cannot be read back)' : ' (missing)'}`);
    if (s !== 'set') behind = true;
  }
  for (const [label, states] of [['function secret', state.functions], ['vault secret', state.vault]]) {
    for (const [name, s] of Object.entries(states)) {
      lines.push(`  ${mark(s)} ${label} ${name}${s === 'same' ? '' : ` (${s})`}`);
      if (s !== 'same') behind = true;
    }
  }
  for (const name of state.retired ?? []) {
    lines.push(`  - function secret ${name} (retired; unset)`);
    behind = true;
  }
  if (state.hyperdrive) {
    lines.push(`  ${mark(state.hyperdrive)} Hyperdrive ${HYPERDRIVE_NAME}, diag_reader's login for the ops dashboard${state.hyperdrive === 'set' ? ' (set; its login cannot be read back)' : ' (missing)'}`);
    if (state.hyperdrive !== 'set') behind = true;
  }
  lines.push(`  ${state.scheduled ? '✓' : '+'} cron job ${CRON_JOB} calling push-delivery, and no ${RETIRED_JOB}${state.scheduled ? '' : ' (not yet)'}`);
  if (!state.scheduled) behind = true;
  return { lines, behind };
}

/**
 * Makes the ops dashboard's Hyperdrive config, writing its id into the admin
 * Worker's config, or brings an existing one's login up to date. The login
 * goes to wrangler as an argument, the only way it takes one, so it is
 * briefly in this machine's process list; it is never printed.
 */
function applyHyperdrive(connectionString, state) {
  const configPath = join(root, WORKERS.admin);
  const text = readFileSync(configPath, 'utf8');
  const id = hyperdriveId(text);
  const common = ['--connection-string', connectionString, '--caching-disabled', '-c', WORKERS.admin, ...authArgs()];
  if (id && state === 'set') {
    run('wrangler', ['hyperdrive', 'update', id, ...common]);
    return;
  }
  const made = createdId(run('wrangler', ['hyperdrive', 'create', HYPERDRIVE_NAME, ...common]));
  if (!made) throw new Error(`wrangler made ${HYPERDRIVE_NAME} but printed no id; find it with npx wrangler hyperdrive list and put it in ${WORKERS.admin}`);
  writeFileSync(configPath, id ? text.replace(`"id": "${id}"`, `"id": "${made}"`) : withHyperdriveId(text, made));
  console.log(`✓ Hyperdrive ${HYPERDRIVE_NAME} made; its id is now in ${WORKERS.admin}. Commit that file, then deploy the admin Worker (npm run admin:deploy).`);
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
  const values = decrypt(file, [...REQUIRED_KEYS, ...OPTIONAL_KEYS, ...(environment === 'production' ? ['DIAG_DATABASE_URL', 'GEMINI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', ...ADMIN_KEYS] : [])]);
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
  // What is hosted, and its summary: applying reads the first (the Hyperdrive config, retired secrets), the person the second.
  const hosted = hostedState(environment, ref, wanted);
  const before = summarize(hosted);
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
  if (wanted.hyperdrive) applyHyperdrive(wanted.hyperdrive.connectionString, hosted.hyperdrive);
  for (const [name, value] of Object.entries(wanted.github)) setGithubSecret(name, value);
  withTempFile('functions.env', Object.entries(wanted.functions).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n',
    (f) => run('supabase', ['secrets', 'set', '--project-ref', ref, '--env-file', f]));
  // --yes: the CLI asks before unsetting, and with no answer it unsets nothing yet exits 0 (2026-10-20).
  if (hosted.retired.length) run('supabase', ['secrets', 'unset', '--yes', '--project-ref', ref, ...hosted.retired]);
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
