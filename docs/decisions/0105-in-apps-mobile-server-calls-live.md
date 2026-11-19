# 105. In `apps/mobile`, server calls live in `src/server/`, logic outside screens, and folders by feature

Date: 2026-10-14 · By: Carl Sauder · Status: accepted

Reason: a review of `apps/mobile` on 2026-10-14 found the packages well
separated but the app less so. Supabase was called from 28 files, four
screens among them: sign-in's whole policy (a v2 account, recreating the
dev account, recording the terms) sat in a button handler in `entry.tsx`,
and `org.tsx` read and wrote Explore listings and sent invite emails
itself. The largest screens (`config.tsx` 1,738 lines, `org.tsx` 1,639,
`passage.tsx` 1,420, `content.tsx` 1,366) mixed state, rules and layout,
though the pure-model pattern (`configModel.ts`, `adminModel.ts`) already
existed. `OrgWork` in `App.tsx` kept recent passages, Inbox reads,
onboarding, toasts and navigation in one component; the language's sync
engine was built inside `useLanguage`'s effect; and `src/` held about 110
files in one folder, with `simple/` (named for the redesign of 71, not a
concern) imported both ways by half the feature folders. Carl chose
(2026-10-14):

- Every Supabase call is a named function in `src/server/`, one file per
  area, returning supabase-js's `{ data, error }` so each caller keeps
  saying what a refusal means. Nothing else imports the client or calls
  `.rpc(`, `.auth.` or `.functions.invoke(`
  (`apps/mobile/test/serverBoundary.test.ts`). One folder rather than an
  `api.ts` per feature, so RPC names, error handling and offline behaviour
  can be read and checked in one place.
- Screens lay out; rules go in a pure `model.ts` (or `<thing>Model.ts`
  where a folder has several) tested without rendering, and state in
  `use*` hooks. `OrgWork` assembles `Ctx` from hooks of its own.
- The stream engines run outside React (`LanguageSession`, `OrgSession`,
  104); the hooks follow them.
- Folders by feature: `screens/` keeps only the entry files `App.tsx`
  registers, and each concern (auth, account, org, sync, audio, web,
  notifications, ui, shell, and the parts `simple/` held: recording,
  review, helps, admin, mic) gets a folder with its model, hooks, parts
  and anything it needs from `server/`. Pure files are `model.ts` or
  `<thing>Model.ts`; `*Core.ts` names go. The moves wait for the open
  recording and writing branches (pull requests 96 and 97) to land, so
  they rebase onto edits, not moves.
- The reasons: the logic that most often goes wrong (sign-in, membership,
  listing, sync wiring) is tested without rendering; a person or agent
  finds a feature's model, server calls and parts in one place; and every
  server call can be checked in one place, with a test keeping it there.

Reverse if: the thin server functions grow their own policy (retries,
caching) that callers then duplicate, which would argue for a typed
client per area with errors mapped once; or feature folders start
importing each other in a cycle, which would mean a shared layer belongs
below them.

Amended (2026-10-15, Carl Sauder): ESLint holds what may import what
(`eslint.config.mjs`, `npm run lint`, in CI's `checks` job and the
pre-push hook). Core imports nothing; sync only core and supabase-js (its
`src/testing`, Node built-ins too); nothing outside `src/server` imports
the Supabase client or supabase-js (types aside); nothing but `App.tsx`
and other screens imports a screen file; screens import no AsyncStorage,
SQLite, file system or event store; `model.ts` and `*Model.ts` import no
React, React Native, Expo, storage, `server/`, hooks or UI (types aside);
`src/server` imports no React, screens or shell; packages are imported by
their entry. Carl asked for it as strict as is reasonable: an audit after
the restructure found three feature models importing
`screens/configModel.ts` (now `src/config/model.ts`) and three screens
reaching storage themselves, which tests had not caught. React's
rules-of-hooks is on too; exhaustive-deps is not yet, since turning it on
means reviewing 55 effects whose re-runs would change.

Amended (2026-10-15, Carl Sauder): part two is done, earlier than planned.
Carl chose to make the moves while six pull requests were open rather than
wait for the three that overlap (96, 120, 126), so the moves are a codemod:
`scripts/restructure/moves.json` says where each file went and
`node scripts/restructure.mjs` makes the moves and rewrites everything
that names them, and can be run again. A branch made before the moves runs
it, commits, then merges `main`, so the moves meet themselves and only its
own edits are left to merge (`docs/merging-onto-the-restructure.md`). The
src root's files and `simple/` went to `shell`, `ui`, `sync`, `web`,
`audio`, `recording`, `helps`, `helpMode`, `mic`, `admin`, `invites`,
`work`, `map`, `account`, `auth`, `moderation`, `notifications`,
`diagnostics` and the existing feature folders; `recordingJournalCore.ts`
is `recordingJournalModel.ts`; `dev.ts` went to `auth/`, since `src/server`
may not import the shell. The passage record, the Map and reference
material had their rules moved out of their screens as config and content
had. ESLint now also holds `src/ui` as the design system, importing only
itself, `i18n`, `helpMode` and `shell/flow`, and keeps `src/server` from
the UI; `apps/mobile/test/folders.test.ts` keeps code out of the src root
and `simple/` gone.

