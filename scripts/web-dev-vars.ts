import { writeFileSync } from 'node:fs';
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
