import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { LOCAL_URL, localKey } from './local-supabase';

/**
 * `npm run web:dev` runs the app's Worker against the local Supabase.
 * Wrangler reads its settings for that from `apps/web/.dev.vars` (ignored by
 * git), written here from `supabase status` on every start, so it follows a
 * reset of the local database and never holds a hosted key.
 */
// The Bible routes need Faith Comes By Hearing's key; it is passed on from
// the environment when set (export BIBLE_BRAIN_ACCESS_KEY first), never
// printed, and the routes answer 503 without it.
const bibleBrain = process.env['BIBLE_BRAIN_ACCESS_KEY']?.trim();
writeFileSync(new URL('../apps/web/.dev.vars', import.meta.url),
  `SUPABASE_URL=${LOCAL_URL}\nSUPABASE_ANON_KEY=${localKey('SUPABASE_ANON_KEY')}\nSUPABASE_SERVICE_ROLE_KEY=${localKey('SUPABASE_SERVICE_ROLE_KEY')}\n` +
  (bibleBrain ? `BIBLE_BRAIN_ACCESS_KEY=${bibleBrain}\n` : ''), { mode: 0o600 });

// Wrangler loads only the secrets wrangler.jsonc requires, and the Bible
// Brain key is deliberately not required (a deploy must not stop before a
// person applies it, decision 51). Local development runs from a copy that
// requires it too (apps/web/.wrangler.dev.jsonc, ignored by git), and the
// assets folder exists even before the app has been exported.
//
// The copy has no routes. With one, `wrangler dev` rewrites every request's
// URL to the route's custom domain, so links the Worker builds from its own
// address (recording links, review links, /connect) would point at
// production. Without one, the request keeps the address it came in on:
// localhost:8787 here, 10.0.2.2:8787 from the Android emulator.
const config = JSON.parse(readFileSync(new URL('../apps/web/wrangler.jsonc', import.meta.url), 'utf8')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')) as {
    secrets?: { required?: string[] }; routes?: unknown; vars?: Record<string, string>; assets?: { run_worker_first?: string[] }
  };
delete config.routes;
// Wrangler's endpoint for firing the cron by hand (`--test-scheduled`),
// /__scheduled, is a path the app's export does not have, so the assets
// layer would answer it with the page; the Worker gets it first. Production
// has no such endpoint.
config.assets = { ...config.assets, run_worker_first: [...(config.assets?.run_worker_first ?? []), '/__scheduled'] };
if (bibleBrain) config.secrets = { required: [...new Set([...(config.secrets?.required ?? []), 'BIBLE_BRAIN_ACCESS_KEY'])] };
// The job container (worker/jobs.ts) runs in Docker, where 127.0.0.1 is the
// container itself; it reaches the local database through Docker's name for
// the host. A plain var in the copy, since wrangler reads from .dev.vars only
// the secrets the config requires; production's config has no such var.
const jobsUrl = new URL(LOCAL_URL);
jobsUrl.hostname = 'host.docker.internal';
// The same for the Worker's own address (the v2 import puts files there), and
// no v2 import here: a local stack has no v2 keys (npm run v2 imports by hand).
config.vars = { ...config.vars, JOBS_SUPABASE_URL: jobsUrl.origin, JOBS_API_URL: 'http://host.docker.internal:8787', V2_IMPORT_ENABLED: 'false' };
writeFileSync(new URL('../apps/web/.wrangler.dev.jsonc', import.meta.url), JSON.stringify(config, null, 1));
mkdirSync(new URL('../apps/mobile/dist', import.meta.url), { recursive: true });