Amended (2026-10-15, Carl Sauder): each file has one role, and its name
says which. Carl found the roles too loose once code was by feature: a
folder no longer said whether a file held components, hooks or helpers,
and about sixty files mixed them. Rather than go back to folders by kind,
the name carries the role: `screens/*.tsx` are screens; any other `.tsx`
exports components only (`eslint-plugin-react-refresh`); a `use<Thing>.ts`
file exports hooks only, with the contexts they read; `model.ts` and
`<thing>Model.ts` are pure, and never `.tsx`; `src/server/` holds the
server calls; every other `.ts` is a module, which exports no hooks.
`eslint-plugin-boundaries` holds which role may import which, for values
(types may come from anywhere): a component reaches the server through a
hook or module, a hook returns data rather than importing components, a
model or module imports neither components nor hooks, and a screen imports
no other screen, so the checks list the flow editor shows is
`checks/LanguageChecks.tsx`, no longer part of the checks screen. The split is a second codemod
round: the moved hooks and helpers are a hand commit that leaves
re-exports, and `movedExports` in `scripts/restructure/moves.json` repoints
every import of a moved name, on this branch and on any made before it.

Amended (2026-10-15, Carl Sauder): the codemod (`scripts/restructure.mjs`,
`scripts/restructure/moves.json`) and `docs/merging-onto-the-restructure.md`
are removed. Pull requests 126, 125, 123, 121 and 129 merged through it,
and the two still open from before the restructure (96 and 120) will be
redone on the new structure rather than merged across it, so no branch
needs them. Git history keeps where each file went. The layout and the
roles are held by `eslint.config.mjs` and `apps/mobile/test/folders.test.ts`.

Amended (2026-10-15, Carl Sauder): react-hooks/exhaustive-deps is on, as
an error, in the app. Carl chose to turn it on after seeing what it would
take: a hook that reads a value it does not list keeps that value from the
draw it first ran in, and agents write much of the code. Of the 55 hooks it
named, most only spelled their dependencies in a way the rule cannot read
(a method called on an object, a field of a value that is new each draw),
and now read them once instead; two read a value they did not list and
could show it stale (the source reader's language and whether it is
online). The rest list less or more on purpose, because the org and
language folds change their maps in place, because a counter is bumped on
cleanup, or because a key made of the inputs stands for them; each says why
after `--` on its disable comment, which lint now requires
(`@eslint-community/eslint-comments/require-description`), and a disable
that no longer excuses anything is an error.

Amended (2026-10-26, Carl Sauder): the reversal condition ("feature folders
start importing each other in a cycle") came true: 34 of the 41 folders in
`apps/mobile/src` formed one import cycle, because the folders every feature
stands on (`i18n`, `ui`, `helpMode`, `diagnostics`, `server`) imported
features back: `i18n` held a sheet drawn with `ui`, `helpMode` reported to
`diagnostics` and played through `audio`, `diagnostics` read the store in
`sync` and called `server`, and `server` used `auth`, `sync` and
`appVersion`. Carl chose a base layer below the features, held by lint
(`BASE_LAYERS` in `eslint.config.mjs`); feature folders may still import
each other. Lowest first: L0 `i18n`, `build` (the build id and whether it is
a test build); L1 `ui`, `helpMode`; L2 `session` (auth state, sign-out cause,
outcomes, the dev persona, the read-only flag) and `storage` (the on-device
store, stored files: formats, media type, hash); L3 `diagnostics`; L4
`server`. A base folder imports values only from its own level or below
(types from anywhere); features import any of them. What a lower layer needs
from a higher one is handed in once at start (`shell/wiring.ts`: how
diagnostics reach the server, how help audio reports) or sits lower:
`registerPlayback` is `ui/playback.ts` (audio re-exports it), the gate
around the transport is `sync/serverTransport.ts`, `watchRenewals` is
`server/renewalWatch.ts`, `inviteOutcome` is `invites/inviteOutcome.ts`, the
language sheet is `account/uiLanguage.tsx`, and which chrome a screen shows
is `shell/chromeModel.ts`, so `ui` imports no screen id as a value. The
layer is held, not only measured: no base folder is in an import cycle with
a feature folder; `ui` and `helpMode` still import each other, as the design
system's help badges always have. The phone lock's models
(`lockModel.ts`, `sealModel.ts`, decision 168) sit in `session/`, not
`auth/`, because `server/lock.ts` reads them.

Amended (2026-10-26, Carl Sauder): a screen may not import `src/server`
either. The role rules kept components from the server but not screens,
so `screens/globalViewer.tsx` verified codes, mapped their refusals and
paged organizations itself, and `entry.tsx` repeated sign-in's
diagnostics-and-terms tail in three handlers. Screens now reach the
server through hooks and modules (`auth/signInFlow.ts` and
`auth/useSignIn.ts`, `account/useGlobalViewer.ts`), and a screen that
builds an event goes through a named command (`org/orgCommands.ts`,
`config/configCommands.ts`) with the rules in a model. The same audit
gave server refusals one classifier (`diagnostics/refusalModel.ts`), so
callers stop re-reading `error.code`, the reverse-if above.
