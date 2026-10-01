// Where each deploy target keeps its encrypted settings, and how to read
// them (docs/environments.md). One dotenvx key pair per environment: every
// file for an environment carries the same DOTENV_PUBLIC_KEY_<ENV>, so one
// private key opens all of them and nothing else.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));

export const ENVIRONMENTS = ['development', 'preview', 'production'];

/** Deploy target to the folder that holds its `.env.<environment>` files. */
export const TARGETS = {
  mobile: 'apps/mobile',
  web: 'apps/web',
  'invite-email': 'apps/invite-email',
  supabase: 'supabase'
};

/** Repository-relative path of one target's env file. */
export function envPath(target, environment) {
  const dir = TARGETS[target];
  if (!dir) throw new Error(`unknown target ${target}; one of ${Object.keys(TARGETS).join(', ')}`);
  if (!ENVIRONMENTS.includes(environment)) throw new Error(`unknown environment ${environment}`);
  return `${dir}/.env.${environment}`;
}

/** The environment a file belongs to, from its name (`.env.preview` is preview). */
export function environmentOf(file) {
  const match = /\.env\.([a-z]+)$/.exec(file);
  return match && ENVIRONMENTS.includes(match[1]) ? match[1] : null;
}

/** The public key an env file was encrypted with, or null. */
export function publicKey(text, environment) {
  const name = `DOTENV_PUBLIC_KEY_${environment.toUpperCase()}`;
  return new RegExp(`^${name}="?([0-9a-f]+)"?`, 'm').exec(text)?.[1] ?? null;
}

/**
 * Files whose public key differs from the rest of their environment. The
 * key most files use wins, so one stray file is the one named.
 * @param {{ file: string, text: string }[]} files
 */
export function publicKeyMismatches(files) {
  /** @type {Map<string, { file: string, key: string | null }[]>} */
  const byEnv = new Map();
  for (const { file, text } of files) {
    const environment = environmentOf(file);
    if (!environment) continue;
    const list = byEnv.get(environment) ?? [];
    list.push({ file, key: publicKey(text, environment) });
    byEnv.set(environment, list);
  }
  const mismatched = [];
  for (const list of byEnv.values()) {
    const counts = new Map();
    for (const { key } of list) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    const [common] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    for (const { file, key } of list) if (key !== common) mismatched.push(file);
  }
  return mismatched.sort();
}

/**
 * Decrypt the named keys of one env file. The private key comes from
 * DOTENV_PRIVATE_KEY_<ENV> in the environment (a build secret) or from
 * `.env.keys`. Values pass through a private temp file, never argv or stdout.
 * @returns {Record<string, string>}
 */
export function decrypt(envFile, names) {
  const dir = mkdtempSync(join(tmpdir(), 'lq-env-'));
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

/** Key names an env file holds, without dotenvx's own keys. */
export function envKeyNames(text) {
  return [...text.matchAll(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=/gm)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith('DOTENV_'));
}
