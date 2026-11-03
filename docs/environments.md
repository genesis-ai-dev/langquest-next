# Environments

Three environments, one git branch each (decisions.md 50). Public settings are
plain, in each platform's own file. Secrets are encrypted in one file per
hosted environment, and a person applies them with one command when they
change; deploys never carry them, so no build system holds a key
(decisions.md 51).

| Environment | Git branch | Supabase | Cloudflare Workers | App (EAS) |
| --- | --- | --- | --- | --- |
| development | your branch | local (`npm run db:start`) | `npm run web:dev` (the Worker, local); `npm run dev` starts both | `npm run app`, development channel |
| preview | `develop` | persistent branch `develop` of the hosted project | `langquest-next-preview`, `langquest-next-invite-email-preview` | `preview` channel and profile |
| production | `main` | the hosted project `xymxnebdwtbkfxlbylch` | `langquest-next`, `langquest-next-invite-email` | `production` channel, TestFlight and Play internal |

Pull requests target `develop`. Merging one deploys preview. A release is a
pull request from `develop` to `main`, merged with a merge commit (not
squash, so the branches stay in step), and deploys production. A hotfix
branches from `main`, merges to `main`, then `main` is merged back into
`develop`.

Each platform deploys code through its own git integration. GitHub holds no
deploy token and no key; guardrails runs on pull requests and on pushes to
both branches.

| Platform | On a push to `develop` | On a push to `main` |
| --- | --- | --- |
| Supabase (GitHub integration) | migrations and functions to the `develop` branch | the same to production (`server/README.md`) |
| Cloudflare (Workers Builds) | `npm run web:deploy:preview`, `npm run email:deploy:preview` | `npm run web:deploy`, `npm run email:deploy` (`docs/cloudflare.md`) |
| EAS workflows | `.eas/workflows/deploy-preview.yml`: update or internal build | `.eas/workflows/deploy-to-testers.yml`: update or store build |

Per-pull-request Supabase branches still open automatically for database
changes. They have their own URL and no secrets, so they test migrations,
not the app.

## Where settings live

| Setting | File | Reaches the platform by |
| --- | --- | --- |
| The app's public config (`EXPO_PUBLIC_*`), plain | `apps/mobile/.env.<env>` | `npm run env:eas -- push <env>` (EAS builds and updates); the web build (`npm run export:web`) reads it too |
| Worker public config, plain | `vars` in each `wrangler.jsonc` (top level is production, `env.preview` is preview) | every deploy |
| Hosted Supabase project refs, plain | `[remotes.<env>] project_id` in `supabase/config.toml` | read by scripts; the app Worker's `SUPABASE_URL` var must match (a test checks) |
| Secrets, encrypted | `.env.preview`, `.env.production` at the repository root | `npm run secrets -- <env>` |
| Hosted Auth settings (`[auth*]`, such as `[auth.mfa.totp]`), plain | `supabase/config.toml` | `npx supabase config push` by hand, below; merging does not apply them |

The secrets file holds `INVITE_RELAY_SECRET` and `PUSH_DELIVERY_SECRET`,
and production also `DIAG_DATABASE_URL` (read on a laptop by
`npm run diag -- --hosted`, and by the admin page's Worker through the
Hyperdrive config `npm run secrets` makes from it). Production may
also hold the ops dashboard's `ADMIN_*` keys: one read-only token per
provider, each optional (`docs/admin.md`), and `APP_STORE_REVIEW_KEY`,
the key that sends new iPhone builds to App Review (The App Store key,
below). It may also hold `BIBLE_BRAIN_ACCESS_KEY`, Faith Comes By
Hearing's key for the Worker's Bible routes (`docs/reference-material.md`). That one is optional: it is not
in the Worker's `secrets.required`, so a deploy never waits for it, and
until a person sets it (`npm run env:update -- <env> BIBLE_BRAIN_ACCESS_KEY`,
then `npm run secrets -- <env>`) the Bible routes answer 503.
`WEBHOOK_POKE_SECRET` is optional the same way: with it, the database pokes
the Worker within seconds of a push to an organization that has webhooks
(decisions.md 101); without it, webhooks wait for the Worker's ten-minute
cron. `scripts/webhook-poke-secret.sh` makes a random one for each
environment that has none (preview, then production; `--rotate` replaces
it), commits it through `env:update` and applies it with `npm run secrets`.
`npm run secrets` puts each where it is used, as `scripts/secrets.mjs`
declares:

