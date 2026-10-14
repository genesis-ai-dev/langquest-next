# Merging a branch onto the restructure (pull request 116)

For anyone, person or agent, whose branch started before pull request 116
("Separation of concerns") reached `main`. It renamed a package, moved every
Supabase call into one folder, took the sync engine out of React and moved
the large screens' rules into tested models (decisions.md 104, 105). Most
branches merge with git's help alone; this page says where code went when
it does not, and what the tests now hold you to.

Read `AGENTS.md` and decisions 104 and 105 first. Where this page and a
decision disagree, the decision wins.

## The procedure

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

## What the tests now hold

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
  `keyTerms/model.ts`, `reference/materialModel.ts` (`screens/configModel.ts`
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

## Open pull requests, as of 2026-10-14

Each was merged on top of 116 in a dry run (`git merge-tree`).

- **115, big languages open faster.** One conflict, `useLanguage.ts`: it
  drops `saving` so a write still on its way to disk redraws nothing. Port it
  into the session: remove `saving` from `LanguageStatus` and from the
  status `LanguageSession.start()` sets on each publish
  (`client.subscribe((s) => this.set({ revision: s.revision }))`), from
  `NOTHING_YET` and the destructured status in `useLanguage`, and from
  `LanguageHandle`. Its `packages/client/src` changes land in
  `packages/sync/src` by themselves.
- **114, custom divisions.** One conflict from 116, `screens/content.tsx`;
  `docs/decisions.md` conflicts with `main`. The picker's shared templates
  are `pickerLists` in `templates/model.ts` now: give it the language's
  numbering and apply `sharedTemplateShown` there (or filter `choices`
  first). Editor changes belong in `templates/useTemplateEditor.ts`. Its
  decision is 103 in the branch: it becomes 106 (or the first free number),
  with its references.
- **112, spoken review order.** Merges cleanly.
- **97, voice recording.** Nothing from 116; its conflicts
  (`clipPlayer.tsx`, `simple/btWorkspace.tsx`, the decision log) are with
  `main`.
- **96, written translations.** Nothing from 116 (its `App.tsx` change is
  one row in `SCREENS`); its conflicts are with `main`. New code there that
  reads or writes the server goes in `server/`.

## Coming next

Part two of 105 moves folders, after 96 and 97 land: `screens/` keeps only
the entry files `App.tsx` registers; each concern gets a folder (auth,
account, org, sync, audio, web, notifications, ui, shell, and what `simple/`
holds: recording, review, helps, admin, mic); `*Core.ts` files become
`model.ts` or `<thing>Model.ts`. To merge easily then, put new files in a
feature folder now, not in `src/` itself or `simple/`, and name pure files
`model.ts` or `<thing>Model.ts`.
