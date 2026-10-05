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
    // A development export is a release build of the local stack, for the web smoke test (src/supabase.ts).
    ...(env === 'development' ? { EXPO_PUBLIC_LOCAL_RELEASE: '1' } : {})
  }
});

fs.writeFileSync(path.join(dist, 'version.json'), `${JSON.stringify({ build })}\n`);

// A fitness function (decisions.md 58): the JavaScript a first visit downloads.
// 4.8 MB when this was set (catalog data, study texts, the map's shapes); a
// rise past it is a change someone should notice, not drift.
const BUDGET_BYTES = 5.5 * 1024 * 1024;

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
if (scriptBytes > BUDGET_BYTES) {
  console.error(`x the web app's JavaScript is ${(scriptBytes / 1048576).toFixed(2)} MB, over its ${(BUDGET_BYTES / 1048576).toFixed(1)} MB budget (scripts/export-web.mjs). Trim it, or raise the budget in the same change and say why.`);
  process.exit(1);
}

fs.writeFileSync(path.join(dist, '_headers'), headersFor({ supabaseUrl }));
console.log(`web build ${build} for ${env} in apps/mobile/dist: ${(scriptBytes / 1048576).toFixed(2)} MB of JavaScript (${moved} source maps kept in dist-sourcemaps/, not served)`);
