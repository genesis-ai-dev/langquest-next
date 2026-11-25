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
// Raised by 1 KB with the browser handing the install file to the app (Carl, 2026-11-20,
// docs/decisions/0246-a-carried-build-is-the-newcomers.md, amended 2026-11-20), 603 bytes past it:
// the new steps' English words in the nearby chunk the web loads with Share nearby (tap Open, and
// if it has gone, come back and choose the file), and core's second name for the file, which the
// Worker serves it under. The rules, the store and the hook that take the file are in files only
// Android loads (src/nearby/handedFile.android.ts, useHandedFile.android.ts, handedFileModel.ts),
// since the web never gets one, and the screen is Android only. 421 bytes are left; a first visit
// has 10,297.
// Raised by 2 KB with the new phone's fewer steps (Carl, 2026-11-20,
// docs/decisions/2026-11-18-give-the-app-over-wifi.md, amended 2026-11-20), 1,562 bytes past it:
// their English words in the nearby chunk the web loads with Share nearby (Send with Quick Share and
// its line, the line that the new phone finds this phone by itself, the page's Join step, the code's
// minutes left and its help), and Let someone in's code lifetime on Give the app's group in the
// shared let-in model. The hand-over, the new phone's finder and Give the app's rules are in files
// only Android loads (giveHandOver.ts, useGiveJoinFinder.android.ts, giveAppModel.ts), and the screens
// are Android only. 486 bytes are left; a first visit has 9,813.
// Raised by 5 KB with the download buttons' key and a book's Remove sheet (Carl, 2026-11-20, LAN-316,
// docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended 2026-11-20), 3,865 bytes past
// it: the key that names every mark a download button shows, the sheet that asks before a book's files are
// removed, the line naming study files their source does not have, and their English words in the catalog
// every visit carries. The Map is where a visit starts, so none of it can load later. 1,255 bytes are left;
// a first visit has 6,897.
// Raised by 2 KB with a play's wait for sound measured in parts (Caleb Koster, 2026-11-21, LAN-323,
// docs/decisions/0182-every-recording-people-make-plays-at.md, amended 2026-11-21), about 1 KB past it:
// the measure (src/audio/playWait.ts) that the three players use and the tally's new fields. Every
// player of a recording can be on the first screen, so it cannot load later.
// Raised by 3 KB with reference audio counted in "On this device" (Carl, 2026-11-23, LAN-316,
// docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended 2026-11-23), 1,938 bytes
// past it: each passage's reference audio worked out and published (src/sources/referenceCounts.ts,
// `wantsByUnit`), the pass working it out offline from the documents the device holds and keeping
// it for the next start, and the words for reference audio that cannot come in every catalog. The
// pass runs from the app's root and the Map's download buttons read it, so none of it can load
// later. 1,134 bytes are left; a first visit has 1,751.
// Raised by 2 KB with a recording not yet sent named on its passage's line, and a cleaned part's original
// kept while a version still plays it (Carl, 2026-11-23, LAN-316, docs/decisions/0061-every-passage-says-whether-it-is.md
// and 0176-clean-up-puts-a-parts-cleaned.md, both amended 2026-11-23), 289 bytes past it: the passage's
// and the book's words for a recording its device has not sent, in every catalog, and core's file plan
// asking which takes still play a part as recorded. Both are read by the Map and the sync every visit
// starts, so neither can load later. 1,759 bytes are left; a first visit has 328.
// Raised by 1 KB with a book's counts in its header and only buttons over its passages (Carl, 2026-11-23,
// LAN-316, docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended twice more that day),
// 143 bytes past it: the header's line, the size on the Download button and what a dimmed one says, and
// their words in every catalog (four keys, sixteen languages), all in the Map every visit opens on.
// 881 bytes are left; a first visit has 493.
// Raised by 1 KB with study files no kept passage needs cleared when the device needs room (Carl,
// 2026-11-23, LAN-316, docs/decisions/2026-11-23-study-files-are-cleared-when-no-kept-passage-needs-them.md),
// 310 bytes past it: each language's saved list and the clearing in study/studyFiles.ts, which the Map's
// download buttons read, so it cannot load later; on the web it does nothing, since a browser keeps no study
// files. 714 bytes are left; a first visit has 326.
// Raised by 1 KB with the Teammates fold on Sync and offline and Me's reminder that recordings are only
// on this phone (Carl, 2026-11-23, docs/nearby-sync-plan.md 15.4 and 15.5,
// docs/decisions/2026-11-18-sync-and-offline-one-screen.md, amended 2026-11-23), 69 bytes past it: their
// English words in the nearby chunk the web loads with Share nearby, a teammate's line in a module Share
// nearby and the fold share, and Me's stub. The fold, the reminder and their rules are in files only a
// phone loads (NearbyRow.native.tsx, useNearby.native.ts, useOnlyHereNote.native.ts,
// readyToCarryModel.ts), since the web shares nothing nearby. 955 bytes are left; a first visit has 117.
// Raised by 1 KB with a Share nearby resetting the quiet mode's window, and the Teammates fold saying until
// when it shares with each teammate (Carl, 2026-11-24, docs/nearby-sync-plan.md 15.8,
// docs/decisions/0230-a-phone-keeps-who-it-last.md, amended 2026-11-24), 335 bytes past it: the fold's
// three lines and the switch's new help sentence, in English, in the nearby chunk the web loads with Share
// nearby. The dates, their reading and the line are in files only a phone loads (quietUntilModel.ts,
// nearbyCarry.native.ts, useNearby.native.ts, NearbyRow.native.tsx), since the web shares nothing nearby.
// 689 bytes are left; a first visit has 749.
// Raised by 2 KB with @supabase/supabase-js 2.119.0 to 2.119.2 (Carl, 2026-11-24, Dependabot's app group),
// 1,156 bytes past it: the client now names the runtime and platform it runs on in the X-Client-Info header
// it already sent, and storage-js builds its object URLs in one place, 1,845 bytes in all. The client is
// made as the app starts, in the bundle every visit loads, so none of it can load later. lucide-react-native
// 1.74 to 1.77, in the same bump, changed none of the icons the app draws (src/ui/icons.ts). 892 bytes are
// left; a first visit has 952.
// Raised by 1 KB with Download the install file offering no download once the file is in hand, and
// Share nearby saying offline that the file is ready (Carl, 2026-11-24, docs/nearby-sync-plan.md 14.4,
// docs/decisions/2026-11-19-carried-build-refreshed-daily.md and decision 246, amended 2026-11-24), 86
// bytes past it with the Teammates fold's lines (PR 685) merged in: Share nearby's ready line and its rule
// (installFileRow), in the nearby chunk the web loads with Share nearby. The screen's own rule is in a file
// only a phone loads (installFileOfferModel.ts), and its three words left all 16 catalogs. 938 bytes are
// left; a first visit has 847.
// Raised by 1 KB with the library documents a language uses going between any two teammates (Carl,
// 2026-11-24): the same 880 bytes a first visit grew by (see there), in the document store every screen
// reads through. 1,082 bytes are left; a first visit has 991.
// Raised by 1 KB with FIA's study files going between teammates (Carl, 2026-11-24): the same 590 bytes a
// first visit grew by (see there). 1,065 bytes are left; a first visit has 974.
// Raised by 1 KB with a library source's chapter audio going between teammates and the lines that say guide
// pictures and audio come over Wi-Fi (Carl, 2026-11-24, docs/nearby-sync-plan.md 5.12, Library files), 371
// bytes past it: the sources' pass now indexes a chapter already in the store while offline and says which
// chapters it wants by hash (sources/offline.ts, useSourceOffline.ts), in the chunk the sources' screens load,
// and Share nearby's count of guide files and Let someone in's and Join without internet's line, in English, in
// the nearby chunk. The asking and the landing are in files only a phone loads. 653 bytes are left; a first
// visit has 352.
// Raised by 1 KB with a newcomer let in offline lasting 90 days from their invite link, and Let someone in
// saying how many days this phone can still let people in and warning under 30 (Carl, 2026-11-24,
// docs/decisions/0240-a-join-pass-lets-a-member.md, amended that day), 340 bytes past it: the screen's line
// and its amber warning, and their two English lines, in the nearby chunk the web loads with Share nearby.
// Which pass is in effect, the days left and the clock they are read on are in files only a phone loads
// (nearbyModel.ts, useLetIn.android.ts), and the link's time is in the nearby entry. 684 bytes are left; a
// first visit has 947.
// Raised by 5 KB with the review of 2026-11-24's items 3 to 7 and 26 to 28 (Carl, 2026-11-24,
// docs/decisions/2026-11-24-a-starting-copy-comes-whole-from-one-checkpoint.md and
// 2026-11-24-a-lost-or-short-copy-is-taken-again-and-updates-wait.md), 4,569 bytes past it: `SyncClient`, which the
// web runs too, marks a stream downloaded to the server's newest, and a copy lost, and answers whether it can give
// a copy and what a copy still needs (about 2.4 KB, in a first visit as well); the app looks for an over-the-air
// update itself (shell/useUpdateAtStart.ts); and Share nearby's and Let someone in's lines and their six English
// words, in the nearby chunk. The copy's checks, the copy target, the update hold and a document this build cannot
// read are in files only a phone loads (the nearby entry, nearbyCopyTarget.native.ts, updatesHeld.native.ts,
// nearbyModel.ts). 551 bytes are left; a first visit has 659. The review of the fixes (2026-11-24) added the inviter's
// line for a copy cut during its documents, and moved the start look's setting check into updatesHeld.native.ts: 433
// bytes are left; a first visit has 747.
// Raised by 5 KB with the review of 2026-11-24's items 12, 13, 15 to 18 (Carl, 2026-11-24,
// docs/decisions/2026-11-24-a-checkpoint-keeps-its-rows-for-claims.md and
// 2026-11-24-server-written-team-work-travels-as-a-claim.md), 4,425 bytes past it: the event stores, which the web
// runs too, keep the rows a checkpoint of a phone's own drops for claims (`nearby_claimable`, `claimableAfter`,
// `claimableFrom`) and `SyncClient` asks for that on its own checkpoints (about 3.5 KB, in a first visit as well);
// saved names are split from the server's read so a phone's nearby code reads them without the server's client
// (library/labelsKept.ts); and the chain names a session reports are kept in one write. Claims, labels between
// phones, the documents worked out again after events and older versions are in the nearby entry and in files only
// a phone loads (library/labelsTeammate.native.ts, nearbyLibrary.native.ts). 695 bytes are left; a first visit
// has 1,008.
// Raised by 4 KB with the review of 2026-11-24's files and performance groups (Carl, 2026-11-24,
// docs/decisions/2026-11-24-nearby-sessions-spare-the-radios-and-the-round-trips.md), about 3 KB past it: the 2 KB
// a first visit grew by (FIRST_VISIT_BUDGET_BYTES, below, says what), and Share nearby's line for guide files that did
// not fit in its 16 languages. The rest of the review's work is in the nearby entry and in files only a phone loads.
// Raised by 1 KB with Let someone in's bar and Sync's line for sharing while LangQuest is open (Carl, 2026-11-25,
// docs/decisions/2026-11-18-sync-and-offline-one-screen.md as amended), 305 bytes past it with main merged in: the
// starting copy's estimate (`CopyTally`), the Let someone in stage's share, and the Sync row's rule with its three
// English lines, all in the nearby chunk, which the web never opens. A first visit does not grow (58 bytes left).
// Raised by 4 KB with what teammates share (Carl, 2026-11-25,
// docs/decisions/2026-11-25-text-goes-whole-and-recordings-go-by-want.md), 3,678 bytes past it: the first visit's
// growth below, and in the nearby chunk the work set on Let someone in (`letInBooks`, `workSetOf` and the grant's `kept`)
// and the limit of file bytes a session moves while LangQuest is open, which the web never opens.
// Raised by 3 KB with the follow-up to LAN-317 (Carl, 2026-11-25,
// docs/decisions/2026-11-20-unheard-recordings-are-not-judged-or-changed.md as amended), 2,846 bytes past it: the
// first visit's growth (FIRST_VISIT_BUDGET_BYTES, below, says what) and the back translation's hold on deleting a
// part that cannot be heard. 226 bytes are left.
const TOTAL_BUDGET_BYTES = 4.93 * 1024 * 1024 + 199 * 1024;
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
// Raised by 1 KB with a book's download button on a row of its own and Sync now fetching what failed at
// once (Carl, 2026-11-23, LAN-316, docs/decisions/2026-11-20-a-book-has-its-own-download-button.md,
// amended 2026-11-23), 105 bytes past it: the line's two styles in the Map every visit opens on, and
// the session's download trigger beside the upload one, which the language hook every screen uses
// hands on. 919 bytes are left; all chunks have 1,306.
// Raised by 1 KB with where a book's passages stand said in its header, under how many are recorded (Carl,
// 2026-11-23, LAN-316, the same decision, amended again that day), 301 bytes past it: the header's line
// that holds its height, the group's count lifted so the screen's header and its line share it
// (sync/useGroupOffline.ts), and the none/some/all words in the catalog every visit carries. All chunks
// have 87 bytes left.
// Raised by 1 KB with a book being downloaded said in its header and Remove's sheet saying it stops
// keeping (Carl, 2026-11-23, LAN-316, the same decision, amended again that day), 136 bytes past it: the
// header's waiting and connect words and the sheet's longer words, in the catalog every visit carries.
// 888 bytes are left; all chunks have 252.
// Raised by 1 KB with sharing while LangQuest is open (Carl, 2026-11-23, docs/nearby-sync-plan.md 15.6,
// docs/decisions/2026-11-23-share-while-langquest-is-open.md), 152 bytes past it with main merged in: the
// plain stub the web takes for the mode's mount beside the screens (src/shell/NearbyWhileOpen.tsx), and
// whether anything is playing (src/audio/nowPlaying.ts), which the mode pauses for and every player shares.
// The mode, its gate and its room are in files only a phone loads (useNearbyWhileOpen.native.ts,
// NearbyWhileOpen.native.tsx), since the web shares nothing nearby. 872 bytes are left; all chunks have 132.
// Raised by 2 KB with @supabase/supabase-js 2.119.0 to 2.119.2 (Carl, 2026-11-24, Dependabot's app group),
// 1,096 bytes past it: the same 1,845 bytes all chunks grew by (see there), since the client is made as the
// app starts. 952 bytes are left; all chunks have 892.
// Raised by 1 KB with the library documents a language uses going between any two teammates (Carl,
// 2026-11-24, docs/nearby-sync-plan.md 5.12 and 14.1, docs/decisions/2026-11-24-a-starting-copy-carries-every-library-document-a-language-uses.md,
// amended that day), 33 bytes past it: the document store every screen reads through
// (library/docStore.ts) keeps a teammate's guides on disk only and reads them as heads (`docHeadOf`),
// so a walk over FIA's 1,525 English guides never holds them in memory, tells the screens once per half
// second of them, and `useLibraryDocs` reads from disk what an open screen still lacks when they come.
// The walk, the asks and the serving are in files only a phone loads (nearbyLibrary.native.ts and the
// nearby entries). 991 bytes are left; all chunks have 1,082.
// Raised by 1 KB with FIA's study files going between teammates on a teammate's word (Carl, 2026-11-24,
// docs/nearby-sync-plan.md 5.12, docs/decisions/2026-11-24-library-files-move-between-teammates-as-reference-files.md,
// amended that day), 50 bytes past it: the study folder every guide screen reads through
// (study/studyFiles.ts) now hands a phone's nearby moves its folder, file names and wish list
// (`studyFolder`), 590 bytes, since the minifier no longer folds those away. The moves, the landing
// and fetching them again online are in a file only a phone loads (study/nearbyStudyFiles.native.ts),
// and the team's own library files' rule is in the nearby entry. 974 bytes are left; all chunks have 1,065.
// Raised by 1 KB with the security review of the library files (Carl, 2026-11-24, docs/decisions/2026-11-24-library-files-move-between-teammates-as-reference-files.md,
// amended that day), 63 bytes past it with the sources' chapters and the lines on screen merged in: a phone keeps a
// record of where each library file came from, so the guide file a screen fetches (study/useStudyFileUri.ts), the
// guide editor's upload (guides/files.ts) and a source's chapter (sources/offline.ts) each note it
// (library/libraryOrigins.ts). The web keeps no record: its copy of that module does nothing, and the record itself
// is in a file only a phone loads (libraryOrigins.native.ts). 961 bytes are left; all chunks have 189.
// Raised by 3 KB with the review of 2026-11-24's items 4 to 7, 26 and 27 (Carl, 2026-11-24,
// docs/decisions/2026-11-24-a-starting-copy-comes-whole-from-one-checkpoint.md), 2,413 bytes past it: `SyncClient`,
// which every visit carries, marks a stream downloaded to the server's newest (`downloaded:`) and a copy lost
// (`copyLost:`), and answers `canGiveCopy`, `copyNeed`, `dropStartingCopy` and `startingCopyRowsAt`, which need its
// own fields; the app's own look for an over-the-air update at start (shell/useUpdateAtStart.ts), whose hold is a
// web stub here (updatesHeld.ts); and Let someone in's two new reasons. 659 bytes are left; all chunks have 551.
// After the review of the fixes (2026-11-24), 747 bytes are left; all chunks have 433.
// Raised by 5 KB with the review of 2026-11-24's items 12, 13, 15 to 18 (Carl, 2026-11-24,
// docs/decisions/2026-11-24-a-checkpoint-keeps-its-rows-for-claims.md), 4,112 bytes past it: the event stores and
// `SyncClient`, which every visit carries, keep a checkpoint's rows for claims on a phone that shares nearby (the
// web never asks them to); saved library names in the app's language split from the server's read
// (library/labelsKept.ts); and a session's chain names kept in one write (account/chainNames.ts). What moves names
// between phones is in files only a phone loads (library/labelsTeammate.native.ts). 1,008 bytes are left; all
// chunks have 695.
// Raised by 3 KB with the review of 2026-11-24's files and performance groups (Carl, 2026-11-24,
// docs/decisions/2026-11-24-nearby-sessions-spare-the-radios-and-the-round-trips.md), about 2 KB past it: an open
// guide takes up a picture or audio that arrives without being reopened (study/ui.tsx, study/useStudyAudio.ts), a
// passage's study counts take in a team's guide files by hash (study/studyFiles.ts), core's head names a guide set so
// the app and nearby leave out the same languages, and `SyncClient` says when it last wrote. What only a phone does
// stays in files the web never loads: the download ahead (study/guideFilesAhead.native.ts), heads kept on disk
// (library/docHeads.native.ts) and shared Bibles between phones (library/sharedTeammate.native.ts).
// Raised by 4 KB with what teammates share (Carl, 2026-11-25,
// docs/decisions/2026-11-25-text-goes-whole-and-recordings-go-by-want.md), 3,386 bytes past it: the download buttons'
// rule for keeping a passage or a book offline where Share nearby can run (sync/offlineModel.ts, sync/offline.tsx,
// sync/useGroupOffline.ts), the one answer they share (nearby/useNearbyCanRun.ts), and their seven English lines in the
// catalog every visit carries. The web never shows those lines, since Share nearby never runs there, but the buttons
// are the same code on every platform.
// Raised by 3 KB with the follow-up to LAN-317 (Carl, 2026-11-25,
// docs/decisions/2026-11-20-unheard-recordings-are-not-judged-or-changed.md as amended), 2,420 bytes past it: six
// English lines in the catalog every visit carries (the lock banner's three, Keep's two, Done's one); the lock
// banner's New version and the Done screen that stays open when the device goes offline (screens/translate.tsx,
// recording/workspaceModel.ts); Keep's hold on spoken feedback (screens/passage.tsx, passage/reviewModel.ts); Done's
// line for it (recording/publish.tsx); and the Versions page's dimmed Done. 652 bytes are left.
const FIRST_VISIT_BUDGET_BYTES = 3.94 * 1024 * 1024 + 139 * 1024;

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
