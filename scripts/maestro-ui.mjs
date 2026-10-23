#!/usr/bin/env node
/**
 * The UI test suite's phone flows (docs/ui-test-suite, decisions.md 95):
 *
 *   npm run test:ui:phone -- --platform ios|android [--device <udid|serial>]
 *     [--app build|dev] [--port 8095] [--tags p0,auth] [--exclude-tags rec]
 *     [--label run] [--reuse-world] [--flow <file>]... [--shards N]
 *     [--voice | --mic] [--wrapped]
 *
 * Flows a run cannot hold are skipped, and the run says which and why
 * (scripts/maestro-plan.mjs): flows tagged `voice` need a microphone signal
 * (--voice loops e2e/fixtures/voice.wav into the host input; --mic says the
 * input already carries voice, as on a device with a person speaking),
 * `android-only` flows need Android's airplane mode, and `wrapped` flows
 * need a step from outside mid-run (--wrapped, and their headers say which).
 * Flows named with --flow run as asked.
 *
 * --shards N runs the flows across N devices (name each with a repeated
 * --device; an iOS run with none uses N booted simulators), through Maestro's
 * --shard-split. Maestro keeps flowsOrder only inside one shard, so the flows
 * config.yaml orders run first, in order, on the first device; the rest are
 * split across all N. --voice (macOS) loops e2e/fixtures/voice.wav
 * into a virtual audio device for the run (the Maestro section of
 * docs/ui-test-suite/README.md).
 *
 * Builds a fresh fixture world on the local stack (e2e/ui/fixture.ts),
 * hands its accounts and passages to Maestro as variables, and runs
 * apps/mobile/test/maestro on the test build installed on the device
 * (`npm run test:ui:build`, its JavaScript inside). With `--app dev` it runs
 * on a dev client instead, loading this checkout's code from Metro on --port
 * (start it with `npm start -w mobile -- --dev-client --port 8095`). Results
 * go to e2e/results/maestro/<platform>/<label>/.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flowTags, plannedSkips, skipReport } from './maestro-plan.mjs';

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
/**
 * The booted simulator, for an iOS run given no device. Without one Maestro
 * picks the first device it finds, which is the Android emulator when both
 * are running: an "iOS" run then tests whatever Android build is installed.
 */
function bootedSimulators() {
  const r = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { encoding: 'utf8' });
  return Object.values(JSON.parse(r.stdout || '{}').devices ?? {}).flat().filter((d) => d.state === 'Booted').map((d) => d.udid);
}
const shards = Number(value('shards', '1'));
if (!Number.isInteger(shards) || shards < 1) throw new Error('--shards is a whole number of devices');
function pickDevices() {
  const named = all('device');
  if (named.length) return named;
  if (platform === 'android') return shards > 1 ? [] : ['emulator-5554'];
  if (process.env.UI_IOS_DEVICE && shards === 1) return [process.env.UI_IOS_DEVICE];
  const booted = bootedSimulators();
  if (booted.length !== shards) throw new Error(`${booted.length} simulators are booted but ${shards} wanted: name them with --device <udid> (or UI_IOS_DEVICE)`);
  return booted;
}
const devices = pickDevices();
if (devices.length !== shards) throw new Error(`--shards ${shards} needs ${shards} devices named with --device (got ${devices.length})`);
const device = devices[0];
const results = join(root, 'e2e/results/maestro', platform, value('label', 'run'));
mkdirSync(results, { recursive: true });

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...opts });
  return r.status ?? 1;
}

// The emulator reaches this machine's Metro, Supabase and Worker through adb reverse.
// adbd runs as root so the offline watcher below can use iptables.
if (platform === 'android') {
  for (const dev of devices) {
    run('adb', ['-s', dev, 'root'], { stdio: 'ignore' });
    run('adb', ['-s', dev, 'wait-for-device']);
    for (const p of [port, '54421', '8787']) run('adb', ['-s', dev, 'reverse', `tcp:${p}`, `tcp:${p}`]);
  }
}

