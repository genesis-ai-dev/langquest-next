# 51. Secrets are applied by a person when they change, never by a deploy; public settings are plain

Date: 2026-10-01 · By: Carl Sauder · Status: accepted

Reason: under 43's amendment and 49, every Cloudflare deploy decrypted an
env file and uploaded its values. That put a private key on each of four
Workers' builds. Each deploy target also had a file per environment, and
most of their values were public: `EXPO_PUBLIC_*`, project URLs and refs, and
the sender address. Those were encrypted only to keep the files uniform
(the infrastructure skill's convention, not a recorded decision). So you
needed a key to see which project preview used, to run the app locally, and
to build the dashboard, whose page carries those values anyway. Secrets also
crossed platforms in pairs (the relay secret in two files) and needed checks
to keep the pairs equal. Now settings are split by kind:
- **Public settings are plain**, in each platform's own file:
  `apps/mobile/.env.<env>`, wrangler `vars`, and `[remotes.<env>]` project
  refs in `supabase/config.toml`.
- **Secrets are encrypted in one file per hosted environment**, the root
  `.env.preview` and `.env.production`.
- **`npm run secrets -- <env>` (`scripts/secrets.mjs`) puts every secret
  where it is used**: Worker secrets, Edge Function secrets, Vault and the
  projection job. One value feeds both ends of the relay and of the
  projection secret, so they cannot drift. The service-role key is read
  from Supabase on each run rather than stored.

Worker secrets stay on the Worker across deploys, and wrangler refuses a
deploy while one in `secrets.required` is missing, so a deploy carries code
and vars only. No build system, CI or platform holds a dotenvx key. There is
no development key, since development has no secrets. `env:check` refuses a
plain secret, a secret in the app's files and a public setting in the
secrets file. This supersedes 50's file per target and the keys on Worker
builds; 50's environments and branches stand. The cost is that a changed
secret takes effect only when someone runs `npm run secrets`. That is rare,
and Supabase secrets already worked this way. Worker secrets cannot be read
back, so the drift check only confirms they exist.
Reverse if: secrets change often enough that a manual apply is forgotten
(then apply them from CI, with the key in a protected CI environment); or a
platform gains a way to read secrets from the repo at deploy without holding
a key.
