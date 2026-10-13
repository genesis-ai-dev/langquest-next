# Bringing LangQuest v2 into this app, and keeping it coming

Status: accepted, 2026-10-12 (Caleb Koster), decision 93. Caleb chose 1a–4a,
6a and 7a; written work (5) waits on written translations in Next.

LangQuest v2 keeps running while people move to this app. Everything a v2
project holds comes over once, and whatever v2 users add afterwards keeps
arriving here, until v2 is switched off. Nothing goes back: this app never
writes to v2 (one way, Caleb, 2026-10-12).

## 1. The shape of it

```
  v2 (Postgres, read only)                       this app
  ───────────────────────                        ────────────────────────────────
  project, quest, asset,   ── read ──►  mapper ──► "what v2 says now"
  asset_content_link,                  (pure)       │
  quest_asset_link, vote,                           ▼
  profile_project_link,                        reconcile against what the
  project_language_link                        import already said (ledger)
                                                    │
  bucket "assets" ─── copy by hash ──► R2           ▼
                     (through the Worker)      append_events (service role)
```

- **One package, nothing else touched.** `packages/v2-import` holds every
  line that knows v2: its row types, the reader, the mapper, the reconciler
  and the runner. The phone and the server never import it, and the app's
  event catalog does not change: v2's work arrives as ordinary events, so
  phones, reports and the Worker need nothing new. When v2 is switched off,
  the package, its migration's schema and its scheduled job are deleted
  together.
- **The import says what v2 says now, not what changed.** v2's
  `last_updated` is set by phones and can be days old when the row arrives;
  server jobs change rows without touching it; and some rows are deleted
  outright (section 5). So each pass reads every row of each project that
  may have changed, maps it to the events that would say the same thing
  here, and compares that with what the import has already appended (the
  ledger). Only the differences are appended. Running a pass twice appends
  nothing; a pass that dies half way is finished by the next.
- **Event ids are the import's own** (`v2:` is a server prefix people
  cannot use, decision 75): `v2:<v2 project>:<fact>#<n>`, where the fact is
  what the event says ("member:<person>", "take:<quest>") and `n` counts the
  times the import has said it. Clocks come from v2's timestamps, never
  earlier than the import's last word on the same fact, so a later change in
  v2 always wins over an earlier one, and anything a person does here after
  that wins over both.

## 2. Organizations, and the transfer dashboard

v2 has projects and no organizations. Each v2 project becomes one language
(its id is the v2 project id), in an organization the team chooses on the
transfer dashboard, a page that runs on a team member's own computer
(`npm run v2 -- board`, Caleb 2026-10-12): it reads v2, and keeps the plan
and every transfer's progress and log in this app's database, so everyone
who opens it sees the same thing.

- **Organizations are lanes, projects are cards.** Drag a card to another
  lane, or onto the last lane to start a new organization. A card shows the
  project's size, its language (chosen, or the suggestion from
  `docs/v2-project-languages.csv` with its confidence), how many of its
  people have signed in to Next, and where its transfer stands.
- **Where projects start:** every project with the Every Language platform
  account (`platform@everylanguage.com`, v2 id `03babbbd-…`) is in **Every
  Language**, run by that account; every other project is with its owner's
  other projects (the owner runs that organization); projects named "Test"
  and the like, with nothing to say what language they are, and projects
  nobody owns, start under **Not coming over**.
- **Transfer** on a card, or **Transfer N projects** on a lane, confirms the
  organization and language and starts the transfer at once; a project with
  no sure language waits for one. A project that has come over cannot move
  to another organization (its events carry the organization); **Sync**
  reads it again now instead of waiting for the next scheduled pass.
- **Language:** a project's details show what is known (its name and
  description, the languages v2 links to it, the languages its recordings
  are tagged with, and the suggestion with its reason) beside a search of
  the language list as New language searches it (`search_languoids`), each
  match with the countries it is spoken in and its family. **Use** links
  it; a language not in the list comes over unlinked, with a code, and is
  linked in Next later (decision 78). The language's name in Next can
  differ from the project's ("Berom", not "BEROM FAN EL NIGERIA").
- **Roles:** each person in a project has a role picker: from their v2 work
  (owners become language admins, others translators or reviewers by what
  they did), Organization admin (runs the whole organization), Language
  admin, Coordinator, Translator, Reviewer, Viewer, or Leave out (Caleb,
  2026-10-13: "we need freedom in this"). Organization admins also show on
  the organization's lane, where one can be taken off. A change to a
  project that has come over applies at its next sync.
- **Status:** each card says Ready, Waiting its turn, Reading v2, Copying
  audio 340 of 1,200, Storing audio, Adding to Next, In Next · 3 min ago,
  or its issues (refused changes, audio missing from v2, recordings waiting
  for their audio, quests that did not match the Bible). The header counts
  projects in Next, transfers running, projects with issues, and people
  from v2 who have signed in.
