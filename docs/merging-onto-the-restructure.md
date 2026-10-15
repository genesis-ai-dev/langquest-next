# Merging a branch onto the restructure (pull requests 116 and after)

For anyone, person or agent, whose branch started before the restructure
reached `main`: pull request 116 ("Separation of concerns"), and part two,
which moved `apps/mobile/src` by feature (the next section). It renamed a package, moved every
Supabase call into one folder, took the sync engine out of React and moved
the large screens' rules into tested models (decisions.md 104, 105). Most
branches merge with git's help alone; this page says where code went when
it does not, and what the tests now hold you to.

Read `AGENTS.md` and decisions 104 and 105 first. Where this page and a
decision disagree, the decision wins.

## Part two: the moves and the roles, by codemod

Part two moved every file in the `src` root and `simple/` into feature
folders, then gave each file one role, named by its file name (below). Each
step that touched imports across the app is one mechanical commit: the
output of `node scripts/restructure.mjs`, and nothing else.
`scripts/restructure/moves.json` lists where each file went (`moves`) and
which names moved to another file (`movedExports`). There are two such
commits, each with a subject ending `: node scripts/restructure.mjs`. A
branch made before them should not merge them like other commits: an edit
next to an import both sides rewrote conflicts even when the rewrites
match. Apply the codemod on the branch instead, and tell git each of those
commits is already in:

```bash
git fetch origin
for C in $(git log origin/main --reverse --format=%H --grep=': node scripts/restructure\.mjs$'); do
  git merge "$C^"                      # everything before it; resolve as usual
  node scripts/restructure.mjs         # the same changes, on your branch and your own new code
  git add -A && git commit --allow-empty -m "Apply the restructure codemod"
  git merge -s ours "$C"               # that commit: your branch already has it
done
git merge origin/main                  # whatever came after
node scripts/restructure.mjs           # once more, for anything the merge brought in
npm install && npm run typecheck && npm test && npm run lint
```

When a merge in the loop stops on conflicts, resolve them, commit, and run
the rest of the loop by hand from the codemod line. `-s ours` is right only
for those commits: each is the codemod's output and nothing else, so your
branch already holds everything it does. Never use it for any other merge.

What the codemod cannot see: a path inside a regular expression or built
up from pieces, such as a test that skips files by
`/src\/(helpMode|DevMenu)\.tsx$/`; a `vi.mock` of a file whose hook
moved (mock the hook's new file); and a moved name read off a namespace
(`Simple.GetReady`). Tests that fail after it are usually these: find where
the file or name went in `moves.json` and update it. A new
file of your own that is loose in `src` or in `simple/` fails
`apps/mobile/test/folders.test.ts`; put it in its feature's folder (add a
line to `moves.json` if others may have the same file).

## The procedure (pull request 116)

1. Merge, don't rebase: `git fetch origin && git merge origin/main`. Git
   follows the renames (`packages/client` to `packages/sync`, the files in
   the table below) and carries your edits to their new paths. Rebasing a
   long branch replays every commit through the renames and asks the same
   question many times.
2. `npm install`. The workspace link is `node_modules/@langquest-next/sync`
   now; without it nothing resolves.
3. Resolve conflicts with the maps below: a conflict in a screen or hook
   usually means the code you changed moved to a model or hook, so make
   your change there and take the restructured version of the screen.
4. Fix anything that still names the old places (next section).
5. Check, from the repository root: `npm test`, `npm run typecheck`, and for
   a change a person sees, `npm run test:web` and the UI suites
   (`docs/ui-test-suite/README.md`). Tests that fail with "decisions.md 104"
   or "105" in the message are the boundary tests below: follow what they say.

## Renamed and moved

