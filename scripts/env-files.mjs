// Where settings live (docs/environments.md). Public settings are plain, in
// each platform's own file: apps/mobile/.env.<env> (EXPO_PUBLIC_*), wrangler
// vars, and the [remotes.<env>] project refs in supabase/config.toml.
// Secrets are encrypted in one file per environment, .env.<env> at the
// repository root, and reach the platforms only through `npm run secrets`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));

/** Hosted environments; development is local and has no secrets. */
export const HOSTED = ['preview', 'production'];

/** The encrypted secrets file of a hosted environment. */
export const secretsPath = (environment) => `.env.${environment}`;

/** Key names an env file holds, without dotenvx's own keys. */
export function envKeyNames(text) {
  return [...text.matchAll(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=/gm)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith('DOTENV_'));
}

/** The project ref [remotes.<environment>] names in supabase/config.toml, or null. */
export function projectRef(configToml, environment) {
  const block = new RegExp(`^\\[remotes\\.${environment}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(configToml);
  return block ? /^project_id\s*=\s*"([a-z0-9]+)"/m.exec(block[1])?.[1] ?? null : null;
}

/**
 * Decrypt the named keys of one env file. The private key comes from
 * DOTENV_PRIVATE_KEY_<ENV> in the environment or from `.env.keys`. Values
 * pass through a private temp file, never argv or stdout.
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

/** Parse a wrangler.jsonc file (JSON with comments). */
export function parseJsonc(text) {
  return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'));
}

/** A wrangler file's settings for one environment; production is the top level. */
export function wranglerFor(config, environment) {
  return environment === 'production' ? config : config.env?.[environment] ?? {};
}
