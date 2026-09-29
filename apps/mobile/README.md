# apps/mobile

Expo 57 app, run as a development build (the native recorder module does not load in Expo Go). Owns exactly three things:

1. `src/store.ts`: the expo-sqlite driver behind `SqliteStore` from
   `@langquest-next/client`. The store logic itself lives in the client
   package and is contract-tested there against node:sqlite.
2. `src/useProject.ts`: one `SyncClient` on the open language's partition
   with `SupabaseTransport`, sync on open and every 15 s, a pending count.
   `src/useOrg.ts`: the same client on the org partition (`_org`) with the
   org materializer. An organization holds its languages directly and is
   what you switch between (docs/decisions.md 34); each language is its own
   partition, listed in `_org`, and a phone pulls the ones it opens
   (decision 37, `src/languages.ts`; `src/partitionWriter.ts` starts a new
   one). `src/createOrg.ts` starts an organization; `src/session.ts` derives privileges from both folds
   (`can(privilege)`, `adminScope`), and Home follows the admin scope.
3. Screens, one file per UX demo domain under `src/screens/`, every demo
   screen id present (`src/flow.ts` is the registry, generated from the
   demo's flow; `test/flow.test.ts` proves every screen exists and is
   reachable from `sign_in`):
   - `entry.tsx`: sign in, create account, terms, vision, intent chooser,
     create org, explore, request access, scan QR. `onboarding.tsx`: welcome.
   - `work.tsx`: My Work. `map.tsx`: all languages, passage map, book chapters.
   - `passage.tsx`: passage record, version, review, ask someone.
   - `translate.tsx`: the recording workspace and back translation
     (`src/recording/`). `review.tsx`: review it, already happened, review by link.
   - `study.tsx`: study guide and step (`src/study/`, `src/scripture.ts`).
   - `org.tsx`: org and language homes; members; invites; teams.
   - `config.tsx`: roles, reference, key terms, review flows.
     `content.tsx`: content templates and dividing a book.
   - `account.tsx`: inbox, settings, profile, org switcher, sign out, sync.
   Shared: `src/kit.tsx` (the demo's UI primitives), `src/theme.ts`,
   `src/passageView.ts`, `src/voiceNote.tsx`; `docs/ux/demo-parity.md`.
   Navigation is `src/nav.ts` (stack) driven by `ctx.go`, which only follows
   edges declared in `src/flow.ts`; undeclared transitions log `[flow] BLOCKED`,
   and so do gated edges the session's role cannot take (`edgeAllowed`).
   `test/specParity.test.ts` holds `src/flow.ts` to the UX spec's machine
   (`test/spec-flow.json`, regenerated with
   `npx tsx scripts/extractSpecFlow.ts <path to ng-langquest-ux>`).
   Session facets and the home screen per role come from `src/session.ts`.
   `src/DevMenu.tsx` (from Settings or the sign-in screen) switches persona by
   really signing in as a seeded account, seeds the demo team as owner, and in
   a dev build can jump to any screen. Personas work only against a local
   Supabase and only when `EXPO_PUBLIC_DEV_PASSWORD` is set (there is no
   built-in password: `EXPO_PUBLIC_*` values are public); seeding also needs a
   dev build. The testers named in `src/dev.ts` (`EXPO_PUBLIC_PERSONA_EMAILS`)
   may use it in a release build pointed at a local server.
   `src/invites.ts` holds the writes a non-member may make: `issue_invite`,
   `redeem_invite_v2` and the `join_requests` table (migration
   20260915120000). They end in the ordinary `v1.OrgMemberAdded`, recorded
   alongside `v1.InviteIssued`, `v1.InviteRedeemed` and `v1.JoinDecided`.

No sync logic lives here. Screens read `state` through core derivations
(`derivePassage`, `highlightsFor`, `languageProgress` and the rest in
`packages/core/src/passage.ts`) and write through core `commands()`. A few
screen models build org-partition events core has no commands for
(`src/orgAdmin.ts`, `src/screens/configModel.ts`, `src/contentTemplates.ts`);
they are listed in `docs/ux/demo-parity.md`.

Run: get `.env.keys` from a teammate once (password manager, never chat or
email) and put it at the repository root. The env files are committed
encrypted with dotenvx, so there is nothing else to copy. Then build the dev
client once with `LANG=en_US.UTF-8 npm run ios` (the native
`modules/microphone-energy` module cannot run in Expo Go) and afterwards
`npm start -- --dev-client`. Use the npm scripts, not `npx expo` directly:
they decrypt `.env.development` and turn off Expo's own `.env` loading. Your
own dev login goes in `.env.development.local` (git ignores it).
Recording lives in `src/useRecorder.ts` (native VAD plus expo-audio),
`src/blobs.ts` (content-addressed store), `src/blobTransport.ts` (Supabase
Storage), and `src/screens/translate.tsx` with `src/recording/`. `EXPO_PUBLIC_DEV_EMAIL`
and `EXPO_PUBLIC_DEV_PASSWORD` prefill the auth screen in dev builds only.
Event ids come from expo-crypto because Hermes has no `crypto.randomUUID`.

## Shipping a change

**Merging to `main` ships to TestFlight** through the EAS workflow in
`.eas/workflows/deploy-to-testflight.yml`, on Expo's servers: the typecheck
and unit tests run, then a change whose native fingerprint matches an
existing production build goes out as an over-the-air update on the
`production` channel (TestFlight installs take it on next launch), and any
other change builds a new iOS binary and submits it to TestFlight. It needs
the GitHub repository connected to the EAS project once, with its base
directory set to `apps/mobile` (expo.dev, project settings, GitHub). The
manual commands below remain for other channels and for shipping by hand.

`runtimeVersion` is the `fingerprint` policy and updates point at this EAS
project, so which changes need a new binary is decided for you rather than
guessed:

- **JavaScript only** (screens, hooks, `src/invites.ts`, the packages):
  `npm run ship -- -m "what changed"`. Typechecks, then publishes to the
  `preview` channel; the fingerprint is unchanged, so installed builds take it
  on next launch.
- **Anything native** (a new Expo module, `app.json` plugins or permissions,
  an SDK bump, `modules/microphone-energy`): the fingerprint changes, the
  update no longer matches any installed binary, so `npm run ship:native`.
  Pushing an update with a changed fingerprint is not dangerous, it simply
  reaches nobody until a matching build exists.
- **Not sure which** you are looking at: `npm run ship:check`
  (`eas fingerprint:compare`) says whether this working tree still matches
  the last build. `npm run ship:status` lists the recent updates on `preview`
  with the runtime version each landed on, which is where a push that seems
  to have reached nobody shows itself.

`ship:prod` and `ship:native:prod` are the same two against `production`.
All of them run from `apps/mobile`; the repository root forwards `ship`,
`ship:native` and `ship:check` for when you are already there.

Build profiles map to channels of the same name: `development`, `preview`,
`production` (`eas.json`), and each profile and `ship` script names the EAS
environment of the same name. `EXPO_PUBLIC_*` values are inlined into the
bundle at publish time, so changing one ships as an ordinary update: set it in
the encrypted file with `npm run env:update -- preview KEY` from the repository
root. It asks for the value, commits the file, and copies it to EAS, where
builds and updates read it. Change values this way, never in the EAS
dashboard; `npm run env:diff:eas -- preview` shows any drift.