| Before | Now |
|---|---|
| `packages/client/*`, `@langquest-next/client` | `packages/sync/*`, `@langquest-next/sync` |
| Every file in `apps/mobile/src` itself, and `simple/` | a feature folder: `scripts/restructure/moves.json` (part two, above) |
| `apps/mobile/src/supabase.ts` | `apps/mobile/src/server/supabase.ts` (only `server/` may import it) |
| `apps/mobile/src/blobTransport.ts` | `apps/mobile/src/server/blobTransport.ts` |
| `apps/mobile/src/v2SignIn.ts` | `apps/mobile/src/server/v2.ts` |
| `apps/mobile/src/signOutCore.ts` | `apps/mobile/src/server/signOut.ts` |
| `apps/mobile/src/durableOutbox.ts` | `packages/sync/src/durableOutbox.ts` (import from `@langquest-next/sync`) |
| `apps/mobile/src/handOverCore.ts` | `packages/sync/src/handOver.ts`; `Attempt` is `HandOverAttempt` |
| `ORG_MATERIALIZER` in `useOrg.ts` | exported by `@langquest-next/sync` |
| Persona sign-in in `dev.ts` | `server/personas.ts` (`dev.ts` keeps who may switch) |

Search your branch for these after merging:

```bash
git grep -nE "langquest-next/client|packages/client" -- ':!docs/decisions.md' ':!docs/journey-tests' ':!docs/performance-audit.md' ':!docs/merging-onto-the-restructure.md' ':!supabase/'
```

```bash
git grep -nE "'(\./|(\.\./)+)(supabase|blobTransport|v2SignIn|signOutCore|handOverCore|durableOutbox)'" -- apps server scripts e2e ':!apps/mobile/src/server/'
```

Both print nothing on a branch that merged cleanly. (Older decision entries
and shipped migrations say `packages/client` on purpose: they are history.)

## What the tests and lint now hold

`npm run lint` (`eslint.config.mjs`, in CI and pre-push) holds the rules
below as you type, with a message naming where the code belongs; the two
boundary tests hold the first two as well.

- **No platform in `packages/sync`.** It imports only core, supabase-js
  and its own files (`packages/sync/test/boundary.test.ts`). A platform
  piece (a driver, a file store, `AsyncStorage`, a configured client) is a
  constructor argument, wired up in the app.
- **No Supabase outside `apps/mobile/src/server/`.** Nothing else imports
  the client or supabase-js (types aside), or calls `.rpc(`, `.auth.` or
  `.functions.invoke(` (`apps/mobile/test/serverBoundary.test.ts`). A new
  call is a named function in the `server/` file for its area (`auth`,
  `account`, `invites`, `library`, `languages`, `moderation`,
  `notifications`, `reference`, `diagnostics`, `v2`, `personas`,
  `handOver`, `sync`), returning supabase-js's own `{ data, error }`; the
  caller says what a refusal means. The stream transport is
  `serverTransport()` from `server/sync.ts`.
- **Each folder its place** (lint only). A model (`model.ts`,
  `<thing>Model.ts`) imports no React, platform, storage, server or hook,
  types aside. A screen file is imported only by `App.tsx`, and itself
  reaches no storage. `src/server/` knows nothing of screens, the shell or
  the UI. `src/ui/` is the design system: it imports only itself, i18n,
  help mode and `shell/flow`. Nothing sits loose in `src` or in `simple/`
  (`apps/mobile/test/folders.test.ts`).
- **Each file one role, named by its file** (lint). `screens/*.tsx` are
  screens; any other `.tsx` exports components only; `use<Thing>.ts`
  exports hooks only (and the contexts they read); `model.ts` and
  `<thing>Model.ts` are pure `.ts`; `src/server/` holds server calls; any
  other `.ts` is a module and exports no hooks. For values (types may come
  from anywhere): a component reaches the server through a hook or module,
  a hook does not import components (return data; let a component draw
  it), a model or module imports no components or hooks, and a screen
  imports no other screen. A hook found in a component file goes to a
  `use<Thing>.ts` beside it; a helper found in a component or hook file
  goes to a module or model beside it. Write an import used only for types
  as `import type`, or lint takes it for a value.
- **Labels are not words.** A diagnostics label passed to anything but
  `noteExpected` or `reportError` (a `where` field, `deps.note(...)`) needs
  an `// i18n-ignore:` comment saying so, or the catalog test
  (`apps/mobile/test/i18n.test.ts`) reads it as text on screen.
