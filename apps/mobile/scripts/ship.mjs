#!/usr/bin/env node
// Ship the app to the preview channel (README.md, "Shipping a change"):
//
//   npm run ship -- -m "what changed"           typecheck, then an update on preview
//   npm run ship -- --native                    a new iOS preview build (the fingerprint changed)
//   npm run ship -- --check                     does this tree still match the last build?
//   npm run ship -- --status                    preview's recent updates
//
// Production builds and OTA updates come only from merges into main, through
// .eas/workflows/deploy-to-testers.yml (decisions.md 156), so there is no
// --prod.
//
// Other arguments go to eas as they are (-m "…", --non-interactive).
//
// Before an update goes out, the P0 web UI tests run on the local stack
// (docs/testing.md): the release export of this tree, against the local
// Supabase, so the build people get is the one that passed. No local stack,
// no ship. SHIP_UNTESTED=1 skips them, loudly.
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
if (args.includes('--prod')) {
  console.error('ship: production builds and OTA updates come only from merges into main (decisions.md 156). There is no --prod.');
  process.exit(2);
}
const env = 'preview';
const native = take('--native');
const check = take('--check');
const status = take('--status');
if ([native, check, status].filter(Boolean).length > 1) {
  console.error('usage: npm run ship -- [--native | --check | --status] [eas arguments…]');
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
  if (process.env.SHIP_UNTESTED === '1') {
    console.error('!! shipping UNTESTED (SHIP_UNTESTED=1): the P0 web UI tests did not gate this update.');
  } else {
    console.log('ship: the P0 web UI tests on the export (SHIP_UNTESTED=1 skips them)');
    const r = spawnSync('npm', ['run', '--silent', 'test:ui:web', '--', '--grep', '@p0', '--grep-invert', '@quarantine'],
      { cwd: fileURLToPath(new URL('../..', import.meta.url)), stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('ship: the P0 web UI tests did not all pass (or the local stack is not running: npm run db:start). Refusing to ship.');
      process.exit(r.status ?? 1);
    }
  }
  run('eas', ['update', '--branch', env, '--environment', env, ...args]);
}
