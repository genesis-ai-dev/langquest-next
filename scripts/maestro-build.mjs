#!/usr/bin/env node
/**
 * The app build the phone flows run on (decisions.md 95):
 *
 *   npm run test:ui:build -- --platform ios --device <simulator udid>
 *   npm run test:ui:build -- --platform android --device <avd name, e.g. Pixel_6>
 *
 * A release build with its JavaScript inside, pointed at the local stack
 * (.env.development): no Metro, no dev launcher and no developer menu, so a
 * flow's clean start takes seconds instead of a bundle download, and every
 * flow sees the code as built. Rebuild after changing the app's code.
 *
 * It is marked a local release (EXPO_PUBLIC_LOCAL_RELEASE, src/supabase.ts),
 * and two settings change in the generated native folders only (they are
 * ignored by version control; `expo prebuild --clean` drops the changes),
 * never in app.json, so no store build can carry them: over-the-air updates
 * off, and on Android plain http allowed, since release builds refuse it and
 * the local stack is http://127.0.0.1.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const app = join(root, 'apps/mobile');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const platform = value('platform', 'ios');
const device = value('device', '');
if (!['ios', 'android'].includes(platform)) throw new Error('--platform is ios or android');
if (!device) throw new Error('--device is required (a simulator udid, or an Android Virtual Device name)');

// The repository's tools (dotenvx, expo) as `npm run` would find them.
const PATH = [join(app, 'node_modules/.bin'), join(root, 'node_modules/.bin'), process.env.PATH].join(':');
// A release build refuses a local server unless told it is a local test build (src/supabase.ts).
// Its own empty Metro cache, so that setting reaches every file (metro.config.js).
const METRO_CACHE_DIR = join(app, '.expo/ui-test-build-metro-cache');
rmSync(METRO_CACHE_DIR, { recursive: true, force: true });
const BUILD_ENV = { ...process.env, PATH, CI: '1', LANG: 'en_US.UTF-8', EXPO_PUBLIC_LOCAL_RELEASE: '1', METRO_CACHE_DIR };

function run(cmd, cmdArgs, cwd = app) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: BUILD_ENV });
  if (r.status !== 0) {
    console.error(`x ${cmd} ${cmdArgs.join(' ')} failed (${r.status ?? r.error?.message})`);
    process.exit(r.status || 1);
  }
}

/** Change a generated native file for this local build only, once; say what changed. */
function patch(file, from, to, what) {
  const text = readFileSync(file, 'utf8');
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`${file}: cannot set ${what} (expected ${from})`);
  writeFileSync(file, text.replace(from, to));
  console.log(`${file.slice(app.length + 1)}: ${what}`);
}

// No over-the-air updates in a test build: it runs the code it was built with,
// and a failed update check would put a banner over every screen.
if (platform === 'android') {
  if (!existsSync(join(app, 'android'))) run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install']);
  const manifest = join(app, 'android/app/src/main/AndroidManifest.xml');
  patch(manifest, '<application ', '<application android:usesCleartextTraffic="true" ', 'plain http allowed (the local stack is http://127.0.0.1)');
  patch(manifest, '<meta-data android:name="expo.modules.updates.ENABLED" android:value="true"/>',
    '<meta-data android:name="expo.modules.updates.ENABLED" android:value="false"/>', 'updates off');
  // The JavaScript is bundled by Gradle, which counts the bundle up to date when no file
  // changed (the EXPO_PUBLIC_* settings are not files) and keeps the environment its daemon
  // started with. A fresh daemon and no old bundle, so the build is always the code and
  // settings of now.
  run('./gradlew', ['--stop'], join(app, 'android'));
  rmSync(join(app, 'android/app/build/generated/assets/react'), { recursive: true, force: true });
  run('node', ['scripts/with-env.mjs', 'development', 'npx', 'expo', 'run:android', '--variant', 'release', '--device', device, '--no-bundler']);
} else {
  if (!existsSync(join(app, 'ios'))) run('npx', ['expo', 'prebuild', '--platform', 'ios', '--no-install']);
  patch(join(app, 'ios/LangQuestNext/Supporting/Expo.plist'), '<key>EXUpdatesEnabled</key>\n    <true/>',
    '<key>EXUpdatesEnabled</key>\n    <false/>', 'updates off');
  run('node', ['scripts/with-env.mjs', 'development', 'npx', 'expo', 'run:ios', '--configuration', 'Release', '--device', device, '--no-bundler']);
}
console.log(`\nInstalled the ${platform} test build on ${device}. Run the flows with: npm run test:ui:phone -- --platform ${platform}`);
