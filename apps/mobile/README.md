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
3. Screens, one file per UX spec domain under `src/screens/`, every spec
   screen id present (`src/flow.ts` is the registry; `test/flow.test.ts`
   proves every screen exists and is reachable from `sign_in`):
   - `entry.tsx` (U): sign in, create account, terms, vision, intent chooser,
     create org, explore, request access, scan QR, walkthrough.
   - `work.tsx`: My Work and Open Work (U); give assignment, progress (P).
   - `translate.tsx` (U): translate passage, recordings, attach questions,
     add to TG.
   - `review.tsx` (U): review passage, review questions, done; material
     editor (P).
   - `status.tsx` (P): status → language → book → piece → assign / stage /
     version / review.
   - `org.tsx` (P): org, project, language homes; members; invite; QR; edit
     member; new project / language; review teams.
   - `config.tsx` (P): roles, templates, reference library, key terms, flows.
   - `account.tsx`: inbox, settings, profile, org switcher (P); sign-out
     confirm (U, refused while anything is queued or the device is offline).
   Navigation is `src/nav.ts` (stack) driven by `ctx.go`, which only follows
   edges declared in `src/flow.ts`; undeclared transitions log `[flow] BLOCKED`,
   and so do gated edges the session's role cannot take (`edgeAllowed`).
   `test/specParity.test.ts` holds `src/flow.ts` to the UX spec's machine
   (`test/spec-flow.json`, regenerated with
   `npx tsx scripts/extractSpecFlow.ts <path to ng-langquest-ux>`).
   Session facets and the home screen per role come from `src/session.ts`.
   `src/DevMenu.tsx` (dev builds only, from Settings or the sign-in screen)
   switches persona by really signing in as a seeded account, seeds the demo
   team as owner, and can jump to any screen.

No business logic and no sync logic live here. Screens read `state` and call
`deriveTasks`, `deriveTakeStatus`, `deriveProgress`.

Run: copy `.env.example` to `.env`, fill the anon key from
`npx supabase status`, then build the dev client once with
`LANG=en_US.UTF-8 npx expo run:ios` (the native `modules/microphone-energy`
module cannot run in Expo Go) and afterwards `npx expo start --dev-client`.
Recording lives in `src/useRecorder.ts` (native VAD plus expo-audio),
`src/blobs.ts` (content-addressed store), `src/blobTransport.ts` (Supabase
Storage), and `src/screens/recordings.tsx`. `EXPO_PUBLIC_DEV_EMAIL`
and `EXPO_PUBLIC_DEV_PASSWORD` prefill the auth screen in dev builds only.
Event ids come from expo-crypto because Hermes has no `crypto.randomUUID`.