- **Screen contracts follow imports two levels.** An event a screen declares
  may be named in a model the screen's hook imports
  (`apps/mobile/test/screenContracts.test.ts`).
- **The web export's JavaScript budget is 6.1 MB** (decision 58). Each new
  module costs about half a kilobyte in Metro's output.

## Where things went

### The sync engine (`useLanguage`, `useOrg`)

The per-language engine is `LanguageSession` in
`packages/sync/src/languageSession.ts`; the organization's is `OrgSession`
in `orgSession.ts`. They own the SyncClient, the upload and download
TransferWorkers, the SyncScheduler, the realtime watch, storage reclaim and
which units are kept offline, and they are tested in Node
(`packages/sync/test/languageSession.test.ts`, `orgSession.test.ts`).

`useLanguage` and `useOrg` open a session with the phone's store, files and
transport and follow it into React state. `LanguageHandle` and `OrgHandle`
did not change, so screens need nothing. If your branch changed what
`useLanguage` did inside its big effect (when it syncs, what a sync
result sets, transfer rules, the state it publishes), make the change in
`LanguageSession`. Status fields are `LanguageStatus`, set through
`set()`, which tells subscribers only when a field changed. What stays in
the hook: copying state for React (`stateCopier`), playable URLs, transfer
speeds (`RateMeter`), the recording journal's resume, and the "language
loading" error text.

### `App.tsx`

`OrgWork` assembles `Ctx` from hooks in `apps/mobile/src/shell/`; `Shell`
uses `useOpenOrganization`. Screens are still registered in `App.tsx`'s
`SCREENS` table, which merges as before.

| Concern in `OrgWork` | Now |
|---|---|
| Which organization is open, arrivals from another one | `shell/useOpenOrganization.ts` |
| The language this person works in, `setLanguage`, `languages` | `shell/useWorkingLanguage.ts` |
| The welcome seen, `markWelcomed` | `shell/useOnboarding.ts` |
| Recent passages | `shell/useRecentPassages.ts` |
| `details` | `shell/useDetails.ts` |
| `toast`, `act`, Undo | `shell/useActions.ts` |
| Inbox updates, reads, report and request counts, `forYou` | `shell/useInbox.ts` |
| `go`, `goFrom`, `openPassage`, `openTask` | `shell/useNavActions.ts` |
| Auth routing, the web address, the remembered home | `shell/useRouting.ts` (which section an address may reopen: `shell/routingModel.ts`) |
| Links, held and dead invites, tapped pushes | `shell/useIncoming.ts` |
| Test-build probes (`__langquest*`) | `shell/useTestProbes.ts` |

### Screens

Rules moved into pure, tested modules, and stateful logic into hooks, beside
the feature. The screen keeps the layout and calls them.

- `screens/entry.tsx`: sign-in policy (sign-in names, the v2 fallback, the
  dev account) is `auth/signIn.ts` (`signIn`, `signInReady`); Create
  Account's rule is `auth/model.ts` (`createAccountReady`, `MIN_PASSWORD`);
  Request Access's search is `auth/model.ts` (`matchOrganizations`) and
  `auth/useOrganizationSearch.ts`; the scan screen's preview polling is
  `auth/useInvitePreview.ts`, and its verdict `scanVerdict` in
  `heldInvite.ts`.
- `screens/account.tsx`: `account/` (`useOrganizations`, `useInviterName`,
  `useHasPassword`, `useDiagnosticsSwitch`, `useUnsent`,
  `useSyncInspection`, and `useJoinRequests`, `useOpenReports`,
  `useServerInbox` in `useInboxSources.ts`); pure: `account/model.ts`
  (`syncSummary`, `lastSyncText`, `unsentWork`, `remoteRowView`,
  `refusedHere`, `speed`).
- `screens/org.tsx`: adding a language end to end is `org/newLanguage.ts`
  (`createLanguage`, with the library and both streams passed in;
  `newLanguageParts`, `offerSpecs`); invite email `org/emailInvite.ts`;
  the Explore listing `org/usePublicListing.ts`; refusal texts and
  `looksLikeEmail` in `org/model.ts`.
