// Put one hosted environment's secrets where they are used
// (docs/environments.md). Deploys never carry secrets; this is the one way
// they reach Cloudflare, Supabase, GitHub and EAS, run by a person when a
// secret changes.
//
//   npm run secrets -- preview                compare (names only), ask, apply
//   npm run secrets -- production --check     exit 1 if anything is missing or differs
//   npm run secrets -- preview --yes          apply without asking
//   npm run secrets -- production --only eas  the same for EAS's secrets alone, needing
//                                             neither Supabase nor Cloudflare
//
// Sources: the encrypted .env.<env> at the repository root, the project ref
// in supabase/config.toml [remotes.<env>], and the project's service-role key,
// read from Supabase each time rather than stored. Destinations: each
// Worker's secrets, the Edge Function secrets, the Gemini key as a GitHub
// Actions secret of this repository and the App Store key as a secret of EAS's
// production environment (production's file only), the two Vault
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
 * (.github/workflows/tutorial-review.yml) and the nightly filming's frame check (tutorials.yml,
 * e2e/tutorials/frame-check.ts) in to a Claude plan: made by `claude setup-token`,
 * it lasts a year, and production's goes to this repository's GitHub Actions secrets. Anyone
 * on the team can replace it with their own plan's. APP_STORE_REVIEW_KEY is the App Store
 * Connect key (App Manager) that sends new iPhone builds to App Review, and PLAY_REVIEW_KEY the
 * Google Play service account key that moves new Android builds from internal testing to
 * production review: production's go to EAS (EAS_KEYS). NEARBY_SIGNING_KEY is the app Worker's
 * Ed25519 key for nearby sync's certificates and attestations (docs/nearby-sync-plan.md 5.12), one
 * compact JWK with its kid, made by scripts/nearby-signing-key.sh, whose public half is in the
 * Worker's NEARBY_CERT_KEYS var and the app's EXPO_PUBLIC_NEARBY_CERT_KEYS. APK_R2_ACCESS_KEY_ID and
 * APK_R2_SECRET_ACCESS_KEY are the S3 credentials of an R2 token limited to the carried builds'
 * bucket, with which scripts/carried-build.mjs checks for and puts each carried APK
 * (docs/nearby-sync-plan.md 14.4): production's go to EAS (EAS_KEYS).
 */