// Animations off while the run lasts, as Android's guidance for UI tests has
// it, and put back as they were when it ends. Maestro reads the screen once it
// is idle, and a screen that animates every frame (the header's sync ring
// during a transfer) is never idle, so a check comes late: after a 9-second
// clip has finished, or a toast has gone. React Native reads a zero
// transition scale as Reduce Motion, which the app honours.
const ANIMATION_SCALES = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'];
if (platform === 'android') for (const dev of devices) {
  const setting = (...a) => spawnSync('adb', ['-s', dev, 'shell', 'settings', ...a], { encoding: 'utf8' });
  const before = ANIMATION_SCALES.map((s) => setting('get', 'global', s).stdout.trim());
  for (const s of ANIMATION_SCALES) setting('put', 'global', s, '0');
  process.on('exit', () => ANIMATION_SCALES.forEach((s, i) => {
    const was = before[i];
    if (was && was !== 'null') setting('put', 'global', s, was); else setting('delete', 'global', s);
  }));
}

// Accessibility's "Time to take action" at 10 s while the run lasts, and put
// back as it was. A toast shows 3.5 s unless this asks for longer (decision 158),
// and Maestro, which reads the screen once it is idle, often reads it after a
// 3.5 s toast has gone on an emulator: its Back or tap settles in about 4 s.
const UI_TIMEOUTS = ['accessibility_interactive_ui_timeout_ms', 'accessibility_non_interactive_ui_timeout_ms'];
if (platform === 'android') for (const dev of devices) {
  const setting = (...a) => spawnSync('adb', ['-s', dev, 'shell', 'settings', ...a], { encoding: 'utf8' });
  const before = UI_TIMEOUTS.map((s) => setting('get', 'secure', s).stdout.trim());
  for (const s of UI_TIMEOUTS) setting('put', 'secure', s, '10000');
  process.on('exit', () => UI_TIMEOUTS.forEach((s, i) => {
    const was = before[i];
    if (was && was !== 'null') setting('put', 'secure', s, was); else setting('delete', 'secure', s);
  }));
}

// Reduce Motion on in the simulator while the run lasts, as Android's zero
// animation scales are, and put back as it was. XCUITest reads the screen once
// the app is idle, and a toast's bar running down kept it busy until the toast
// had gone (decision 158). Each flow's clean start reads the setting afresh.
if (platform === 'ios') for (const dev of devices) {
  const defaults = (...a) => spawnSync('xcrun', ['simctl', 'spawn', dev, 'defaults', a[0], 'com.apple.Accessibility', 'ReduceMotionEnabled', ...a.slice(1)], { encoding: 'utf8' });
  const was = defaults('read');
  defaults('write', '-bool', 'true');
  process.on('exit', () => {
    if (was.status === 0) defaults('write', '-bool', was.stdout.trim() === '1' ? 'true' : 'false');
    else defaults('delete');
  });
}

