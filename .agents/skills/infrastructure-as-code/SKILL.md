---
name: infrastructure-as-code
description: 'Infrastructure as code (IaC) and config-as-code for this repo: hosted environments (Supabase, Cloudflare Workers, EAS / Expo, storage, cron, secrets) are defined by files in the repo and applied by commands, never configured by clicking in a dashboard. Use when changing Supabase config.toml, migrations, extensions, cron jobs, Vault or function secrets, storage buckets, auth settings, edge functions; wrangler.jsonc or Worker secrets; eas.json, app.json, EAS environment variables or update channels; env files or dotenvx; or when a task says "enable X in the dashboard", "set this secret", or a runbook lists manual steps.'
license: MIT
---

# Infrastructure as code

**The repo is the source of truth for every environment.** A hosted setting
exists because a file in git says so, and it gets there through a command
that anyone on the team can re-run. Dashboards are for reading: logs,
metrics, and checking that reality matches the files.

Why it matters here: the team is small and distributed, environments
(local, preview, production) must match, and PLAN.md section 2 records what
happens when versions and schemas drift apart. A setting made by clicking cannot be
reviewed, reproduced, rolled back, or noticed when it drifts.

## Rules

1. **Declarative first.** Describe the desired state in a file (`config.toml`,
   `wrangler.jsonc`, `eas.json`, migrations). Use imperative commands only
   to apply that state.
2. **Every change is a reviewed commit.** The change and the command that
   applies it land in the same commit, or in a `package.json` script.
3. **Idempotent apply.** Running the apply step twice is safe (`create
   extension if not exists`, `cron.unschedule` before `cron.schedule`,
   `on conflict do nothing`, `wrangler deploy`).
4. **Secrets are referenced, never written.** Definition files name a
   secret (`env(OPENAI_API_KEY)` in `config.toml`, `secrets.required` in
   `wrangler.jsonc`). Its value lives in an encrypted env file (dotenvx, see
   below) and is pushed by a script.
5. **Detect drift.** There is a command that compares live state with the
   files and fails on difference (`npm run db:check`). Run it before and
   after applying.
6. **Break-glass changes get written back.** If someone changes a dashboard
   setting in an emergency, the same change is committed within the day, or it is
   reverted. Record it in the commit message.
7. **Runbooks shrink to scripts.** A doc step that says "enable", "set" or
   "click" is a to-do: turn it into a migration, a config entry, or an npm
   script, and make the doc point at the script.

## Where each thing is defined

| Platform | Defined in | Applied with | Drift check |
| --- | --- | --- | --- |
| Postgres schema, RPCs, RLS, grants | `supabase/migrations/*.sql` (forward-only, never edit a shipped file) | `npm run db:apply` (`supabase db push --linked`) | `npm run db:check` (`--diff` for live schema) |
| Extensions (`pg_cron`, `pg_net`) | a migration: `create extension if not exists ...` | same | same |
| Cron jobs | a migration or `server/*.sql` script that unschedules then schedules by name | `db:apply` or a script (`npm run supabase:secrets` schedules the projection job) | `select * from cron.job` in the check |
| Auth, API, storage settings, buckets | `supabase/config.toml` (`[auth]`, `[api]`, `[storage.buckets.*]`); per-environment overrides in `[remotes.<name>]` | `supabase config diff`, review, then `supabase config push`. Run non-interactively (as agents do), push skips the prompt and applies everything, including template defaults such as the local `site_url`, so hosted values belong in `[remotes.<name>]` first | `supabase config diff` shows nothing |
| Edge functions and their config | `supabase/functions/*`, `[functions.*]` in `config.toml` | `supabase functions deploy <name>` | deployed version in `supabase functions list` |
| Edge function secrets | encrypted `supabase/.env.<environment>`; names in `FUNCTION_SECRETS` (`scripts/supabase-secrets.mjs`) | `npm run supabase:secrets -- <env>` | `npm run supabase:secrets -- <env> --check` (digests) |
| Vault secrets | derived from the same file by `scripts/supabase-secrets.mjs` (`vault.create_secret` / `vault.update_secret`) | the same command | the same check |
| Cloudflare invite-email Worker | `apps/invite-email/wrangler.jsonc` (`env.preview` is the `-preview` Worker); runtime settings in encrypted `apps/invite-email/.env.<environment>` | Workers Builds: `main` runs `npm run email:deploy`, `develop` runs `email:deploy:preview` (`docs/cloudflare.md`, decisions.md 43 and 49). The same commands deploy by hand | `wrangler deploy --dry-run [--env preview]` |
| Cloudflare dashboard | `apps/web/wrangler.jsonc` (`env.preview` likewise); runtime settings in encrypted `apps/web/.env.<environment>`; the page reads `apps/mobile/.env.<environment>` | the same, `npm run web:deploy` / `web:deploy:preview` | `wrangler deploy --dry-run [--env preview]` |
| Worker vars and secrets | encrypted env file; every key listed in that environment's `secrets.required`, public ones too | the deploy commands upload them all with `--secrets-file`. Each Worker's only build secret is `DOTENV_PRIVATE_KEY_PRODUCTION` or `_PREVIEW` | deploy fails if the env file and `secrets.required` disagree |
| Mobile build profiles, channels | `apps/mobile/eas.json`, `apps/mobile/app.json` (`runtimeVersion` policy, plugins, permissions) | `npm run ship:native` / `ship` | `npm run ship:check` (fingerprint) |
| Mobile public config (`EXPO_PUBLIC_*`) | encrypted `apps/mobile/.env.<environment>` | `npm run env:push:eas -- <env>`; inlined at bundle time from that EAS environment | `supabaseConfigError` refuses a local URL in a release build |
| EAS environment variables (builds and updates) | the same encrypted env files; `environment` on each `eas.json` profile | `npm run env:push:eas -- <env>` | `eas env:list --environment <env>` |