- **Activity** is the running log of every transfer, newest first; **Signed
  in** lists the people from v2 who have signed in to Next. A card opens its
  details: the people and whether each has signed in, its issues, and its
  own log.

The plan is in `v2_import.orgs`, `v2_import.placements` and
`v2_import.roles`; transfers are
`v2_import.passes` (progress while running) and `v2_import.log` (section 6).

## 3. People

A v2 account and the v3 account it becomes have **the same id**. Imported
events name v2 profile ids as their actors and members, so when that person
signs in here everything they did is already theirs.

- Sign In is unchanged. When this app turns an email and password down,
  the app asks the `v2-sign-in` Edge Function, which checks them with v2's
  own sign-in once (as the old app would) and signs that v2 session straight
  out again, then makes this app's account with the v2 id, the same email
  and password, and signs the phone in (`apps/mobile/src/v2SignIn.ts`). v2
  has email and password accounts only, so this covers everyone. Every try
  reaches v2 from the same few servers, so after ten wrong passwords for
  one email in an hour the function refuses that email itself, before v2
  starts refusing everyone (`v2_import.sign_in_failures`). It needs v2's
  publishable key as a function secret (`V2_SUPABASE_ANON_KEY` in
  `.env.<env>`, placed by `npm run secrets`); without it, Sign In simply
  says the password is wrong.
- Someone who already has an account here with the same email signs in as
  usual; Settings, "Bring my LangQuest work" checks their v2 sign-in and
  adds them where their v2 self is a member. Their v2 work still shows
  under their v2 name, which is theirs too.
- Names: the import writes `profiles.display_name` from v2's `username`
  for every v2 person it names, so work shows who did it before they come.
- Roles: v2 has owner and member. An owner becomes an Organization Admin
  of that language only; a member who recorded is a Translator, one who
  voted a Reviewer, one who did both a Coordinator, as the first import
  already did. v2 lets people who are not members record and vote on open
  projects; they come over as members with the role their work amounts to.
  An organization's admins are the people named on the dashboard: Every
  Language is run by its platform account (Caleb, 2026-10-12), and an
  organization made for one owner by that owner.

## 4. How v2's work maps

| v2 | here |
| --- | --- |
| project | a language: `LanguageAdded` (name, readable code, source code) and `LanguageCodeSet` with the decided languoid (decision 78), in the organization's stream; `LanguageRenamed` when the v2 name changes |
| project_language_link | the decided language, never v2's (AGENTS.md, `docs/v2-project-languages.md`); a source language becomes `sourceCode` |
| profile_project_link | `MemberAdded` at the language's scope, `MemberRemoved` when it goes inactive |
| Bible or FIA project (`template`) | `TemplateSelected` of LangQuest's Bible by chapters or FIA's passages, for the books it has |
| chapter or FIA passage quest | that passage of the template (`bible.book/chapter`, `fia.bookId/pericopeId/verseRange`) |
| other quests | units of their own: a quest with quests under it is a book or section, one that holds recordings is a passage |
| the team's recordings in a quest (assets in the project's language, in `order_index` order) | one recording of the passage: `RecordingAdded` per asset with a card per audio segment, `CardVerseSet` from the asset's verse, a `TakeComposed` of them all, and `TakeSubmitted`. When v2's set changes (a publish), a new take whose parent is the last: a new version |
| a second quest for the same chapter (`versionLabel` "#2") | another line of versions on the same passage |
| source material (assets in another language, older projects) | the passage's source material (`MaterialDefined`, a field per text and audio), as the first import did; each translation of one then is a version of its own passage |
| translation child of a recording (back translation) | a Back Translation review with its audio (`ReviewRecorded`, kind `bt`, outcome `recorded`) |
| transcription, and text with no audio | a note on the passage (`NoteAdded`), until written translations exist in Next (`writtenFact` in `map.ts` is the one place to change) |
| vote | a Community Check review of the version that holds the asset: one per person per version, "needs changes" if any of their votes is down, with their comments |
| tags, invites, join requests, notifications, closures, clone maps | not brought over; counted in each pass's report |
| blocked_users | `user_blocks` rows, so a block someone made still holds |

A version waits until every file in it has reached v2's bucket (v2 stamps
`audio_uploaded_at`), so a half-uploaded publish does not become a version;
after seven days it comes over with what has arrived, and the report lists
the rest.

## 5. Keeping up with v2

