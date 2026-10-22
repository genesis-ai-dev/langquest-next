import { readFileSync, writeFileSync } from 'node:fs';

/**
 * `npm run admin:dev` runs the ops dashboard's Worker locally (docs/admin.md).
 * Wrangler loads from `apps/admin/.dev.vars` only the secrets its config
 * requires, and the provider tokens are deliberately optional (a deploy must
 * not wait for one), so local development runs from a copy that also
 * requires each `ADMIN_*` token the file holds (`apps/admin/.wrangler.dev.jsonc`,
 * ignored by git), as scripts/web-dev-vars.ts does for the app Worker. Names
 * only: no value is read past its key.
 */
const dir = new URL('../apps/admin/', import.meta.url);
let present: string[] = [];
try {
  present = readFileSync(new URL('.dev.vars', dir), 'utf8').split('\n')
    .map((line) => /^(ADMIN_[A-Z0-9_]+)=./.exec(line)?.[1]).filter((k): k is string => !!k);
} catch {
  // No .dev.vars yet: the copy requires what production requires, and wrangler says what is missing.
}
const config = JSON.parse(readFileSync(new URL('wrangler.jsonc', dir), 'utf8')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')) as { main: string; secrets?: { required?: string[] } };
config.secrets = { required: [...new Set([...(config.secrets?.required ?? []), ...present])] };
writeFileSync(new URL('.wrangler.dev.jsonc', dir), JSON.stringify(config, null, 1));
console.log(`apps/admin/.wrangler.dev.jsonc: ${present.length ? present.join(', ') : 'no provider tokens'} from .dev.vars`);
