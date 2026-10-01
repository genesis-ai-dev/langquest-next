// Deploy one Worker. Runtime settings come from an encrypted env file.
// DOTENV_PRIVATE_KEY_PRODUCTION (or .env.keys locally) decrypts it. Every
// key is uploaded as a secret with the deploy, so no value reaches the
// command line or the build log, and each key must be listed in the wrangler
// file's secrets.required (which is also where wrangler types finds it). On
// Workers Builds, Cloudflare's own token is used. Locally, the
// langquest-email profile is.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Secret names declared by a wrangler jsonc file. */
export function requiredSecretNames(text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const required = JSON.parse(stripped).secrets?.required;
  return Array.isArray(required) ? required : [];
}

/** Key names an env file holds, without dotenvx's own keys. */
export function envKeyNames(text) {
  return [...text.matchAll(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=/gm)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith('DOTENV_'));
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
export function deployArgs({ config, secretsFile, workersCi }) {
  const args = ['deploy', '-c', config, '--secrets-file', secretsFile];
  if (!workersCi) args.push('--profile', 'langquest-email');
  return args;
}

function decrypt(envFile, names) {
  const dir = mkdtempSync(join(tmpdir(), 'lq-deploy-'));
  const out = join(dir, 'env.json');
  const child = `
    const fs = require('node:fs');
    const [out, ...names] = process.argv.slice(1);
    const values = {};
    for (const name of names) values[name] = process.env[name] ?? '';
    fs.writeFileSync(out, JSON.stringify(values), { mode: 0o600 });
  `;
  try {
    const result = spawnSync('npx', [
      'dotenvx', 'run', '-f', envFile, '-fk', join(root, '.env.keys'),
      '--strict', '--quiet', '--',
      process.execPath, '-e', child, out, ...names
    ], { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim();
      throw new Error(detail || `could not decrypt ${envFile}`);
    }
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function deploy(config, secrets) {
  const dir = mkdtempSync(join(tmpdir(), 'lq-deploy-'));
  const secretsFile = join(dir, 'secrets.json');
  try {
    writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
    const args = deployArgs({ config, secretsFile, workersCi: process.env.WORKERS_CI === '1' });
    return spawnSync('npx', ['wrangler', ...args], { cwd: root, stdio: 'inherit' }).status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const configArg = process.argv[2];
  const envArg = process.argv[3];
  if (!configArg || !envArg) {
    console.error('usage: node scripts/cloudflare-deploy.mjs <wrangler.jsonc> <env-file>');
    process.exit(2);
  }
  const config = resolve(process.cwd(), configArg);
  const envFile = resolve(process.cwd(), envArg);
  let envText;
  try {
    envText = readFileSync(envFile, 'utf8');
  } catch {
    console.error(`x ${envArg} does not exist. Encrypt this worker's runtime settings there with the production key from apps/mobile/.env.production.`);
    process.exit(1);
  }
  const required = requiredSecretNames(readFileSync(config, 'utf8'));
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
    console.error(`x ${envArg} holds ${undeclared.join(', ')}, which ${configArg} does not list in secrets.required.`);
    process.exit(1);
  }
  if (missing.length) {
    console.error(`x ${envArg} is missing ${missing.join(', ')}.`);
    if (missing.includes('SUPABASE_SERVICE_ROLE_KEY')) console.error('  npm run web:secrets -- fetch');
    if (missing.includes('INVITE_RELAY_SECRET')) {
      console.error('  npm run env:set -- INVITE_RELAY_SECRET -f apps/invite-email/.env.production');
    }
    process.exit(1);
  }
  process.exit(deploy(config, secrets));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
