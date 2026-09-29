# apps/mobile

Expo 57 app, runs in Expo Go. Owns exactly three things:

1. `src/store.ts`: the expo-sqlite driver behind `SqliteStore` from
   `@langquest-next/client`. The store logic itself lives in the client
   package and is contract-tested there against node:sqlite.
2. `src/useProject.ts`: one `SyncClient` per open project with
   `SupabaseTransport`, sync on open and every 15 s, a pending count.
   `src/useOrg.ts`: the same client on the org partition (`_org`) with the
   org materializer; `src/session.ts` derives privileges from both folds
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
   - `org.tsx`: org, project, language homes; members; invites; teams.
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
   a dev build can jump to any screen. It is shown to dev builds and to the
   testers named in `src/dev.ts` (`EXPO_PUBLIC_PERSONA_EMAILS` overrides the
   list), because walking the translator's and reviewer's experience is how
   this gets tested and a release build has no dev menu.
   `src/invites.ts` holds the two writes a non-member may make: `issue_invite`
   / `redeem_invite` and the `join_requests` table (migration 12, docs 5.B).
   Both end in the ordinary `v1.OrgMemberAdded`; neither is an event of its
   own.

No business logic and no sync logic live here. Screens read `state` and call
`deriveTasks`, `deriveTakeStatus`, `deriveProgress`.

Run: copy `.env.example` to `.env`, fill the anon key from
`npx supabase status`, then build the dev client once with
`LANG=en_US.UTF-8 npx expo run:ios` (the native `modules/microphone-energy`
module cannot run in Expo Go) and afterwards `npx expo start --dev-client`.
Recording lives in `src/useRecorder.ts` (native VAD plus expo-audio),
`src/blobs.ts` (content-addressed store), `src/blobTransport.ts` (Supabase
Storage), and `src/screens/translate.tsx` with `src/recording/`. `EXPO_PUBLIC_DEV_EMAIL`
and `EXPO_PUBLIC_DEV_PASSWORD` prefill the auth screen in dev builds only.
Event ids come from expo-crypto because Hermes has no `crypto.randomUUID`.

## Shipping a change

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
`production` (`eas.json`). `EXPO_PUBLIC_*` values are inlined into the bundle
at publish time, so changing one ships as an ordinary update.