export const FILE_KEYS = ['INVITE_RELAY_SECRET', 'PUSH_DELIVERY_SECRET', 'DIAG_DATABASE_URL', 'BIBLE_BRAIN_ACCESS_KEY', 'V2_SUPABASE_ANON_KEY', 'V2_DATABASE_URL', 'WEBHOOK_POKE_SECRET', 'GEMINI_API_KEY', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'LINEAR_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'APP_STORE_REVIEW_KEY', 'PLAY_REVIEW_KEY', 'APK_R2_ACCESS_KEY_ID', 'APK_R2_SECRET_ACCESS_KEY', 'NEARBY_SIGNING_KEY', ...ADMIN_KEYS];
export const REQUIRED_KEYS = ['INVITE_RELAY_SECRET', 'PUSH_DELIVERY_SECRET'];
/**
 * Placed when the file has them, never required: the Worker answers without
 * them (the Bible routes say 503), so neither a deploy nor this script waits
 * for one. Not in the Worker's `secrets.required` for the same reason.
 */
export const OPTIONAL_KEYS = ['BIBLE_BRAIN_ACCESS_KEY', 'V2_SUPABASE_ANON_KEY', 'V2_DATABASE_URL', 'WEBHOOK_POKE_SECRET', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'LINEAR_API_KEY', 'NEARBY_SIGNING_KEY'];

/** The repository whose Actions secrets this script sets: the Gemini key and the Claude token, which no production system reads (decisions.md 183, 186). */
export const GITHUB_REPO = 'genesis-ai-dev/langquest-next';

/**
 * Production's secrets for EAS, which its workflows read on Expo's servers:
 * the App Store key that `scripts/app-store-review.mjs` sends new iPhone
 * builds to App Review with, and the Play key that `scripts/play-review.mjs`
 * sends new Android builds to production review with (decisions.md 157),
 * and that `scripts/carried-build.mjs` fetches each carried build's APK
 * with, for reading only; and the APK bucket's limited R2 token, with which
 * that script puts the APK there (docs/nearby-sync-plan.md 14.4). Each is
 * an EAS variable with secret visibility, readable by EAS's jobs and builds
 * only, never in a UI.
 */
export const EAS_KEYS = ['APP_STORE_REVIEW_KEY', 'PLAY_REVIEW_KEY', 'APK_R2_ACCESS_KEY_ID', 'APK_R2_SECRET_ACCESS_KEY'];
/** The folder that holds the EAS project (eas.json, the project id), where `eas env:*` runs. */
export const EAS_PROJECT = 'apps/mobile';
/** Destinations that `--only` can apply alone. */
export const ONLY = ['eas'];

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
        ...(values.LINEAR_API_KEY ? { LINEAR_API_KEY: values.LINEAR_API_KEY } : {}),
        // Nearby sync's certificates and attestations (apps/web/worker/nearby.ts): 503 until it is here.
        ...(values.NEARBY_SIGNING_KEY ? { NEARBY_SIGNING_KEY: values.NEARBY_SIGNING_KEY } : {})
      },
      'invite-email': { INVITE_RELAY_SECRET: values.INVITE_RELAY_SECRET },
      // The ops dashboard's provider tokens, each optional. Its database login is not a Worker
      // secret but the Hyperdrive config's (below); never the service-role key (docs/admin.md).
      ...(environment === 'production' && ADMIN_KEYS.some((key) => values[key]) ? {
        admin: Object.fromEntries(ADMIN_KEYS.filter((key) => values[key]).map((key) => [key, values[key]]))
      } : {})
    },
    hyperdrive: environment === 'production' && values.DIAG_DATABASE_URL ? { connectionString: values.DIAG_DATABASE_URL } : null,
    // The nightly filming's voice and frame check (.github/workflows/tutorials.yml), Claude's nightly look at
    // the videos' feedback (tutorial-review.yml) and the survey of Bible Brain's numberings (bible-survey.yml).
    // Never a production key: scripts/workflows.test.ts.
    github: environment === 'production' ? {
      ...(values.GEMINI_API_KEY ? { GEMINI_API_KEY: values.GEMINI_API_KEY } : {}),
      ...(values.BIBLE_BRAIN_ACCESS_KEY ? { BIBLE_BRAIN_ACCESS_KEY: values.BIBLE_BRAIN_ACCESS_KEY } : {}),
      ...(values.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: values.CLAUDE_CODE_OAUTH_TOKEN } : {})
    } : {},
    // EAS's production environment: the store keys for the App Review and Play review steps (decisions.md 157).
    eas: environment === 'production' ? Object.fromEntries(EAS_KEYS.filter((key) => values[key]).map((key) => [key, values[key]])) : {},
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

/**
 * What a failed `wrangler secret list` means: 'absent' when it says the Worker
 * does not exist (wrangler 4 says `Worker "<name>" not found.`, from the API's
 * code 10007, or 10090 for a legacy environment), which has no secrets yet and
 * which `secret bulk` makes; 'unreadable' for anything else, a sign-in or a
 * network failure most often, which says nothing about what the Worker holds.
 */
export const secretListFailure = (output) =>
  /Worker "[^"]*"(?: \(env: [^)]*\))? not found\./.test(output) || /\[code: 100(?:07|90)\]/.test(output) ? 'absent' : 'unreadable';

/** Whether a failed `wrangler hyperdrive get` says Cloudflare has no such config, rather than that it could not ask. */
export const hyperdriveGone = (output) =>
  /hyperdrive\/configs\/[0-9a-f]{32}\) failed/.test(output) && /not found|does not exist/i.test(output);

