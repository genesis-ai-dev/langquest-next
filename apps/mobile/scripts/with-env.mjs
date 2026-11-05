#!/usr/bin/env node
// Runs a command with one environment's app settings (docs/environments.md):
//
//   node scripts/with-env.mjs development expo start
//   node scripts/with-env.mjs preview expo run:android --variant release --device
//
// development reads .env.development.local (yours, ignored by git; optional)
// over .env.development; preview and production read their committed file.
// Expo's own .env loading is off, so these files are the only source.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const [env, ...command] = process.argv.slice(2);
if (!['development', 'preview', 'production'].includes(env) || !command.length) {
  console.error('usage: node scripts/with-env.mjs <development|preview|production> <command> [args…]');
  process.exit(2);
}

const files = env === 'development'
  ? ['-f', '.env.development.local', '-f', '.env.development', '--ignore=MISSING_ENV_FILE']
  : ['-f', `.env.${env}`];
const r = spawnSync('dotenvx', ['run', ...files, '--strict', '-e', 'EXPO_NO_DOTENV=1', '--', ...command], { cwd: app, stdio: 'inherit' });
if (r.error) console.error(`x dotenvx: ${r.error.message}`);
process.exit(r.status ?? 1);
