#!/usr/bin/env node
/**
 * The UI test suite's phone flows (docs/ui-test-suite, decisions.md 95):
 *
 *   npm run test:ui:phone -- --platform ios|android [--device <udid|serial>]
 *     [--app build|dev] [--port 8095] [--tags p0,auth] [--exclude-tags wrapped]
 *     [--label run] [--reuse-world] [--flow <file>]...
 *
 * Builds a fresh fixture world on the local stack (smart-tests/ui/fixture.ts),
 * hands its accounts and passages to Maestro as variables, and runs
 * apps/mobile/test/maestro on the test build installed on the device
 * (`npm run test:ui:build`, its JavaScript inside). With `--app dev` it runs
 * on a dev client instead, loading this checkout's code from Metro on --port
 * (start it with `npm start -w mobile -- --dev-client --port 8095`). Results
 * go to smart-tests/results/maestro/<platform>/<label>/.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const all = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));

const platform = value('platform', 'ios');
if (!['ios', 'android'].includes(platform)) throw new Error('--platform is ios or android');
const port = value('port', '8095');
const device = value('device', platform === 'android' ? 'emulator-5554' : process.env.UI_IOS_DEVICE ?? '');
const results = join(root, 'smart-tests/results/maestro', platform, value('label', 'run'));
mkdirSync(results, { recursive: true });

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...opts });
  return r.status ?? 1;
}

// The emulator reaches this machine's Metro, Supabase and Worker through adb reverse.
// adbd runs as root so the offline watcher below can use iptables.
if (platform === 'android') {
  run('adb', ['-s', device, 'root'], { stdio: 'ignore' });
  run('adb', ['-s', device, 'wait-for-device']);
  for (const p of [port, '54421', '8787']) run('adb', ['-s', device, 'reverse', `tcp:${p}`, `tcp:${p}`]);
}

// Airplane mode does not cut adb reverse ports, and a connection already open
// through one stays open, so a flow that "goes offline" with setAirplaneMode
// would still reach the local server. While the run lasts, a watcher rejects
// the phone's traffic to the Supabase and Worker ports (iptables, in the
// emulator) when it is in airplane mode and lets it through when it is not.
// Metro's port stays open.
const OFFLINE_PORTS = ['54421', '8787'];
if (platform === 'android') {
  const script = `
    const { spawnSync } = require('node:child_process');
    const dev = ${JSON.stringify(device)}, ports = ${JSON.stringify(OFFLINE_PORTS)};
    let cut = false;
    const adb = (...a) => spawnSync('adb', ['-s', dev, ...a], { encoding: 'utf8' });
    const rule = (p) => ['OUTPUT', '-p', 'tcp', '-d', '127.0.0.1', '--dport', p, '-j', 'REJECT', '--reject-with', 'tcp-reset'];
    const cutOff = () => { for (const p of ports) adb('shell', 'iptables', '-I', ...rule(p)); };
    const restore = () => { for (const p of ports) adb('shell', 'iptables', '-D', ...rule(p)); };
    setInterval(() => {
      const on = adb('shell', 'settings', 'get', 'global', 'airplane_mode_on').stdout.trim() === '1';
      if (on && !cut) { cutOff(); cut = true; }
      if (!on && cut) { restore(); cut = false; }
    }, 400);
  `;
  const watcher = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
  process.on('exit', () => {
    watcher.kill();
    // Leave nothing rejected behind (a rule may be there once or not at all).
    for (const p of OFFLINE_PORTS) {
      for (let i = 0; i < 3; i++) spawnSync('adb', ['-s', device, 'shell', 'iptables', '-D', 'OUTPUT', '-p', 'tcp', '-d', '127.0.0.1', '--dport', p, '-j', 'REJECT', '--reject-with', 'tcp-reset'], { stdio: 'ignore' });
    }
  });
}

// A fresh world for this run (a world per run keeps runs apart on the shared local database).
const worldFile = join(results, 'world.json');
if (!args.includes('--reuse-world')) {
  const status = run('npx', ['tsx', 'scripts/ui-fixture.ts', '--out', worldFile]);
  if (status !== 0) process.exit(status);
}
const world = JSON.parse(readFileSync(worldFile, 'utf8'));

// The test build (npm run test:ui:build) by default; --app dev for a dev client on Metro.
const appKind = value('app', 'build');
if (!['build', 'dev'].includes(appKind)) throw new Error('--app is build or dev');
const env = {
  DEV_CLIENT: appKind === 'dev' ? 'true' : 'false',
  DEV_CLIENT_URL: `${platform === 'ios' ? 'langquestnext' : 'exp+langquest-next'}://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${port}`)}`,
  METRO_URL: `http://127.0.0.1:${port}`,
  ORG_NAME: world.orgName,
  ORG2_NAME: world.org2Name
};
for (const [key, a] of Object.entries(world.accounts)) {
  const k = key.toUpperCase();
  env[`${k}_EMAIL`] = a.email ?? '';
  env[`${k}_PASSWORD`] = a.password ?? '';
  env[`${k}_NAME`] = a.name ?? '';
  env[`${k}_FIRST`] = (a.name ?? '').split(' ')[0];
  if (a.signInName) env[`${k}_SIGNIN`] = a.signInName;
}
for (const [key, p] of Object.entries(world.passages)) {
  const k = key.toUpperCase().replace(/-/g, '_');
  env[k] = p.label;
  env[`${k}_REF`] = p.ref;
  // What to type in the Map's search to list it: its book and chapter ("Luke 13").
  env[`${k}_SEARCH`] = p.ref.replace(/:.*$/, '');
}
for (const [key, l] of Object.entries(world.languages)) env[`LANG_${key}`] = l.name;

const flows = all('flow');
const tags = value('tags', '');
const excludeTags = value('exclude-tags', '');
const maestroArgs = [
  ...(device ? ['--device', device] : []), 'test',
  ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
  ...(tags ? ['--include-tags', tags] : []),
  ...(excludeTags ? ['--exclude-tags', excludeTags] : []),
  '--format', 'junit', '--output', join(results, 'report.xml'), '--test-output-dir', results,
  ...(flows.length ? flows : [join(root, 'apps/mobile/test/maestro')])
];
process.exit(run('maestro', maestroArgs));
