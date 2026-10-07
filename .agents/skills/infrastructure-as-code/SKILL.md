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
| Cron jobs | a migration or `server/*.sql` script that unschedules then schedules by name | `db:apply` or a script (`npm run secrets` schedules the projection job) | `select * from cron.job` in the check |
| Auth, API, storage settings, buckets | `supabase/config.toml` (`[auth]`, `[api]`, `[storage.buckets.*]`); per-environment overrides in `[remotes.<name>]` | `supabase config diff`, review, then `supabase config push`. Run non-interactively (as agents do), push skips the prompt and applies everything, including template defaults such as the local `site_url`, so hosted values belong in `[remotes.<name>]` first | `supabase config diff` shows nothing |
| Edge functions and their config | `supabase/functions/*`, `[functions.*]` in `config.toml` | `supabase functions deploy <name>` | deployed version in `supabase functions list` |
| Hosted project refs | `[remotes.<env>] project_id` in `supabase/config.toml` (plain) | read by scripts | a test holds the dashboard's `SUPABASE_URL` var to it |
| Edge function secrets | encrypted root `.env.<environment>`; where each goes is `destinations` in `scripts/secrets.mjs` | `npm run secrets -- <env>` | `npm run secrets -- <env> --check` (digests) |
| Vault secrets | derived by `scripts/secrets.mjs` (`vault.create_secret` / `vault.update_secret`) | the same command | the same check |
| Cloudflare invite-email Worker | `apps/invite-email/wrangler.jsonc` (`env.preview` is the `-preview` Worker) | Workers Builds: `main` runs `npm run email:deploy`, `develop` runs `email:deploy:preview` (`docs/cloudflare.md`, decisions.md 43 and 50). The same commands deploy by hand | `wrangler deploy --dry-run --env=[preview]` |
| Cloudflare dashboard | `apps/web/wrangler.jsonc` (`env.preview` likewise); the page reads `apps/mobile/.env.<environment>` | the same, `npm run web:deploy` / `web:deploy:preview` | the same |
| Worker public settings | `vars` in the wrangler file, per environment | every deploy | `wrangler deploy --dry-run` lists them |
| Worker secrets | encrypted root `.env.<environment>` (or read from Supabase: the service-role key); names in each environment's `secrets.required` | `npm run secrets -- <env>`, never a deploy; builds hold no key (decisions.md 51) | a deploy fails while one is missing; `npm run secrets -- <env> --check` |
| Mobile build profiles, channels | `apps/mobile/eas.json`, `apps/mobile/app.json` (`runtimeVersion` policy, plugins, permissions) | `npm run ship -- --native` / `ship` | `npm run ship -- --check` (fingerprint) |
| Mobile public config (`EXPO_PUBLIC_*`) | plain `apps/mobile/.env.<environment>` | `npm run env:eas -- push <env>`; inlined at bundle time from that EAS environment | `supabaseConfigError` refuses a local URL in a release build |
| EAS environment variables (builds and updates) | the same plain env files; `environment` on each `eas.json` profile | `npm run env:eas -- push <env>` | `eas env:list --environment <env>` |

When something is not on this list (DNS, a new Cloudflare product, push
credentials), look for its CLI or API first. If none exists, record the manual
setting and its exact values in `docs/` and say so in the task summary.

## Secrets with dotenvx

Public settings are plain, in the platform's own file (`EXPO_PUBLIC_*` in
`apps/mobile/.env.<env>`, wrangler `vars`, `config.toml` remotes). Secrets
are committed **encrypted** with [dotenvx](https://dotenvx.com) in one file
per hosted environment, `.env.preview` and `.env.production` at the
repository root, so nobody passes `.env` files around (`docs/environments.md`,
decisions.md 51). Each carries its public key; the matching private key
(`DOTENV_PRIVATE_KEY_PREVIEW` or `_PRODUCTION`) sits in the one untracked
`.env.keys` at the repository root, shared once through a password manager.
Anyone can add or change a secret with the public key. Only holders of the
private key can read it. No build system holds a key: `npm run secrets`
applies secrets, and deploys never carry them.

| File | Holds | Read by |
| --- | --- | --- |
| `apps/mobile/.env.development` | local Supabase URL and key, plain | `npm start`, `ios`, `android`, `web` (through `dotenvx run`, with Expo's own loader off) |
| `apps/mobile/.env.preview`, `.env.production` | the app's hosted config, plain | `npm run env:eas -- push <env>` copies it to the EAS environment, which EAS Build and `ship` read; the dashboard page's build |
| `apps/mobile/.env.development.local` | a person's own dev login | `npm start`; ignored by git |
| `.env.preview`, `.env.production` | secrets, encrypted | `npm run secrets -- <env>`; `npm run diag -- --hosted` |
| `apps/mobile/.env.example` | names only | people |

Commands, all from the repository root:

| Task | Command | What it does |
| --- | --- | --- |
| Change a value | `npm run env:update -- <env> KEY ['value']` | The name picks the file: `EXPO_PUBLIC_*` goes plain into the app's file, then it shows the EAS diff and asks before pushing (preview and production); anything else is encrypted into `.env.<env>` (asks for the value, hidden, when it is left out). Commits that file alone |
| Apply secrets | `npm run secrets -- <env> [--check]` | Sets Worker, Edge Function and Vault secrets and the projection job; compares first and asks |
| Check EAS for drift | `npm run env:eas -- diff <env>` | Names keys that differ between the committed file and EAS; exits 1 on any difference |
| Push the file to EAS | `npm run env:eas -- push <env>` | Refuses an uncommitted file, shows the diff, asks, pushes |
| Check a machine | `npm run env:doctor` | The app's files are plain; key file private and ignored; which secrets files this machine can read |
| Run the app | `npm run app` | `npm start -- --dev-client` in `apps/mobile` |
| Guard | `npm run env:check` | Fails on a plain or misplaced secret (`npm test` runs it too) |

- **EAS is a copy.** The committed file is the truth. A value edited in the
  EAS dashboard shows up as drift in `env:eas -- diff` and is overwritten by the
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
- `env:update` of an app setting for preview or production, `env:eas -- push`
  and `npm run secrets` change hosted systems. Ask before running them unless the user already said to, and let
  the user type secret values at the hidden prompt rather than passing them
  as arguments.
- **Rotate after a leak**: see `docs/environments.md` (Rotating). Git history
  still holds the old ciphertext, which the old key can read.
- Do not run `dotenvx protect`; it edits the global git config.
- `EXPO_PUBLIC_*` values are inlined into the app bundle, so they are public
  and kept plain. Real secrets (service-role key, relay and worker secrets)
  never go in `apps/mobile` or in wrangler `vars`; `env:check` refuses them
  there.

## When asked to "just set it in the dashboard"

Do the file change and the apply command instead, and show the diff. If
the platform truly has no API for it, do the manual step only with the user's
go-ahead, then write it down (rule 7).

## Hosted changes need a go-ahead

Applying to a hosted project (`db:apply`, `config push`, `secrets set`,
`functions deploy`, `wrangler deploy`, `eas update`) changes shared,
user-facing systems. Prepare the change and the dry run, then ask before
applying unless the user has already said to.
