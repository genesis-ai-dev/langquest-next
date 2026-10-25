#!/usr/bin/env node
// The web build (decisions.md 58): `npm run export:web -- <development|preview|production>`.
//
// 1. `expo export -p web` with that environment's public settings
//    (apps/mobile/.env.<env>) and EXPO_PUBLIC_BUILD_ID, the commit.
// 2. `version.json` beside the page, which the open app polls to offer a
//    reload after a deploy (UpdateBanner.web.tsx).
// 3. Source maps moved out of what is served, to dist-sourcemaps/: rebuild
//    the commit a diagnostics record names to read a stack (docs/diagnostics.md).
// 4. `_headers`, which the Worker's static assets serve with the files:
//    a content security policy built from what the app loads, and caching.
//
// The Worker in apps/web serves dist/ (its wrangler.jsonc).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor } from './webHeaders.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const env = process.argv[2] ?? 'production';
if (!['development', 'preview', 'production'].includes(env)) {
  console.error(`usage: npm run export:web -- <development|preview|production>, got ${env}`);
  process.exit(2);
}
const dist = path.join(app, 'dist');
const maps = path.join(app, 'dist-sourcemaps');

const build = process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 12)
  ?? execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: app }).toString().trim();
const settings = Object.fromEntries(fs.readFileSync(path.join(app, `.env.${env}`), 'utf8').split('\n')
  .map((l) => /^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]));
const supabaseUrl = settings.EXPO_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) throw new Error(`.env.${env} has no EXPO_PUBLIC_SUPABASE_URL`);

fs.rmSync(dist, { recursive: true, force: true });
fs.rmSync(maps, { recursive: true, force: true });
execFileSync('npx', ['dotenvx', 'run', '-f', `.env.${env}`, '--strict', '--', 'npx', 'expo', 'export', '-p', 'web', '--output-dir', 'dist', '--source-maps', 'external', '--clear'], {
  cwd: app,
  stdio: 'inherit',
  env: {
    ...process.env, EXPO_NO_DOTENV: '1', EXPO_PUBLIC_BUILD_ID: build, NODE_ENV: 'production',
    // The Worker that serves this build answers its /api too: always the page's own origin, whichever
    // address it was opened at (EXPO_PUBLIC_API_URL is for phones and Metro). dotenvx keeps a value already set.
    EXPO_PUBLIC_API_URL: '',
    // A development export is a release build of the local stack, for the web smoke test (src/server/supabase.ts).
    ...(env === 'development' ? { EXPO_PUBLIC_LOCAL_RELEASE: '1' } : {})
  }
});

fs.writeFileSync(path.join(dist, 'version.json'), `${JSON.stringify({ build })}\n`);

// The speech model and the runtime it needs (modules/microphone-energy/src/speechModel.web.ts,
// decision 135): served as files, loaded when the microphone first opens, so
// they are in neither JavaScript budget below. NO_SPEECH_MODEL=1 leaves them
// out, for the UI tests, whose microphones are tones: their parts are timed
// by level, as without a model (e2e/ui-web.sh, e2e/web-smoke.sh).
if (process.env.NO_SPEECH_MODEL !== '1') {
  const ortDist = path.dirname(createRequire(import.meta.url).resolve('onnxruntime-web'));
  fs.mkdirSync(path.join(dist, 'ort'), { recursive: true });
  for (const name of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    fs.copyFileSync(path.join(ortDist, name), path.join(dist, 'ort', name));
  }
  fs.mkdirSync(path.join(dist, 'models'), { recursive: true });
  fs.copyFileSync(path.join(app, 'modules/microphone-energy/models/silero_vad_16k_op15.onnx'), path.join(dist, 'models', 'silero_vad_16k_op15.onnx'));
}

// The other languages' words, fetched by a browser when someone picks one
// (src/i18n/catalogs.web.ts), so a first visit downloads English only.
const catalogs = path.join(app, 'src/i18n');
fs.mkdirSync(path.join(dist, 'i18n'), { recursive: true });
for (const name of fs.readdirSync(catalogs).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
  fs.writeFileSync(path.join(dist, 'i18n', name), JSON.stringify(JSON.parse(fs.readFileSync(path.join(catalogs, name), 'utf8'))));
}

