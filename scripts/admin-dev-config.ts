import { readFileSync, writeFileSync } from 'node:fs';

/**
 * `npm run admin:dev` runs the ops dashboard's Worker locally (docs/admin.md),
 * from a copy of its config (`apps/admin/.wrangler.dev.jsonc`, ignored by
 * git), as scripts/web-dev-vars.ts does for the app Worker:
 * - Wrangler loads from `apps/admin/.dev.vars` only the secrets its config
 *   requires, and the provider tokens are deliberately optional (a deploy
 *   must not wait for one), so the copy also requires each `ADMIN_*` token
 *   the file holds.
 * - The DIAG Hyperdrive binding (src/db.ts) gets the local database:
 *   `DIAG_DATABASE_URL` from `.dev.vars` becomes its localConnectionString.
 * Token names only are printed; no value is.
 */
const dir = new URL('../apps/admin/', import.meta.url);
let vars = '';
try {
  vars = readFileSync(new URL('.dev.vars', dir), 'utf8');
} catch {
  // No .dev.vars yet: the copy requires what production requires, and wrangler says what is missing.
}
const present = vars.split('\n').map((line) => /^(ADMIN_[A-Z0-9_]+)=./.exec(line)?.[1]).filter((k): k is string => !!k);
const local = /^DIAG_DATABASE_URL=(.+)$/m.exec(vars)?.[1]?.trim();

type Config = { main: string; secrets?: { required?: string[] }; hyperdrive?: { binding: string; id: string; localConnectionString?: string }[] };
const config = JSON.parse(readFileSync(new URL('wrangler.jsonc', dir), 'utf8')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')) as Config;
if (present.length) config.secrets = { required: [...new Set([...(config.secrets?.required ?? []), ...present])] };
if (local) config.hyperdrive = (config.hyperdrive ?? []).map((h) => (h.binding === 'DIAG' ? { ...h, localConnectionString: local } : h));
writeFileSync(new URL('.wrangler.dev.jsonc', dir), JSON.stringify(config, null, 1));
console.log(`apps/admin/.wrangler.dev.jsonc: ${present.length ? present.join(', ') : 'no provider tokens'} from .dev.vars; ` +
  (local ? 'the database through DIAG_DATABASE_URL' : 'no DIAG_DATABASE_URL in .dev.vars, so no database'));
