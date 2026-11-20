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
// decision 135), and Clean up's DeepFilterNet3 on the same runtime
// (cleanUp.web.ts, decision 179): served as files, loaded when the
// microphone first opens or a part is first cleaned, so they are in neither
// JavaScript budget below. NO_SPEECH_MODEL=1 leaves them out, for the UI
// tests, whose microphones are tones: their parts are timed by level, as
// without a model (e2e/ui-web.sh, e2e/web-smoke.sh).
if (process.env.NO_SPEECH_MODEL !== '1') {
  const ortDist = path.dirname(createRequire(import.meta.url).resolve('onnxruntime-web'));
  fs.mkdirSync(path.join(dist, 'ort'), { recursive: true });
  for (const name of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    fs.copyFileSync(path.join(ortDist, name), path.join(dist, 'ort', name));
  }
  fs.mkdirSync(path.join(dist, 'models'), { recursive: true });
  for (const name of ['silero_vad_16k_op15.onnx', 'deepfilter.onnx']) {
    fs.copyFileSync(path.join(app, 'modules/microphone-energy/models', name), path.join(dist, 'models', name));
  }
}

// The other languages' words, fetched by a browser when someone picks one
// (src/i18n/catalogs.web.ts), so a first visit downloads English only. Nearby
// sync's words (src/nearby/i18n) join each file, since the web bundles only
// their English, with the nearby screens (src/nearby/nearbyWords.web.ts).
const catalogs = path.join(app, 'src/i18n');
const nearbyWords = path.join(app, 'src/nearby/i18n');
fs.mkdirSync(path.join(dist, 'i18n'), { recursive: true });
for (const name of fs.readdirSync(catalogs).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
  const words = JSON.parse(fs.readFileSync(path.join(catalogs, name), 'utf8'));
  const nearby = path.join(nearbyWords, name);
  if (fs.existsSync(nearby)) Object.assign(words, JSON.parse(fs.readFileSync(nearby, 'utf8')));
  fs.writeFileSync(path.join(dist, 'i18n', name), JSON.stringify(words));
}