When something is not on this list (DNS, a new Cloudflare product, push
credentials), look for its CLI or API first. If none exists, record the manual
setting and its exact values in `docs/` and say so in the task summary.

## Secrets with dotenvx

Env files are committed **encrypted** with [dotenvx](https://dotenvx.com), so
nobody passes `.env` files around. Each file carries its public key; the matching
private key (`DOTENV_PRIVATE_KEY_<ENV>`) sits in the one untracked `.env.keys`
at the repository root, shared once through a password manager. There is one
key pair per environment, shared by every file of that environment
(`docs/environments.md`, decisions.md 49); a test refuses a file encrypted
with another. Anyone can add
or change a value with the public key. Only holders of the private key can read it.

| File | Holds | Read by |
| --- | --- | --- |
| `apps/mobile/.env.development` | local Supabase URL and key | `npm start`, `ios`, `android`, `web` (through `dotenvx run`, with Expo's own loader off) |
| `apps/mobile/.env.preview`, `.env.production` | hosted config | `npm run env:push:eas -- <env>` copies it to the EAS environment, which EAS Build and `ship` read |
| `apps/mobile/.env.development.local` | a person's own dev login | `npm start`; ignored by git |
| `apps/web/.env.<env>`, `apps/invite-email/.env.<env>` | Worker secrets (preview, production) | the deploy commands, as Worker secrets |
| `supabase/.env.<env>` | project ref, function and Vault secrets (preview, production) | `npm run supabase:secrets -- <env>` |
| `apps/mobile/.env.example` | names only | people |

Commands, all from the repository root:

| Task | Command | What it does |
| --- | --- | --- |
| Change a value | `npm run env:update -- <env> [mobile\|web\|invite-email\|supabase] KEY` | Asks for the value (hidden), encrypts it into that target's file (mobile by default), commits that file alone; for mobile it then shows the EAS diff and asks before pushing (preview and production) |
| Check EAS for drift | `npm run env:diff:eas -- <env>` | Names keys that differ between the committed file and EAS; exits 1 on any difference |
| Push the file to EAS | `npm run env:push:eas -- <env>` | Refuses an uncommitted file, shows the diff, asks, pushes |
| Check a machine | `npm run env:doctor` | Key file present, private and ignored; which environments this machine can read |
| Run the app | `npm run app` | `npm start -- --dev-client` in `apps/mobile` |
| Low level | `npm run env:set`, `env:get`, `env:check` | Set without committing, read one value, plaintext guard (`npm test` runs it too) |

- **EAS is a copy.** The committed file is the truth. A value edited in the
  EAS dashboard shows up as drift in `env:diff:eas` and is overwritten by the
  next push. Keys that exist only in EAS are reported, never deleted.
- New private keys go to `.env.keys` (not the OS keychain), so they can be
  shared. Never paste secrets into a definition file, a doc, a commit
  message or a chat.

**Rules for agents:**

- Never read, print, copy or edit `.env.keys` or `*.local` env files.
  `.claude/settings.json` and `.cursorignore` block it; do not work around it
  with shell commands.
- Never print decrypted values. To check one, show its hostname, length or
  whether it is set.
- Never hand-edit an encrypted env file or an EAS variable. Use `env:update`.
- `env:update` for preview or production, and `env:push:eas`, change hosted
  systems. Ask before running them unless the user already said to, and let
  the user type secret values at the hidden prompt rather than passing them
  as arguments.
- **Bootstrap from existing EAS values** (once per environment):
  `cd apps/mobile && npx eas env:pull preview --path .env.preview`, then
  `DOTENVX_NO_NATIVE=true npx dotenvx encrypt -f .env.preview -fk ../../.env.keys`.
  Values with EAS "secret" visibility cannot be pulled; set those with
  `env:set`.
- **Rotate after a leak**: decrypt the file, delete its `DOTENV_PUBLIC_KEY_*`
  line and the matching private key, encrypt again (a new pair is made), share
  the new key, and rotate the leaked secrets at their providers. Git history
  still holds the old ciphertext, which the old key can read.
- Do not run `dotenvx protect`; it edits the global git config.
- `EXPO_PUBLIC_*` values are inlined into the app bundle, so they are public.
  Encrypting them keeps the files uniform; it does not make them secret. Real
  secrets (service-role key, relay and worker secrets) never go in
  `apps/mobile`. Server secrets live in `apps/web`, `apps/invite-email` and
  `supabase/.env.<environment>`.

## When asked to "just set it in the dashboard"

Do the file change and the apply command instead, and show the diff. If
the platform truly has no API for it, do the manual step only with the user's
go-ahead, then write it down (rule 7).

## Hosted changes need a go-ahead

Applying to a hosted project (`db:apply`, `config push`, `secrets set`,
`functions deploy`, `wrangler deploy`, `eas update`) changes shared,
user-facing systems. Prepare the change and the dry run, then ask before
applying unless the user has already said to.