// Two fitness functions (decisions.md 58): the JavaScript a first visit
// downloads (the files index.html loads), and all of it (every chunk, loaded
// or not). They were one number until screens were split into chunks that
// load when opened (src/shell/lazyScreens.tsx).
// 4.8 MB when this was set (catalog data, study texts, the map's shapes); a
// rise past it is a change someone should notice, not drift. Raised to 6 MB
// with localization (decision 81): the app's words moved from the code into
// the English catalog, which also carries their keys, and i18next came with
// them (5.67 MB then). The other languages' catalogs stay out of it: a browser
// fetches only the one chosen (src/i18n/catalogs.web.ts). Raised to 6.1 MB
// when the app's logic moved out of its screens into small modules
// (decision 105): Metro wraps each module, about half a kilobyte apiece,
// and 57 new ones cost 30 KB beyond the code they moved (6.01 MB then).
// Raised to 6.25 MB when every part of every screen got its help line
// (decision 71, amended 2026-10-14): 883 English lines add 59 KB to the
// catalog a first visit downloads (6.17 MB then).
// Then the split: Reports, Config, Org, Content, Checks, Sources and
// Reference load when first opened. The first visit's budget is 5.7 MB (5.41
// MB then, 5% of room), and the 6.25 MB above stays as the cap on every chunk
// together (6.21 MB then). That cap rose to 6.5 MB when main's security fixes
// and field diagnostics merged with the split (6.26 MB in all, a first visit
// 5.46 MB): it catches growth that runs away, and what a visit pays is held
// by the first-visit budget (decision 123). 6.55 MB since notes on what a
// check shows (decision 149) took it to 6.51 MB, 15 KB of that their lines
// in 15 languages after six were merged into two. 6.6 MB since uploads and
// downloads shown by passage, with their moving packages (decision 166), took
// it 5 KB past 6.55 MB; a first visit stays under its own budget.
const TOTAL_BUDGET_BYTES = 6.6 * 1024 * 1024;
// A first visit's cap rose to 5.75 MB when Global Viewers' read-only guard on
// the recorder (decisions.md 158) took it past 5.7 MB by a few hundred bytes
// (5.70 MB then): main had 50 bytes left, and a guard that refuses before the
// microphone opens has to be loaded with the recorder.
const FIRST_VISIT_BUDGET_BYTES = 5.75 * 1024 * 1024;

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
let moved = 0;
for (const file of walk(dist).filter((f) => f.endsWith('.map'))) {
  const to = path.join(maps, path.relative(dist, file));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(file, to);
  moved++;
}
// The bundles still name their maps; nothing serves them, so the browser asks once and gets the page.
for (const file of walk(dist).filter((f) => f.endsWith('.js'))) {
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n\/\/# sourceMappingURL=.*$/m, ''));
}

// Universal links and app links (appLinks.json): written once their IDs are filled in.
const links = JSON.parse(fs.readFileSync(path.join(app, 'appLinks.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(app, 'app.json'), 'utf8')).expo;
const wellKnown = path.join(dist, '.well-known');
if (links.appleTeamId) {
  fs.mkdirSync(wellKnown, { recursive: true });
  fs.writeFileSync(path.join(wellKnown, 'apple-app-site-association'), JSON.stringify({
    applinks: { details: [{ appIDs: [`${links.appleTeamId}.${config.ios.bundleIdentifier}`], components: links.paths.map((p) => ({ '/': p })) }] }
  }, null, 2));
}
if (links.androidSha256.length) {
  fs.mkdirSync(wellKnown, { recursive: true });
  fs.writeFileSync(path.join(wellKnown, 'assetlinks.json'), JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: config.android.package, sha256_cert_fingerprints: links.androidSha256 }
  }], null, 2));
}
if (!links.appleTeamId || !links.androidSha256.length) console.warn('appLinks.json is not filled in: links will open the web app on phones too.');

const scriptBytes = walk(path.join(dist, '_expo')).filter((f) => f.endsWith('.js') && !f.includes('/worker-')).reduce((n, f) => n + fs.statSync(f).size, 0);
const entryScripts = [...fs.readFileSync(path.join(dist, 'index.html'), 'utf8').matchAll(/<script[^>]*\ssrc="([^"]+\.js)"/g)].map((m) => m[1]);
if (entryScripts.length === 0) throw new Error('dist/index.html loads no script: the first-visit budget has nothing to measure');
const entryBytes = entryScripts.reduce((n, src) => n + fs.statSync(path.join(dist, src)).size, 0);
const mb = (n) => (n / 1048576).toFixed(2);
for (const [what, bytes, budget] of [['a first visit', entryBytes, FIRST_VISIT_BUDGET_BYTES], ['all chunks', scriptBytes, TOTAL_BUDGET_BYTES]]) {
  if (bytes > budget) {
    console.error(`x the web app's JavaScript for ${what} is ${mb(bytes)} MB, over its ${mb(budget)} MB budget by ${((bytes - budget) / 1024).toFixed(0)} KB (scripts/export-web.mjs). Trim it, load the screen that grew when it is opened (src/shell/lazyScreens.tsx), or raise the budget in the same change and say why.`);
    process.exit(1);
  }
}

fs.writeFileSync(path.join(dist, '_headers'), headersFor({ supabaseUrl }));
console.log(`web build ${build} for ${env} in apps/mobile/dist: ${mb(entryBytes)} MB of JavaScript on a first visit, ${mb(scriptBytes)} MB in all (${moved} source maps kept in dist-sourcemaps/, not served)`);