- **Which projects to read.** Each pass asks v2 which confirmed projects
  have rows inserted or changed since the last pass started, minus a day
  (v2's `uploaded_at` is the server's clock but only set on insert;
  `last_updated` is the phone's), or audio that arrived. Those projects are
  read whole and reconciled. Once a night every confirmed project is read
  whole anyway: that catches server-side changes that leave no timestamp
  and rows that were deleted outright.
- **Deletes.** A row that is gone or inactive in v2 is taken back here the
  way this app takes things back: a unit is hidden (`UnitHidden`), a
  membership removed, and a recording, take, review or note redacted
  (`v1.Redacted`, reason "removed in LangQuest v2").
- **Audio.** Each file is downloaded once, hashed, and put in R2 through the
  Worker (`PUT /api/blobs/…`, which appends `BlobStored`), as the first
  import did. `v2_import.files` remembers each v2 file name's hash, size,
  duration and format, so later passes and cloned projects (which share
  file names) never download it again.
- **Where it runs.** The dashboard runs a transfer on the computer it is
  open on; `npm run v2 -- sync` does one pass from the command line; and
  `.github/workflows/v2-import.yml` runs a pass every 15 minutes and a
  whole read every night against production, once Caleb sets the
  repository variable `V2_IMPORT_ENABLED` (and its two secrets), never
  before. All three write the same progress and log. A pass that stops is
  finished by the next. CI logs name projects by id only, since the
  repository is public.
- **How much audio.** Measured on 2026-10-12 from v2's `storage.objects`
  (`metadata->>'size'`): the `assets` bucket holds 808,198 files, 232 GB
  (215 GB WAV, 12 GB m4a, 300 kB on average). Live recordings name
  1,020,047 files, of which 807,199 (231 GB) are in storage; the other
  212,848 were never stored, nearly all in a few Every Language projects
  recorded March to September 2026, and cannot come over unless they turn
  up. The first copy of the big projects should still run where the
  connection is fast (the scheduled workflow); downloads are kept only when
  `V2_IMPORT_CACHE` names a folder.
- **Reading v2.** Its link tables have no project column, and asking
  through a join makes v2 scan them whole and hit its statement timeout, so
  segments, placements and votes are read by slices of the project's own
  quest and asset ids. v2's own totals (`project_closure`) are no longer
  kept, so the dashboard counts each project's assets itself.
- **Trying it.** `npm run v2 -- try --project <id>` maps projects and checks
  every event against the app's rules, writing nothing;
  `V2_IMPORT_FILES_DIR` keeps files in a folder instead of R2, for a whole
  transfer into a local database without the Worker.

## 6. Storage here

A schema of its own, `v2_import`, reachable only by the service role
through `v2_import_*` functions, holding the plan (section 2), the ledger
(one row per fact: its last event id, digest and clock), the file map and
one row per pass. Nothing in `public` changes except `profiles` names and
`user_blocks`, which the import fills like any account would.

## 7. People who come over (demo ADR-043)

The first time someone signs in with a v2 account:

1. **Welcome back.** "Your LangQuest work is here." One card per language
   they worked in (the v2 project's name, its organization, recordings and
   passages), and Keep going, which opens My Work in the language they
   worked in last.
2. A project still waiting on the board shows as "On its way: the
   LangQuest team is moving it", and appears by itself when it arrives.
3. One line on what to expect: work they record in the old app still comes
   here; work they record here does not go back. Nothing else to learn
   first (no intros, decision 71).

## 8. What a pass reports

Per project: rows read, events appended by type, facts withdrawn, files
copied, files missing in v2, versions waiting for audio, and what was left
out (tags, text without audio if not imported, and so on). The board shows
the last pass per project.

## 9. Going live

In order; each step is safe to stop after.

1. **Merge the PR.** Merging deploys the `v2_import` tables and the
   `v2-sign-in` function (decision 42) and ships Sign In's fallback to
   testers. Until step 3, signing in with a v2 account just says the
   password is wrong, and nothing is transferred.
2. **Names (optional, once):** `scripts/v2-access.sh` adds `v2_reader` to
   v2's production database, a login that may read each person's id and
   username and nothing else, and keeps its address encrypted in
   `.env.production`. Without it, people show by id until they sign in.
3. **Keys and the switch:** `npm run env:update -- production
   V2_SUPABASE_ANON_KEY` (v2's publishable key), then
   `scripts/v2-go-live.sh`, which gives the workflow its secrets, puts v2's
   key in the Edge Function (`npm run secrets -- production`) and, when
   asked, sets `V2_IMPORT_ENABLED`.
4. **Place and transfer:** `npm run v2 -- board --production`. Drag
   projects into organizations, choose the languages the suggestions are
   not sure of, and press Transfer; or confirm them and let the scheduled
   sync copy them, which is faster for the big ones.
5. **Tell people:** once a project shows "In Next", its people sign in to
   Next with their LangQuest email and password.
