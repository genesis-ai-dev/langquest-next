#!/usr/bin/env node
// Ship the app (README.md, "Shipping a change"). Preview unless --prod:
//
//   npm run ship -- -m "what changed"           typecheck, then an update on the channel
//   npm run ship -- --native                    a new iOS build (the fingerprint changed)
//   npm run ship -- --check                     does this tree still match the last build?
//   npm run ship -- --status                    the channel's recent updates
//   npm run ship -- --prod …                    any of the above against production
//
// Other arguments go to eas as they are (-m "…", --non-interactive).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const env = take('--prod') ? 'production' : 'preview';
const native = take('--native');
const check = take('--check');
const status = take('--status');
if ([native, check, status].filter(Boolean).length > 1) {
  console.error('usage: npm run ship -- [--prod] [--native | --check | --status] [eas arguments…]');
  process.exit(2);
}

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: app, stdio: 'inherit' });
  if (r.error) console.error(`x ${cmd}: ${r.error.message}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (check) run('eas', ['fingerprint:compare', ...args]);
else if (status) run('eas', ['update:list', '--branch', env, '--limit', '5', ...args]);
else if (native) run('eas', ['build', '--profile', env, '--platform', 'ios', ...args]);
else {
  run('npm', ['run', '--silent', 'typecheck']);
  run('eas', ['update', '--branch', env, '--environment', env, ...args]);
}