// Two fitness functions (decisions.md 58): the JavaScript a first visit
// downloads (the files index.html loads), and all of it (every chunk, loaded
// or not). They were one number until screens were split into chunks that
// load when opened (src/shell/lazyScreens.tsx). The production export is the
// one held to them: Workers Builds builds it, and its settings make it about
// 500 bytes bigger than the development export the tests serve, so CI's
// web-smoke and `npm run guardrails -- --web` build it too (decision 123).
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
// Lowered to 4.75 MB when icons came one file each (src/ui/icons.ts) instead
// of through lucide's entry, which brought all 1,800-odd: 6.54 MB to 4.54 MB
// in all (performance-audit-2026-10-26.md item 1, decision 123 amended).
// Raised to 4.85 MB when the UI audit's fixes across the app (the audit of
// 2026-10-28, decision 185) took it 13 KB past 4.75 MB partway through (4.76
// MB then): what they add is screens' code, and a first visit stays under its
// own budget. Raised to 4.9 MB when the fixes from Carl's UI review
// (LAN-125 to LAN-144, 2026-11-02) took it 2 KB past 4.85 MB: they too are
// screens' code (a Bible pane that follows the voice, hints, New cluster, a
// third way to join), and a first visit stays under its own budget.
// Raised to 4.92 MB with Share nearby (Carl, 2026-11-07), 4.92 MB then (4.90
// MB before): 13 KB is its screen's chunk, which the web never opens but the
// screen map names, and the rest its English words and the Sync and History
// lines; its radios, cover and per-phone code stay in .android files.
// Raised to 4.93 MB with "A phone of mine was lost or taken" (Carl,
// 2026-11-08), 4.92 MB then: it took all chunks 1.4 KB past 4.92 MB, its
// words in 16 catalogs and the New password and More settings rows; a first
// visit stays under its own budget.
// Raised by 2 KB with joining offline's identity side (Carl, 2026-11-08), 1.0 KB
// past 4.93 MB then: the first visit's growth below, which every chunk counts too.
// Raised by 34 KB with joining offline's screens (Carl, 2026-11-08), 34 KB past then: the first
// visit's growth below, and 17 KB in the nearby chunk for Let someone in and Join without internet,
// which the web never opens but the screen map names; their QR code, radios and passes stay in
// .android files.
// Raised by 3 KB with the carried build (Carl, 2026-11-08), 2 KB past then: the install file's lines
// on Let someone in, in every language's catalog.
// Raised by 1 KB with Remove me from this phone and a helper's code for a local person (Carl,
// 2026-11-08), 337 bytes past then: their English words in the catalog every visit carries, and
// sign-in's id for the code; the row and the removal stay in .android files.
// Raised by 1 KB with the SQL driver asking a native call again after a lookup that missed (Carl,
// 2026-11-09), 250 bytes past then: the store every client opens steps a write through prepare, run
// and finalize, each asked again, so expo-modules-core's unlocked lookup cannot drop or repeat it.
// Raised by 3 KB with getting and checking the install file on Let someone in (Carl, 2026-11-09,
// decision 246 as amended), 2,900 bytes past then: the first visit's growth below, and the install
// file part, its rules and the stub the web takes for its hook in the nearby chunk, which the web
// never opens; the browser link, the meta row and the file picker stay in .android files.
// Raised by 3 KB with Get the install file split from Let someone in (Carl, 2026-11-09, decision 246
// amended again), 2,845 bytes past then: the new screen, Share nearby's second row and Let someone
// in's line in the nearby chunk, which the web never opens; the words in all 16 catalogs; and the
// screen's id and edges in the flow. A first visit stays under its own budget (163 bytes left).
// Raised by 1 KB with Share nearby's two jobs (Carl, 2026-11-09), 689 bytes past then: the first
// visit's growth below, and the two headed sections and the Sync row's rule in the nearby chunk,
// which the web never opens.
// Raised by 2 KB with the Sync reminders to get the install file (Carl, 2026-11-09, decision 246
// amended again), 1,189 bytes past then: the first visit's growth below, and the reminder's rule
// in the model the nearby chunk carries, which the web never opens.
// Raised by 5 KB with the fixes from the two-emulator test and main merged in (Carl, 2026-11-09),
// 4,505 bytes past then: the starting copy's checkpoint, the copy-short line and its words in all 16
// catalogs, names from checked chains, the join link's route, the start deadline and Ready to carry's
// server check, most of it in the nearby chunk, which the web never opens; and main's own growth.
// Lowered by 5 KB with a trim pass (Carl, 2026-11-10): nearby sync's words left the catalogs and
// join each language's file the web serves, so a fetched catalog no longer duplicates them.
// Raised by 15 KB with main merged in (Carl, 2026-11-12), 13,852 bytes past then: main's
// organization export sheet and recorded key-term examples, whose own budget main kept at
// 4.9 MB; with nearby sync's chunks they no longer fit the branch's.
// Raised by 50 KB with Expo SDK 58 (Carl, 2026-11-11, decision 250), 50,620 bytes past then:
// the first visit's growth below, which every chunk counts too.
// Both raises together with nearby sync merged in (Carl, 2026-11-12): the upgrades come to 49,438
// bytes over nearby sync's 65 KB, 1,762 bytes under the two together.
// Raised by 3 KB with back translation's two rows (Caleb Koster, 2026-11-13, LAN-234), 1 KB past then:
// the same words and rows' model as the first visit's raise below, which every chunk counts too.
// Raised by 2 KB with the app lock (Caleb Koster, 2026-11-16, LAN-255), 35 bytes past then with main
// merged in (the Map's download card, LAN-253): the first visit's raise below, which every chunk counts too.
// Raised by 1 KB when nearby sync on iPhones (Carl, 2026-11-17, decision 256) merged with main: the
// production export came out 437 bytes past and Workers Builds refused to deploy it, though the
// development export CI measured then was 59 bytes under. CI now measures the production export.
// Raised by 1 KB with carried files matched by their versions (Carl, 2026-11-18,
// docs/decisions/2026-11-18-carried-file-matches-by-versions.md), 365 bytes past then: core's two
// name rules (a name's versions start, and whether two names share it) that Check my file and the
// Worker share, and the nearby chunk's showing of that start, which the web never opens.
// Raised by 4 KB with Sync and offline (Carl, 2026-11-18, docs/decisions/2026-11-18-sync-and-offline-one-screen.md),
// 3,095 bytes past then: its English words in the catalog every visit carries (the folds' titles and
// lines, the packing list, the screen's new name), the screen's rules and the sideways strip. The
// screen itself moved into a chunk of its own (screens/sync.tsx), loaded when opened, so a first
// visit stays under its own budget.
// Raised by 5 KB with an email and a password on Edit Profile (Carl, 2026-11-18, LAN-304,
// docs/decisions/2026-11-18-edit-profile-holds-email-and-password.md), 3,975 bytes past then with
// Sync and offline merged in: its words in all 16 catalogs, the email and confirm fields, and New
// password's confirm field. Edit Profile moved to a chunk of its own, loaded when opened, so a
// first visit stays under its own budget (17,240 bytes left with Sync and offline's chunk too).
// Raised by 5 KB more with Give the app (Carl, 2026-11-18,
// docs/decisions/2026-11-18-give-the-app-over-wifi.md), 4,512 bytes past then with Edit Profile's
// email merged in: its English words and Check my file's in the nearby chunk the web loads with
// Share nearby (5,037 bytes), and the kept file's rules (840 bytes in the entry, 411 in the shared
// chunk). The screen itself is Android only (src/nearby/GiveAppScreen.android.tsx), so the web
// carries a plain stub of it. A first visit has 16,500 bytes left.
// Raised by 1 KB with the install file's steps, its newer-file notice and Let someone in asking
// for its own permissions (Carl, 2026-11-19, docs/decisions/2026-11-19-carried-build-refreshed-daily.md),
// 746 bytes past it: their English words in the nearby chunk the web loads with Share nearby (the
// steps after Download in the browser, Choose a file you already have, a newer file is ready), the
// notice's rule on Sync, and Let someone in's permission step on its screen. The rule that decides
// that step is in a file only Android loads (src/nearby/letInPermitModel.ts), and the screens are
// Android only; the web never opens them. A first visit has 14,132 bytes left.
// Raised by 14 KB with six changes that were made ready together (Caleb Koster, 2026-11-19), so that
// they merge in any order: each carries this same raise, and the first to merge brings it. Together
// they came out 13,152 bytes past main, which had 44 bytes left: the Key words chip's tiles (LAN-233,
// about 12 KB), "All uploaded" leaving the upload bar in the draw that brings the next screen
// (LAN-284), French elision before a name (LAN-295), Welcome back's Continue without it (LAN-250),
// a library read asked again (LAN-254) and Reports naming a language's template (LAN-114).
// 1,228 bytes are left with all six. If one of them does not merge, lower this by what it adds.
// Raised by 3 KB (Caleb Koster, 2026-11-19) for help mode's list of each screen's videos (LAN-244),
// 2,218 bytes past it, and Connect's button and row (LAN-237), 231 bytes more.
const TOTAL_BUDGET_BYTES = 4.93 * 1024 * 1024 + 154 * 1024;
// A first visit's cap rose to 5.75 MB when Global Viewers' read-only guard on
// the recorder (decisions.md 158) took it past 5.7 MB by a few hundred bytes
// (5.70 MB then): main had 50 bytes left, and a guard that refuses before the
// microphone opens has to be loaded with the recorder.
// Lowered to 3.9 MB with the icons above: 5.70 MB to 3.71 MB.
// Raised to 3.93 MB with nearby sync (Carl, 2026-11-07), 3.91 MB then: main had
// about 2 KB left, and what every client must carry stayed after the rest moved
// behind the Android-only nearby entries: the checkpoint gates, the pull's
// comparison, the stores' nearby tables and ids that name their author.
// Raised to 3.94 MB with Share nearby (Carl, 2026-11-07), 3.93 MB then (3.92
// MB before): 6 KB is its English words in the catalog every visit carries,
// and the rest the stubs the web takes in their place (the Sync row, the
// History line) and its flow edges; the screen loads when opened.
// Raised by 4 KB with joining offline's identity side (Carl, 2026-11-08), 3.0 KB
// past 3.94 MB then: who the app runs as (a session, or a local person) and the
// serverSession split every client takes, the scanner's Let someone in code,
// the join call, and the stubs the web takes for the local person, the
// membership overlay and first contact; the record, the gate and first contact
// themselves stay in .android files.
// Raised by 19 KB with joining offline's screens (Carl, 2026-11-08), 18.x KB past then: about 10 KB is the
// English words of Let someone in, Join without internet, a local person's Me and Sign In, and New
// password's warning, in the catalog every visit carries; the rest is Me's and Sign In's local-person
// branches, the sign-in guard and the stubs the web takes for both screens' hooks. Both screens load
// when opened, and their radios, passes and the join itself stay in .android files.
// Raised by 2 KB with the carried build (Carl, 2026-11-08), 1 KB past then: the install file's
// lines on Let someone in, in the catalog every visit carries.
// Raised by 1 KB with Remove me from this phone and a helper's code for a local person (Carl,
// 2026-11-08), 23 bytes past then: their English words in the catalog every visit carries.
// Raised by 2 KB with getting and checking the install file on Let someone in (Carl, 2026-11-09,
// decision 246 as amended), 1,054 bytes past then: its English words (the download, the name
// check, a file too old, and both phones' words on a version refusal) in the catalog every visit
// carries; the screen loads when opened.
// Raised by 1 KB with Share nearby's two jobs (Carl, 2026-11-09), 255 bytes past then: their
// English words (the intro, the two headings and their lines, the Sync row's second line and help)
// in the catalog every visit carries; the screen loads when opened.
// Raised by 1 KB with the Sync reminders to get the install file and the Sync row's new words (Carl,
// 2026-11-09), 251 bytes past then: their English words (the two lines on Ready for offline, Get it,
// the row's amber line and help) in the catalog every visit carries, and the card's stub.
// Raised by 2 KB more for LAN-221 (3.9 MB to 3.902 MB on main): a grey Inbox badge and a
// "Sign-in not renewed" state on the sync icon took the first visit 1 KB over
// when merged with main.
// Raised to 3.925 MB when the organization export (decision 206, LAN-227) merged
// with main: its 21 English lines (the sheet's words and its help, which the
// catalog a first visit downloads must hold; the sheet's code loads with Org)
// took a first visit under 1 KB past the budget, and LAN-221's lines above sit
// beside them. The export plan itself stays out of the app (packages/sync,
// server only): moving it there took 12 KB off this bundle.
// The key-term check's recorded-example event (decision 207, LAN-228) fits in
// the same 3.925 MB: its core rules are small, and its evaluation code stays out.
// Raised by 3 KB with the fixes from the two-emulator test (Carl, 2026-11-09), 2,460 bytes past then,
// with main merged in: the copy-short line in the catalog every visit carries, names from checked
// chains laid under the directory, the join link's route, and the start deadline's stub.
// Lowered by 21 KB with a trim pass (Carl, 2026-11-10), 22,348 bytes less then: nearby sync's
// English words (15.4 KB) come with the nearby screens (src/nearby/nearbyWords.web.ts), not with
// every visit; the get_user_state readers left nearbyModel.ts (5.8 KB, now nearbyFlagModel.ts), and
// the token check left firstContactModel.ts (1.9 KB, now tokenModel.ts).
// Raised by 5 KB with main merged in (Carl, 2026-11-12), 4,024 bytes past then: main's
// organization export and recorded key-term examples above, on top of nearby sync's budget.
// Raised by 20 KB with the library upgrades (Carl, 2026-11-11), 20,164 bytes past then, measured
// package by package from the source maps: lucide-react-native 1.52 to 1.70 (7.6 KB), i18next 26.4
// to 26.7 (6.6 KB), React Navigation 7.20 to 7.21 (2.2 KB), supabase-js 2.117 to 2.119 (1.9 KB) and
// react-i18next 17.0 to 17.1 (1.5 KB). All the chunks together came out 1.9 KB smaller.
// Raised by 52 KB with Expo SDK 58 (Carl, 2026-11-11, decision 250), 52,380 bytes past then, by
// package from the source maps: React DOM 19.2 to 19.3 (28.5 KB), react-native-svg 15.15 to 15.16
// (5.5 KB), expo (3.4 KB), expo-audio (2.2 KB), expo-sqlite (1.5 KB), safe-area-context (1.4 KB),
// expo-file-system (1.3 KB), expo-status-bar (1.1 KB) and React Navigation under React 19.3 (1.5 KB).
// None of it is the app's code.
// Both raises together with nearby sync merged in (Carl, 2026-11-12): the upgrades come to 72,051
// bytes over nearby sync's 19 KB, 1,677 bytes under the two together.
// Raised by 2 KB with back translation's two rows (Caleb Koster, 2026-11-13, LAN-234), 1 KB past then
// with main merged in: the six new English words in the catalog every visit carries, and the rows' model.
// Raised by 2 KB with the app lock (Caleb Koster, 2026-11-16, LAN-255, decision 253), a few hundred bytes
// past then with main merged in: its English words in the catalog every visit carries, and Sign Out's
// steps moved into one function the lock shares. The lock itself is phones only; the web takes stubs.
// Raised by 1 KB with the passage row's download button beside the row, not inside it (Caleb Koster,
// 2026-11-17, LAN-158), 250 bytes past then: Row's action slot, its wrapper and three styles, in the
// kit every visit carries. All chunks still fit their own budget.
// Raised by 16 KB with the Key words chip's tiles (Caleb Koster, 2026-11-17, LAN-233,
// docs/decisions/2026-11-17-key-words-tiles-sheet-in-place.md), 15 KB past then with main merged in:
// the tiles, the switch for the team's words in the Bible text and their chips in a verse, the word
// grouping in the key terms model, the recorder's listen hooks in the clip player, and their English
// words in the catalog every visit carries. They show on the recording screen as it opens; the word's
// sheet loads when first opened (keyTerms/lazySheets.tsx).
const FIRST_VISIT_BUDGET_BYTES = 3.94 * 1024 * 1024 + 112 * 1024;

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
