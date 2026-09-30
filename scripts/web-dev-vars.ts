import { writeFileSync } from 'node:fs';
import { LOCAL_URL, localKey } from './local-supabase';

/**
 * `npm run web:dev` runs the dashboard's Worker against the local Supabase.
 * Wrangler reads its settings for that from `apps/web/.dev.vars` (ignored by
 * git), written here from `supabase status` on every start, so it follows a
 * reset of the local database and never holds a hosted key.
 */
writeFileSync(new URL('../apps/web/.dev.vars', import.meta.url),
  `SUPABASE_URL=${LOCAL_URL}\nSUPABASE_SERVICE_ROLE_KEY=${localKey('SUPABASE_SERVICE_ROLE_KEY')}\n`, { mode: 0o600 });