/**
 * The error for a Cloudflare listing that could not be read. It stops the
 * script before the comparison is shown: read as empty, every secret looked
 * missing and a yes would have set them all again and made a second
 * Hyperdrive config (2026-11-13, signed out). Says how to sign in when that
 * was the cause, in the profile the script runs wrangler with; otherwise adds
 * `otherwise`, then wrangler's own words.
 */
export function unreadable(what, output, otherwise = '', profile = authArgs()[1] ?? null) {
  const signedOut = /CLOUDFLARE_API_TOKEN|not authenticated|wrangler login|\[code: 10000\]/i.test(output);
  const signIn = profile ? `npx wrangler auth create ${profile}` : 'npx wrangler login';
  const advice = signedOut ? ` wrangler is not signed in for this script: run ${signIn}, then this again.` : otherwise ? ` ${otherwise}` : '';
  return `could not read ${what}, so nothing was compared or applied.${advice}\n${output}`;
}

/** A Worker's secret names, or null when the Worker does not exist; any other failure stops the script. */
function workerSecretNames(worker, environment) {
  try {
    const listed = JSON.parse(run('wrangler', ['secret', 'list', ...targetArgs(WORKERS[worker], environment), '--format', 'json', ...authArgs()]));
    return listed.map((s) => s.name);
  } catch (err) {
    const output = err instanceof Error ? err.message : String(err);
    if (secretListFailure(output) === 'absent') return null;
    throw new Error(unreadable(`the ${worker} Worker's secrets`, output));
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

/** The variable names in what `eas env:list <env> --format short` prints (NAME=value lines; a secret's value is masked). */
export const easNames = (output) =>
  [...String(output).replace(/\u001b\[[0-9;]*m/g, '').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);

function easVariableNames(environment) {
  const result = spawnSync('npx', ['eas', 'env:list', environment, '--format', 'short', '--scope', 'project'], { cwd: join(root, EAS_PROJECT), encoding: 'utf8' });
  // Its output holds plain variables' values, so a failure shows only what eas said went wrong.
  if (result.status !== 0) throw new Error(failure('', result.stderr) || 'eas env:list failed (npx eas login?)');
  return easNames(result.stdout);
}

/** Each wanted EAS secret, 'set' or 'missing': like a Worker's, its value cannot be read back. */
function easState(environment, wanted) {
  const present = Object.keys(wanted).length ? easVariableNames(environment) : [];
  return Object.fromEntries(Object.keys(wanted).map((name) => [name, present.includes(name) ? 'set' : 'missing']));
}

/**
 * Creates or updates an EAS variable with secret visibility. The value goes
 * to eas as an argument, the only way it takes one, so it is briefly in this
 * machine's process list; it is never printed. eas runs from node_modules
 * itself, not through npx, which would write its arguments, the value too, to
 * npm's debug log on disk (security review, 2026-11-10).
 */
function setEasSecret(environment, name, value) {
  const result = spawnSync(join(root, 'node_modules', '.bin', 'eas'), ['env:set', environment, '--name', name, '--value', value, '--visibility', 'secret', '--type', 'string', '--scope', 'project', '--non-interactive'],
    { cwd: join(root, EAS_PROJECT), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(failure(result.stdout, result.stderr).replaceAll(value, `<${name}>`) || `eas env:set ${name} failed`);
}

function hostedState(environment, ref, wanted) {
  const listed = JSON.parse(run('supabase', ['secrets', 'list', '--project-ref', ref, '-o', 'json']));
  const functionDigests = Object.fromEntries(listed.map((s) => [s.name, s.value ?? s.digest]));
  const vaultDigests = Object.fromEntries(
    query(ref, vaultDigestSql(Object.keys(wanted.vault))).map((r) => [r.name, r.digest]));
  // Push delivery scheduled on its own function, and the projection pass not: it runs in the Worker's job container.
  const jobs = query(ref, `select jobname from cron.job where (jobname = ${literal(CRON_JOB)} and command like ${literal(`%${PUSH_FUNCTION}%`)}) or jobname = ${literal(RETIRED_JOB)};`).map((r) => r.jobname);
  const scheduled = jobs.includes(CRON_JOB) && !jobs.includes(RETIRED_JOB);
  const absent = [];
  const workers = Object.fromEntries(Object.keys(wanted.workers).map((worker) => {
    const present = workerSecretNames(worker, environment);
    if (present === null) absent.push(worker);
    return [worker, Object.fromEntries(Object.keys(wanted.workers[worker]).map((name) =>
      [name, present?.includes(name) ? 'set' : 'missing']))];
  }));
  // The config's login cannot be read back, so this says only whether it exists.
  let hyperdrive = null;
  if (wanted.hyperdrive) {
    const id = hyperdriveId(readFileSync(join(root, WORKERS.admin), 'utf8'));
    hyperdrive = 'missing';
    if (id) {
      try {
        run('wrangler', ['hyperdrive', 'get', id, '-c', WORKERS.admin, ...authArgs()]);
        hyperdrive = 'set';
      } catch (err) {
        const output = err instanceof Error ? err.message : String(err);
        // Gone: made again. Anything else would make a second config beside the one in use.
        if (!hyperdriveGone(output)) {
          throw new Error(unreadable(`Hyperdrive ${HYPERDRIVE_NAME}`, output,
            `If it was deleted, put "${HYPERDRIVE_PLACEHOLDER}" back as its id in ${WORKERS.admin} and run this again.`));
        }
      }
    }
  }
  // GitHub, like Cloudflare, says only which secrets a repository has.
  const githubPresent = Object.keys(wanted.github).length ? githubSecretNames() : [];
  return {
    hyperdrive,
    github: Object.fromEntries(Object.keys(wanted.github).map((name) => [name, githubPresent.includes(name) ? 'set' : 'missing'])),
    eas: easState(environment, wanted.eas),
    functions: drift(wanted.functions, functionDigests),
    retired: RETIRED_FUNCTION_SECRETS.filter((name) => name in functionDigests),
    vault: drift(wanted.vault, vaultDigests),
    workers,
    absent,
    scheduled
  };
}

/** Lines for the report, and whether anything is missing or differs. */
export function summarize(state) {
  const lines = [];
  let behind = false;
  const mark = (s) => (s === 'same' || s === 'set' ? '✓' : s === 'missing' ? '+' : '~');
  for (const [worker, names] of Object.entries(state.workers ?? {})) {
    // A deployed environment's Workers all exist, so this is most often the wrong account.
    if (state.absent?.includes(worker)) {
      lines.push(`  ! ${worker} Worker is not on the Cloudflare account wrangler is signed in to (npx wrangler whoami); applying makes it there`);
      behind = true;
    }
    for (const [name, s] of Object.entries(names)) {
      lines.push(`  ${mark(s)} ${worker} Worker secret ${name}${s === 'set' ? ' (set; its value cannot be read back)' : ' (missing)'}`);
      if (s !== 'set') behind = true;
    }
  }
  for (const [name, s] of Object.entries(state.github ?? {})) {
    lines.push(`  ${mark(s)} GitHub Actions secret ${name}${s === 'set' ? ' (set; its value cannot be read back)' : ' (missing)'}`);
    if (s !== 'set') behind = true;
  }
  for (const [name, s] of Object.entries(state.eas ?? {})) {
    lines.push(`  ${mark(s)} EAS secret ${name}${s === 'set' ? ' (set; its value cannot be read back)' : ' (missing)'}`);
    if (s !== 'set') behind = true;
  }
  for (const [label, states] of [['function secret', state.functions ?? {}], ['vault secret', state.vault ?? {}]]) {
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
  // `--only` compares no Supabase project, so its state has no cron job to report.
  if (state.scheduled !== undefined) {
    lines.push(`  ${state.scheduled ? '✓' : '+'} cron job ${CRON_JOB} calling push-delivery, and no ${RETIRED_JOB}${state.scheduled ? '' : ' (not yet)'}`);
    if (!state.scheduled) behind = true;
  }
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

/** `<environment> [--check|--yes] [--only <destination>]`, with `unknown` set to anything else. */
export function parseArgs(argv) {
  const [environment, ...rest] = argv;
  const args = { environment, check: false, yes: false, only: null, unknown: null };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--check') args.check = true;
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--only') args.only = rest[++i] ?? '';
    else if (arg.startsWith('--only=')) args.only = arg.slice('--only='.length);
    else args.unknown ??= arg;
  }
  return args;
}

/** Asks on the terminal; true for y. */
async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y$/i.test(answer.trim());
}

/** `--only eas`: EAS's secrets alone, with no Supabase project or Cloudflare login. */
async function applyEasOnly(environment, file, values, { check, yes }) {
  const wanted = destinations(environment, values, '', '').eas;
  if (!Object.keys(wanted).length) {
    console.log(`${file} holds none of EAS's secrets (${EAS_KEYS.join(', ')}; production only), so there is nothing to apply.`);
    return;
  }
  console.log(`Comparing ${file} with EAS's ${environment} environment:`);
  const before = summarize({ eas: easState(environment, wanted) });
  console.log(before.lines.join('\n'));
  if (check) process.exit(before.behind ? 1 : 0);
  if (!yes && !(await confirm(before.behind ? `Apply to EAS's ${environment} environment? [y/N] ` : 'Everything comparable matches. Set the EAS secrets again anyway? [y/N] '))) {
    console.log('Nothing applied.');
    process.exit(before.behind ? 1 : 0);
  }
  for (const [name, value] of Object.entries(wanted)) setEasSecret(environment, name, value);
  const after = summarize({ eas: easState(environment, wanted) });
  if (after.behind) {
    console.error(`x applied, but some still differ:\n${after.lines.filter((l) => !l.includes('✓')).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ EAS's ${environment} environment has every secret from ${file} that it takes`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { environment } = args;
  if (!HOSTED.includes(environment) || args.unknown || (args.only !== null && !ONLY.includes(args.only)) || (args.check && args.yes)) {
    console.error(`usage: npm run secrets -- <preview|production> [--check|--yes] [--only ${ONLY.join('|')}]`);
    process.exit(2);
  }
  const file = secretsPath(environment);
  const unknown = unknownKeys(envKeyNames(readFileSync(join(root, file), 'utf8')));
  if (unknown.length) {
    console.error(`x ${file} holds ${unknown.join(', ')}, which scripts/secrets.mjs does not place. Add it to FILE_KEYS and destinations, or remove it.`);
    process.exit(1);
  }
  if (args.only === 'eas') return applyEasOnly(environment, file, decrypt(file, EAS_KEYS), args);
  const values = decrypt(file, [...REQUIRED_KEYS, ...OPTIONAL_KEYS, ...(environment === 'production' ? ['DIAG_DATABASE_URL', 'GEMINI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', ...EAS_KEYS, ...ADMIN_KEYS] : [])]);
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
  if (args.check) process.exit(before.behind ? 1 : 0);
  const question = before.behind
    ? `Apply to ${environment}? [y/N] `
    : `Everything comparable matches. Set the Worker secrets again anyway? [y/N] `;
  if (!args.yes && !(await confirm(question))) {
    console.log('Nothing applied.');
    process.exit(before.behind ? 1 : 0);
  }

  for (const [worker, secrets] of Object.entries(wanted.workers)) {
    withTempFile('secrets.json', JSON.stringify(secrets), (f) =>
      run('wrangler', ['secret', 'bulk', f, ...targetArgs(WORKERS[worker], environment), ...authArgs()]));
  }
  if (wanted.hyperdrive) applyHyperdrive(wanted.hyperdrive.connectionString, hosted.hyperdrive);
  for (const [name, value] of Object.entries(wanted.github)) setGithubSecret(name, value);
  for (const [name, value] of Object.entries(wanted.eas)) setEasSecret(environment, name, value);
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