// Airplane mode does not cut adb reverse ports, and a connection already open
// through one stays open, so a flow that "goes offline" with setAirplaneMode
// would still reach the local server. While the run lasts, a watcher rejects
// the phone's traffic to the Supabase and Worker ports (iptables, in the
// emulator) when it is in airplane mode and lets it through when it is not.
// Metro's port stays open.
const OFFLINE_PORTS = ['54421', '8787'];
if (platform === 'android') for (const device of devices) {
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
  // Rows that list people carry the profile id in their testID (ask-person-<id>).
  env[`${k}_ID`] = a.id ?? '';
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
const flowsDir = join(root, 'apps/mobile/test/maestro');
const flowFiles = readdirSync(join(flowsDir, 'flows')).filter((f) => f.endsWith('.yaml')).sort().map((f) => join(flowsDir, 'flows', f));

// What this run cannot hold is skipped and said, not failed (scripts/maestro-plan.mjs).
const skips = plannedSkips({ platform, voice: args.includes('--voice'), mic: args.includes('--mic'), wrapped: args.includes('--wrapped'), flows });
for (const line of skipReport(skips, flowFiles.map((f) => ({ name: f.replace(/^.*\//, '').replace(/\.yaml$/, ''), tags: flowTags(readFileSync(f, 'utf8')) })))) console.log(line);
const excludeTags = [...value('exclude-tags', '').split(',').filter(Boolean), ...skips.map((s) => s.tag)].join(',');

// --voice: the simulator and emulator hear the host's input, so loop the voice
// clip into a virtual audio device (BlackHole or similar) for the run.
if (args.includes('--voice')) startVoice();
function startVoice() {
  const wav = join(root, 'e2e/fixtures/voice.wav');
  if (process.platform !== 'darwin') throw new Error('--voice is for macOS hosts: on Linux, loop voice.wav into a PulseAudio null sink and make its monitor the default source');
  const out = spawnSync('system_profiler', ['SPAudioDataType'], { encoding: 'utf8' }).stdout ?? '';
  const virtual = [...out.matchAll(/^\s{8}(.+):$/gm)].map((m) => m[1]).find((n) => /blackhole|loopback|soundflower|vb-cable|virtual/i.test(n));
  if (!virtual) {
    throw new Error([
      '--voice needs a virtual audio device and none is installed.',
      '  1. brew install --cask blackhole-2ch   (then restart CoreAudio or log out and in)',
      '  2. System Settings > Sound > Input: choose "BlackHole 2ch" (the iOS Simulator and the',
      '     Android emulator use the Mac\'s input; for the emulator also turn on',
      '     Extended controls > Microphone > "Virtual microphone uses host audio input").',
      '  3. Send voice.wav to the device: Audio MIDI Setup > create a Multi-Output Device with',
      '     BlackHole 2ch and set it as the output (afplay plays to the system output).',
      '  Then run again with --voice.'
    ].join('\n'));
  }
  console.log(`--voice: looping voice.wav to the default output (found ${virtual}; set it as the Mac's input, and the output to it or a Multi-Output Device)`);
  // afplay has no device switch: it plays to the system output, so the output must be the virtual device
  // (or a Multi-Output Device that includes it). Loop until the run ends.
  const player = spawn('bash', ['-c', `while true; do afplay ${JSON.stringify(wav)}; done`], { stdio: 'ignore', detached: true });
  process.on('exit', () => { try { process.kill(-player.pid); } catch { /* already gone */ } });
}

const baseArgs = (deviceIds) => [
  ...(deviceIds.length ? ['--device', deviceIds.join(',')] : []), 'test',
  ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
  ...(tags ? ['--include-tags', tags] : []),
  ...(excludeTags ? ['--exclude-tags', excludeTags] : [])
];
const report = (name) => ['--format', 'junit', '--output', join(results, name), '--test-output-dir', results];

if (shards === 1) {
  process.exit(run('maestro', [...baseArgs(devices), ...report('report.xml'), ...(flows.length ? flows : [flowsDir])]));
}

// Sharded. Maestro orders flows only within a shard, so run the ordered ones
// first, one after another on the first device, then split the rest.
const config = readFileSync(join(flowsDir, 'config.yaml'), 'utf8');
const ordered = [...(config.split('flowsOrder:')[1] ?? '').matchAll(/^\s+-\s+"([^"]+)"/gm)].map((m) => m[1]);
const files = flows.length ? flows : flowFiles;
const nameOf = (f) => /^name:\s*"?(.+?)"?\s*$/m.exec(readFileSync(f, 'utf8'))?.[1];
const byName = new Map(files.map((f) => [nameOf(f), f]));
const first = ordered.map((n) => byName.get(n)).filter(Boolean);
const rest = files.filter((f) => !first.includes(f));
let status = 0;
if (first.length) status = run('maestro', [...baseArgs([device]), ...report('report-ordered.xml'), ...first]);
if (rest.length) {
  // Maestro writes one junit report for the run, covering every shard.
  status = run('maestro', [...baseArgs(devices), '--shard-split', String(shards), ...report('report.xml'), ...rest]) || status;
}
process.exit(status);