| Destination | Gets |
| --- | --- |
| app's Worker | `SUPABASE_SERVICE_ROLE_KEY`, read from Supabase each run, never stored in the repo; `BIBLE_BRAIN_ACCESS_KEY`, `WEBHOOK_POKE_SECRET`, `V2_SUPABASE_ANON_KEY` and `V2_DATABASE_URL` when the file has them, `YOUTUBE_CLIENT_ID` with `YOUTUBE_CLIENT_SECRET` when it has both, and `LINEAR_API_KEY` when it has it. Its job containers get them from the Worker at each start: the projection pass the database's, the v2 import v2's too, the tutorial publish job the YouTube client's, the comments job the YouTube client's and Linear's (`docs/server-jobs.md`) |
| invite-email Worker | `INVITE_RELAY_SECRET` |
| admin Worker (production only) | each provider token or key (`ADMIN_*`) when the file has them (`docs/admin.md`). Never the service-role key |
| Hyperdrive `langquest-next-diag` (production only) | `DIAG_DATABASE_URL`, as the config's connection; the first run makes the config and writes its id into `apps/admin/wrangler.jsonc` to commit (`docs/admin.md`) |
| GitHub Actions secrets of this repository (production only) | `GEMINI_API_KEY` when the file has it, for the nightly filming of the tutorial videos (`.github/workflows/tutorials.yml`, `docs/tutorial-videos.md`); `CLAUDE_CODE_OAUTH_TOKEN` when it has it, a Claude plan's sign-in for the nightly look at the videos' feedback (`.github/workflows/tutorial-review.yml`, `docs/tutorial-videos.md` "Feedback") and the watch for user issues (`.github/workflows/user-issues.yml`, `docs/diagnostics.md`). The watch also uses the `LINEAR_API_KEY` repository secret that `linear-sync.yml` uses, which this script does not place. Never a production key (`scripts/workflows.test.ts`); needs `gh` signed in |
| EAS's `production` environment (production only) | `APP_STORE_REVIEW_KEY` when the file has it, as a variable with secret visibility, which only EAS's jobs and builds can read: the App Review step of the EAS workflows (The App Store key, below). Needs `eas` signed in (`npx eas login`) |
| Edge Function secrets | `INVITE_RELAY_SECRET`, `PUSH_DELIVERY_SECRET` (once `PROJECTION_WORKER_SECRET`, which this unsets), `INVITE_RELAY_URL` (public, derived from the Worker's name) |
| Vault | `langquest_project_url`, `langquest_push_delivery_secret`; with `WEBHOOK_POKE_SECRET`, also `langquest_webhook_poke_secret` and `langquest_dashboard_url` (public, the app's Worker's route) |
| pg_cron | the push-delivery job: its migration (`20261026170400_push_delivery_when_waiting.sql`) schedules it, calling the function only when something is waiting, only where Vault already has the secrets, and leaves the projection pass to the Worker's job container, so this runs that migration again |

Worker secrets stay on the Worker across deploys, and wrangler refuses a
deploy while one in `secrets.required` is missing, so a forgotten secret
stops the deploy instead of breaking the Worker. `env:check` (run by
`npm test`) refuses a plain secret, a secret in the app's files, and a public
setting in the secrets file.

## Keys

Two private keys, `DOTENV_PRIVATE_KEY_PREVIEW` and
`DOTENV_PRIVATE_KEY_PRODUCTION`, each in its own password-manager entry and in
the `.env.keys` of whoever changes or applies that environment's secrets.
Nothing else holds a key: not GitHub, Cloudflare, Supabase or EAS. Running the
app or its Worker locally needs none. The Bible routes locally need the
Bible Brain key in your shell when `npm run web:dev` starts
(`scripts/web-dev-vars.ts` copies it into the ignored `apps/web/.dev.vars`
without printing it); without it they answer 503. `npm run db:start` and
`npm run db:reset` also schedule push delivery locally, every minute, with a
local secret of its own, and seed the library (`server/README.md`). Plain
`supabase start` or `supabase db reset` skip both. The projection pass runs
in the Worker's job container while `npm run web:dev` runs (Docker needed),
as on a hosted project (decision 148).

Workers Builds still keeps branch builds off on every Worker, so a branch
never deploys over preview or production.

## Commands

| Task | Command |
| --- | --- |
| Set one value | `npm run env:update -- <env> KEY ['value']`: `EXPO_PUBLIC_*` goes plain into the app's file and on to EAS; anything else is encrypted into `.env.<env>` (asks for the value, hidden, when it is left out) |
| Apply secrets | `npm run secrets -- <env>` (shows what differs, asks); `--check` only compares; `--only eas` does either for EAS's secrets alone, with no Supabase or Cloudflare sign-in |
| Push the app's file to EAS | `npm run env:eas -- push <env>` |
| Deploy a Worker by hand | `npm run web:deploy[:preview]`, `npm run email:deploy[:preview]` |
| Create the R2 buckets the Worker binds | `npm run r2:buckets -- <env>` |
| Check this machine | `npm run env:doctor` |

### Auth settings

Merging applies migrations but not `supabase/config.toml`'s Auth settings,
so a change under `[auth*]` reaches a hosted project only when someone runs
`config push` by hand (decided 2026-10-20, decisions.md 158). After such a
change is on `main`, for preview and then production:

```bash
npx supabase link --project-ref <ref from [remotes.<env>]>
npx supabase config push
```

It shows what it would change and asks. Say yes only when the diff is the
change on `main`: anything more means the hosted project was changed in its
dashboard, and the repository file is put right first (`infrastructure-as-code`).
The first push turns on authenticator codes (`[auth.mfa.totp]`), which
Global Viewers need (docs/global-viewers.md).

`npm run secrets` compares Supabase values by digest. Worker secrets cannot be
read back, so it only checks that they exist, and sets them again on every
apply.

## The App Store key

`APP_STORE_REVIEW_KEY` is how `scripts/app-store-review.mjs` sends each new
iPhone build to App Review (decisions.md 157): an App Store Connect API team
key with the App Manager role, the least role that can submit for review.
It is one JSON value, `{"issuerId", "keyId", "privateKey"}`, the last being
the text of the key's `.p8` file, the same shape as the ops dashboard's
`ADMIN_APP_STORE_KEY` (`docs/admin.md`). It lives encrypted in
`.env.production`, and `npm run secrets` puts it in EAS's production
environment, the only place that reads it: the hourly
`.eas/workflows/app-store-review.yml` and the `review_ios` job of
`deploy-to-testers.yml`. It never goes to GitHub, which holds no production
key (decisions.md 141, `scripts/workflows.test.ts`). Without it the step
says "no App Store Connect key yet" and succeeds, and iPhone builds wait in
TestFlight for a person to send them.

To make it, once, as an Admin or the Account Holder of the Apple developer
team that owns the app (team `GW63HDZ4G9`, app `6812492008`):

1. App Store Connect > Users and Access > Integrations > App Store Connect
   API > Team Keys. If it shows Request Access instead, the Account Holder
   clicks it once.
2. Generate API Key (the + button): Name `LangQuest App Review`, Access
   App Manager. Generate.
3. Download API Key. Apple offers the file once:
   `~/Downloads/AuthKey_<key id>.p8`. The Key ID is in the key's row, the
   Issuer ID above the list.
4. Store the three together, put them in EAS (signed in with
   `npx eas login`), then delete the file:

   ```
   npm run env:update -- production APP_STORE_REVIEW_KEY "$(jq -cn --arg i <issuer id> --arg k <key id> --rawfile p ~/Downloads/AuthKey_<key id>.p8 '{issuerId: $i, keyId: $k, privateKey: $p}')"
   npm run secrets -- production --only eas
   rm ~/Downloads/AuthKey_<key id>.p8
   ```

5. See what the step would do, without sending anything:
   `npx dotenvx run -f .env.production -fk .env.keys --quiet -- node scripts/app-store-review.mjs --dry-run`.

Each run prints one line, which starts with what it did:

| Line | Means |
| --- | --- |
| `submit:` | no review was open, so the newest build Apple has processed went to App Review, on its own App Store version, released as soon as Apple approves it |
| `wait:` | a review is waiting or under way, or an approved version is not out yet; the newest build waits in TestFlight and goes on a later run |
| `held:` | Apple rejected the version, or a draft submission in App Store Connect holds something else. Someone reads Apple's message in App Store Connect (App Review), answers it there, and resubmits or removes the version; after that the step goes on by itself |
| `stuck:` | the newest build's version number belongs to a version already out, which Apple takes only once, so the run fails. Two store builds of merges in the same minute, or a second build of one merge, share a number; the next store build brings a new one |
| `none:` | nothing newer than the public build, or nothing processed yet |

It never cancels or changes a review, and never deletes anything. To
replace the key, make a new one the same way, store and apply it, then
revoke the old one in the same list.

When the Integrations page will not open (in October and November 2026
it said "An error has occurred, try again later" and went back to Apps
for an Admin, as [other Admins report](https://developer.apple.com/forums/thread/811711)),
try Safari in a private window first. Failing that, an individual key does
the same job: your name (top right) > Edit Profile > Individual API Key >
Generate, then download it (`~/Downloads/ApiKey_<key id>.p8`). It has no
Issuer ID, so leave `issuerId` out, and the step signs as that user
(`"sub": "user"`):

```
npm run env:update -- production APP_STORE_REVIEW_KEY "$(jq -cn --arg k <key id> --rawfile p ~/Downloads/ApiKey_<key id>.p8 '{keyId: $k, privateKey: $p}')"
```

An individual key acts with its user's role and apps, and stops working
if that user leaves the team or loses the role, so replace it with a team
key once the Integrations page opens.

## Setting up preview (once)

1. **Git.** Create `develop` from `main`, make it the default branch (so pull
   requests target it), and protect both branches (pull request required,
   guardrails `checks` passing):
   `git push origin main:develop && gh repo edit --default-branch develop`.
2. **Supabase.** Create the persistent branch:
   `npx supabase branches create develop --persistent --git-branch develop --project-ref xymxnebdwtbkfxlbylch`
   (its compute is billed). It starts with the migrations and no data.
3. **Public settings,** with the branch's ref and anon key
   (`npx supabase projects api-keys --project-ref <ref>`):
   - `[remotes.preview]` with `project_id = "<ref>"` in `supabase/config.toml`
   - `"vars": { "SUPABASE_URL": "https://<ref>.supabase.co" }` in `env.preview`
     of `apps/web/wrangler.jsonc`
   - `npm run env:update -- preview EXPO_PUBLIC_SUPABASE_URL https://<ref>.supabase.co`
     and `npm run env:update -- preview EXPO_PUBLIC_SUPABASE_ANON_KEY <anon key>`
4. **Secrets.**
   `npm run env:update -- preview INVITE_RELAY_SECRET "$(openssl rand -hex 32)"`,
   `npm run env:update -- preview PUSH_DELIVERY_SECRET "$(openssl rand -hex 32)"`,
   then `npm run secrets -- preview`. That also creates the two `-preview`
   Workers, so their first deploy finds its secrets.
5. **Cloudflare.** Connect each `-preview` Worker to the repository in Workers
   Builds as `docs/cloudflare.md` lists, and create its R2 bucket:
   `npm run r2:buckets -- preview`.
6. **EAS.** Nothing to set: `deploy-preview.yml` runs on the first push to
   `develop` that touches the app. iOS internal builds install only on
   registered devices (`npx eas device:create`).

## Rotating

A leaked secret: set a new value with `env:update`, then `npm run secrets`.
Both ends of the relay and of the projection secret change together, so
nothing is left mismatched. The service-role key is rotated in Supabase; then
run `npm run secrets` for that environment.

A leaked private key: decrypt that environment's `.env.<env>`, delete its
`DOTENV_PUBLIC_KEY_<ENV>` line and the private key, encrypt again (a new pair
is made), share the new key, and rotate every secret in the file as above.
Git history still holds the old ciphertext, which the old key can read.