- `screens/config.tsx`: `roles/model.ts`, `flows/model.ts`,
  `keyTerms/model.ts`, `reference/materialModel.ts` (`config/model.ts`, which was `screens/configModel.ts`
  is unchanged).
- `screens/content.tsx`: `templates/model.ts` (the templates view, cards,
  `pickerLists`, `pickerNote`, version lines, `languageSummary`,
  `filterBooks`, editor helpers), `templates/bookStructureModel.ts` (Divide a
  Book's data), `templates/hooks.ts` (`useRunner`, `useVersifications`),
  `templates/useTemplateEditor.ts` (the editor form's state and Save),
  `templates/usePickTemplate.ts` (the picker's Use).

`screens/passage.tsx`, `map.tsx`, `reference.tsx` and the rest are as they
were.

### End-to-end tests

Removed, because unit tests now hold every check they made (their IDs name
those unit tests): WEB-017 TRANS, LADMIN, VIEW and NOORG; WEB-019 VIEW;
AUTH-003; AUTH-020; AUTH-041. AUTH-019 now also checks Create Account
starts disabled and a short password says why. If your branch edits one of
these, put the check in the unit test that holds it.

Phone flows carry tags for what they need (`voice`, `android-only`,
`wrapped`) and `npm run test:ui:phone` skips, and lists, what a run cannot
hold. A new flow that needs a microphone signal, airplane mode, or a step
from outside gets the tag (`scripts/maestroPlan.test.ts` checks).

## Decision numbers

`main` took 103 (large-language projections) while 116 was open; 116 added
104 and 105. **The next free number is 106.** A branch that added 103 or
later renumbers its entry, and every reference to it (code comments, tests,
docs), from the first number free when it merges. Never renumber an entry
already on `main`.

## Open pull requests, as of 2026-10-15

Each was taken through the part-two procedure in a dry run. Conflicts in its
first step come from the audit fixes that went in just before the moves;
the rest come from the Map, reference and passage screens, whose rules
moved into models (`map/mapModel.ts`, `reference/*Model.ts`,
`passage/askModel.ts`, `reviewModel.ts`, `recordInputsModel.ts`).

- **126, help coverage.** Two conflicts in the first merge:
  `guides/GuideEditor.tsx` (`useMethod` is `pickMethod` now: it is not a
  hook) and `screens/config.tsx` (`use` is `adopt`, and `configModel` is
  `config/model.ts`). After the codemod its `helpParts.ts` test skips files
  by `/src\/(helpMode|DevMenu)\.tsx$/`: those are
  `helpMode/helpMode.tsx` and `shell/DevMenu.tsx` now.
- **125, Reports catch-up, and 123, sign-out on the web.** Clean.
- **121, guardrails before pushing.** Two conflicts in the first merge:
  `.githooks/pre-push` and `AGENTS.md`, both of which now run
  `npm run lint` too. Keep both sides' steps.
- **120, big languages.** Clean through the codemod, then 7 hunks against
  the moved rules. It reads each passage off its line (`PassageLines`)
  where the screens read the whole record, so carry that into the models:
  `languageEntries(state, lines)` with its cache keyed by `lines`,
  `forYouIds` and `nextPassage` calling `highlightsOf` and `upNextOf` with
  `lines` (and `useMapLanguage.ts` passing `ctx.language.lines` and listing
  it in the memo's dependencies), `statusLanguages` using `progressOf`, and
  `askModel` passing `lines` to `usualTargetFor`. In the screens take this
  branch's side, which calls the models.
- **96, written translations.** One conflict in the first merge,
  `screens/checks.tsx`: `./configModel` is `../config/model` now; keep its
  two new imports.

## Part two is done

`screens/` holds the entry files `App.tsx` registers; each concern has a
folder; pure files are `model.ts` or `<thing>Model.ts`; the passage record,
the Map and reference material moved their rules out of their screens as
the others had. Put a new file in its feature's folder, or a new folder
named for what it is about: ESLint (`eslint.config.mjs`) and
`folders.test.ts` say when something is in the wrong place.
