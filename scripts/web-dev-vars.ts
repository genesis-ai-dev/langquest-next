import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { LOCAL_URL, localKey } from './local-supabase';

/**
 * `npm run web:dev` runs the dashboard's Worker against the local Supabase.
 * Wrangler reads its settings for that from `apps/web/.dev.vars` (ignored by
 * git), written here from `supabase status` on every start, so it follows a
 * reset of the local database and never holds a hosted key.
 */
// The Bible routes need Faith Comes By Hearing's key; it is passed on from
// the environment when set (export BIBLE_BRAIN_ACCESS_KEY first), never
// printed, and the routes answer 503 without it.
const bibleBrain = process.env['BIBLE_BRAIN_ACCESS_KEY']?.trim();
writeFileSync(new URL('../apps/web/.dev.vars', import.meta.url),
  `SUPABASE_URL=${LOCAL_URL}\nSUPABASE_SERVICE_ROLE_KEY=${localKey('SUPABASE_SERVICE_ROLE_KEY')}\n` +
  (bibleBrain ? `BIBLE_BRAIN_ACCESS_KEY=${bibleBrain}\n` : ''), { mode: 0o600 });

// Wrangler loads only the secrets wrangler.jsonc requires, and the Bible
// Brain key is deliberately not required (a deploy must not stop before a
// person applies it, decision 51). Local development runs from a copy that
// requires it too (apps/web/.wrangler.dev.jsonc, ignored by git), and the
// assets folder exists even before the app has been exported.
const config = JSON.parse(readFileSync(new URL('../apps/web/wrangler.jsonc', import.meta.url), 'utf8')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')) as { secrets?: { required?: string[] } };
if (bibleBrain) config.secrets = { required: [...new Set([...(config.secrets?.required ?? []), 'BIBLE_BRAIN_ACCESS_KEY'])] };
writeFileSync(new URL('../apps/web/.wrangler.dev.jsonc', import.meta.url), JSON.stringify(config, null, 1));
mkdirSync(new URL('../apps/mobile/dist', import.meta.url), { recursive: true });
