// Deploy one Worker. Runtime settings come from an encrypted env file whose
// name picks the environment: `.env.production` deploys the Worker named in
// the wrangler file, `.env.preview` deploys its `env.preview` (the
// `-preview` Worker, docs/environments.md). DOTENV_PRIVATE_KEY_<ENV> (a
// Workers Builds secret, or .env.keys locally) decrypts it. Every key is
// uploaded as a secret with the deploy, so no value reaches the command line
// or the build log, and each key must be listed in that environment's
// secrets.required (which is also where wrangler types finds it). On
// Workers Builds, Cloudflare's own token is used. Locally, the
// langquest-email profile is.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decrypt, envKeyNames, environmentOf, publicKey, root } from './env-files.mjs';

export { envKeyNames };

/** The wrangler environment an env file deploys to; production is the top level. */
export function wranglerEnv(environment) {
  return environment === 'production' ? null : environment;
}

/** Secret names a wrangler jsonc file declares for one environment. */
export function requiredSecretNames(text, environment = 'production') {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const config = JSON.parse(stripped);
  const name = wranglerEnv(environment);
  // secrets is not inherited, so a named environment declares its own.
  const required = (name ? config.env?.[name] : config)?.secrets?.required;
  return Array.isArray(required) ? required : [];
}

/**
 * The secrets to upload, plus required keys the env lacks and env keys the
 * wrangler file does not declare.
 * @param {Record<string, string>} env
 * @param {string[]} required
 */
export function secretsFor(env, required) {
  /** @type {Record<string, string>} */
  const secrets = {};
  const undeclared = [];
  for (const [key, value] of Object.entries(env)) {
    if (!key || key.startsWith('DOTENV_')) continue;
    if (!required.includes(key)) undeclared.push(key);
    else if (value) secrets[key] = value;
  }
  const missing = required.filter((name) => !secrets[name]);
  return { secrets, missing, undeclared };
}

/** Wrangler arguments for one deploy. Values stay in `secretsFile`. */
export function deployArgs({ config, secretsFile, workersCi, environment = 'production' }) {
  const args = ['deploy', '-c', config, '--secrets-file', secretsFile];
  const name = wranglerEnv(environment);
  if (name) args.push('--env', name);
  if (!workersCi) args.push('--profile', 'langquest-email');
  return args;
}

function deploy(config, secrets, environment) {
  const dir = mkdtempSync(join(tmpdir(), 'lq-deploy-'));
  const secretsFile = join(dir, 'secrets.json');
  try {
    writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
    const args = deployArgs({ config, secretsFile, workersCi: process.env.WORKERS_CI === '1', environment });
    return spawnSync('npx', ['wrangler', ...args], { cwd: root, stdio: 'inherit' }).status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const configArg = process.argv[2];
  const envArg = process.argv[3];
  if (!configArg || !envArg) {
    console.error('usage: node scripts/cloudflare-deploy.mjs <wrangler.jsonc> <apps/x/.env.production|.env.preview>');
    process.exit(2);
  }
  const config = resolve(process.cwd(), configArg);
  const envFile = resolve(process.cwd(), envArg);
  const environment = environmentOf(envFile);
  if (environment !== 'production' && environment !== 'preview') {
    console.error(`x ${envArg} is not a .env.production or .env.preview file.`);
    process.exit(2);
  }
  const target = relative(root, envFile).split('/').slice(0, 2).join('/') === 'apps/web' ? 'web' : 'invite-email';
  let envText;
  try {
    envText = readFileSync(envFile, 'utf8');
  } catch {
    console.error(`x ${envArg} does not exist. Fill it with: npm run env:update -- ${environment} ${target} KEY`);
    process.exit(1);
  }
  const mobileKey = publicKey(readFileSync(join(root, `apps/mobile/.env.${environment}`), 'utf8'), environment);
  if (publicKey(envText, environment) !== mobileKey) {
    console.error(`x ${envArg} is not encrypted with the ${environment} key apps/mobile/.env.${environment} uses (docs/environments.md, re-keying).`);
    process.exit(1);
  }
  const required = requiredSecretNames(readFileSync(config, 'utf8'), environment);
  const names = [...new Set([...envKeyNames(envText), ...required])];
  let decrypted;
  try {
    decrypted = decrypt(envFile, names);
  } catch (err) {
    console.error(`x ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const { secrets, missing, undeclared } = secretsFor(decrypted, required);
  if (undeclared.length) {
    const where = environment === 'production' ? 'secrets.required' : `env.${environment}.secrets.required`;
    console.error(`x ${envArg} holds ${undeclared.join(', ')}, which ${configArg} does not list in ${where}.`);
    process.exit(1);
  }
  if (missing.length) {
    console.error(`x ${envArg} is missing ${missing.join(', ')}.`);
    if (missing.includes('SUPABASE_SERVICE_ROLE_KEY')) console.error(`  npm run web:secrets -- fetch ${environment}`);
    for (const key of missing.filter((k) => k !== 'SUPABASE_SERVICE_ROLE_KEY' && k !== 'SUPABASE_URL')) {
      console.error(`  npm run env:update -- ${environment} ${target} ${key}`);
    }
    process.exit(1);
  }
  process.exit(deploy(config, secrets, environment));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
