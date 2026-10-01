// Deploy one Worker's code and public vars. Secrets are not part of a
// deploy: `npm run secrets -- <env>` sets them on the Worker, where they stay
// across deploys, and wrangler refuses a deploy while one listed in
// secrets.required is missing. So no build needs a private key
// (docs/environments.md). On Workers Builds, Cloudflare's own token is used;
// locally, the langquest-email profile is.
//
//   node scripts/cloudflare-deploy.mjs apps/web/wrangler.jsonc [preview]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Wrangler's auth arguments: none on Workers Builds, the local profile otherwise. */
export const authArgs = (workersCi = process.env.WORKERS_CI === '1') =>
  workersCi ? [] : ['--profile', 'langquest-email'];

/** Wrangler's config and environment arguments; production is the top level, named as `--env=`. */
export const targetArgs = (config, environment = 'production') =>
  ['-c', config, environment === 'production' ? '--env=' : `--env=${environment}`];

/** Wrangler arguments for one deploy. */
export function deployArgs({ config, workersCi, environment = 'production' }) {
  return ['deploy', ...targetArgs(config, environment), ...authArgs(workersCi)];
}

function main() {
  const [config, environment = 'production'] = process.argv.slice(2);
  if (!config || !['preview', 'production'].includes(environment)) {
    console.error('usage: node scripts/cloudflare-deploy.mjs <wrangler.jsonc> [preview]');
    process.exit(2);
  }
  const args = deployArgs({ config, workersCi: process.env.WORKERS_CI === '1', environment });
  const status = spawnSync('npx', ['wrangler', ...args], { cwd: root, stdio: 'inherit' }).status ?? 1;
  if (status !== 0) {
    console.error(`x deploy failed. If a required secret is missing: npm run secrets -- ${environment}`);
  }
  process.exit(status);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
