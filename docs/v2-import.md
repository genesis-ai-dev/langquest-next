# Bringing LangQuest v2 into this app, and keeping it coming

Status: accepted, 2026-10-12 (Caleb Koster), decision 94. Caleb chose 1a–4a,
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
  ledger). Only the differences are appended, and only ever added: what
  v2 deletes or turns off is never taken back here (below, Deletes).
  Running a pass twice appends nothing; a pass that dies half way is
  finished by the next.
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
- **Organizations are never named after a person.** One with a single
  project takes the project's name; one with several is "To be named"
  until its admins rename it in the app (Organization › name). Anyone can
  look through organizations, and a translator's name or email there could
  put them in danger (Caleb, 2026-10-13). For the same reason a v2 username
  that is an email address is never copied into Next as someone's name.
- **Transfer** on a card, or **Transfer N projects** on a lane, confirms the
  organization and language and starts the transfer at once. A language need
  not be linked first (Caleb, 2026-10-13): a project nobody linked comes
  over by its name alone, with a code made from it as New language makes
  one, and its admins link it in Next (Language › link, decision 78). A
  suggestion is never linked by itself: **Use** it, or the project comes
  over unlinked. A project that has come over cannot move
  to another organization on the board (its events carry the organization);
  **Sync** reads it again now instead of waiting for the next scheduled pass.
- **Coming over again.** `npm run v2 -- move --project <v2 id> --to <org id>`
  (with `--production` for the hosted projects) brings a project that has
  come over into another organization as a new language there, with a new
  id (decisions.md 94, amended 2026-10-24; Every Language's BIRAT
  RAJBANSHI). The next pass reads it whole into that language, under a
  ledger of its own, and stores its recordings again for it. The first copy
  stays where it was, no longer kept up to date, until it is removed;
  `v2_import.moves` records where it is. Once the new copy is confirmed,
  `npm run v2 -- close --org <org id> --language <language id>` makes the
  first copy inaccessible: the import takes back the memberships it gave
  there (the language's members, and the organization's admins when it
  holds nothing else). Nothing is deleted, and it refuses a copy the import
  still keeps up to date.
- **Language:** a project's details show what is known (its name and
  description, the languages v2 links to it, the languages its recordings
  are tagged with, and the suggestion with its reason) beside a search of
  the language list as New language searches it (`search_languoids`), each
  match with the countries it is spoken in and its family. **Use** links
  it; **Leave unlinked** takes a link back before it comes over. The
  language's name in Next can
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
  in** lists the people from v2 who have signed in to Next; **Same email**
  lists v2 people whose email already has an account in Next (section 3). A card opens its
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
  and password, and signs the phone in (`apps/mobile/src/server/v2.ts`). v2
  has email and password accounts only, so this covers everyone. Every try
  reaches v2 from the same few servers, so after ten wrong passwords for
  one email in an hour the function refuses that email itself, before v2
  starts refusing everyone (`v2_import.sign_in_failures`). It also notes
  which v2 projects they belong to, for Welcome back (section 7). It needs v2's
  publishable key as a function secret (`V2_SUPABASE_ANON_KEY` in
  `.env.<env>`, placed by `npm run secrets`); without it, Sign In simply
  says the password is wrong.
- Someone who already has an account here with the same email signs in as
  usual, and is not given their v2 work by the email alone: Next does not
  confirm emails at sign-up (`enable_confirmations = false`), so anyone
  could make an account with a translator's address before they arrive.
  The dashboard's **Same email** list shows every v2 person whose email has
  an account here under another id, with their v2 projects and when the
  Next account was made; someone on the team who knows it is them presses
  **Same person** (Caleb, 2026-10-14, `v2_import.people_links`). From then
  on the import names that Next account wherever it named the v2 one: their
  memberships and the organizations they run move to it at the next sync
  (which the dashboard starts), and so does their work from then on. Work
  already brought over keeps its v2 author, under the same name. **Undo**
  moves it all back. A "Bring my LangQuest work" in Settings, where the
  person proves it with their v2 password, can come later.
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
| profile_project_link | `MemberAdded` at the language's scope. Leaving the v2 project does not remove them here; **Leave out** on the dashboard does (`MemberRemoved`) |
| Bible or FIA project (`template`) | `TemplateSelected` of LangQuest's Bible by chapters or FIA's passages, for the books it has |
| FIA project | FIA's study guides in the language its team reads (its v2 source language), else English: the organization follows `langquest.fia.<code>` and the language is offered it (`ReferenceSet` recommended), as New language does. v2 kept no FIA content of its own; its app read FIA's |
| chapter or FIA passage quest | that passage of the template (`bible.book/chapter`, `fia.bookId/pericopeId/verseRange`) |
| other quests | units of their own: a quest with quests under it is a book or section, one that holds recordings is a passage |
| the team's recordings in a quest (assets in the project's language, in `order_index` order) | one recording of the passage: `RecordingAdded` per asset with a card per audio segment, `CardVerseSet` from the asset's verse (a join when it has the same verses as the asset above it, decision 82), a `TakeComposed` of them all, and `TakeSubmitted`. When v2's set changes (a publish), a new take whose parent is the last: a new version |
| a second quest for the same chapter (`versionLabel` "#2") | another line of versions on the same passage |
| source material (assets in another language, older projects) | the passage's source material (`MaterialDefined`, a field per text and audio), as the first import did; each translation of one then is a version of its own passage |
| translation child of a recording (back translation), transcription, and text with no audio | **left in v2 for now** (Caleb, 2026-10-13): v2 has 99 of them in 31 projects, half of them tests. Counted in each pass's report and log, and their audio is not stored. Turned on (`writtenWork` in `map.ts`), a back translation is a Back Translation review with its audio and the rest notes, until written translations exist (`writtenFact` is the one place to change) |
| vote | a Community Check review of the version that holds the asset: one per person per version, "needs changes" if any of their votes is down, with their comments |
| tags, invites, join requests, notifications, closures, clone maps | not brought over; counted in each pass's report |
| blocked_users | `user_blocks` rows, so a block someone made still holds |

A version waits until every file in it has reached v2's bucket (v2 stamps
`audio_uploaded_at`), so a half-uploaded publish does not become a version;
seven days after v2's server got its rows (`uploaded_at`, the server's
clock, not the phone's `created_at`), it comes over with what has arrived,
and the report lists the rest. A phone offline for weeks sends rows recorded
weeks ago, so a wait counted from the recording was over before it began.

## 5. Keeping up with v2

- **Which projects to read.** Each pass asks v2 which confirmed projects
  have rows inserted or changed since the last pass started, minus a day
  (v2's `uploaded_at` is the server's clock but only set on insert;
  `last_updated` is the phone's), or audio that arrived. Those projects are
  read whole and reconciled. Once a night every confirmed project is read
  whole anyway: that catches server-side changes that leave no timestamp
  and rows that were deleted outright.
- **Deletes.** Nothing v2 deletes or turns off is taken back here (Caleb,
  2026-10-14: "the point of an event log is that nothing disappears"). A
  unit stays, a member stays on the language, and a recording, review or
  note stays. What a removal changes is what comes next: a publish in v2
  without a recording becomes a new version without it, and the earlier
  version stays in its history. Only the dashboard's own decisions are
  taken back: Leave out removes a member, a link moves a membership to the
  person's Next account (section 3), dropping an organization admin removes
  them, and a team whose reading language changes is offered the other
  FIA guides instead. Something deleted in v2 before it ever came over is
  not brought over.
- **Audio.** Each file is downloaded once, hashed, and put in R2 through the
  Worker (`PUT /api/blobs/…`, which appends `BlobStored`), as the first
  import did. `v2_import.files` remembers each v2 file name's hash, size,
  duration and format, so later passes and cloned projects (which share
  file names) never download it again. A file v2 does not have is asked
  for on every pass for its first hour, since a phone's upload can trail
  its rows, then only by the whole read or a transfer someone starts, for
  a week (decisions.md 94). Once v2 says it has the file after that
  (`audio_uploaded_at` later than the miss), it is asked for again: on the
  pass that sees it arrive, and by every whole read until it is copied.
- **Audio phones may not play.** v2 took any file a team uploaded, and
  some Every Language teams uploaded whole chapters as MP3 (573 files in
  33 projects on 2026-10-23, 16 of them WebM). A recording here is
  WAV or M4A (decisions.md 58), so the import converts such a file with
  ffmpeg (`server/audioConvert.ts`; the job image has it): AAC in M4A,
  mono, at a phone's 128 kb/s or the source's rate when lower, and lower
  still if that is what keeps it under the Worker's 50 MB. The file map
  keeps the M4A's hash, size and length. ffmpeg's output is bit-exact, so
  a cloned project's copy converts to the same hash; one that comes out
  different (a newer ffmpeg) is not stored for that language and the log
  says so. Where there is no ffmpeg (a laptop without it), such a file is
  left unrecorded for a run that has it, and a file in v2's storage that
  is not audio is reported as unreadable rather than missing.
- **Where it runs.** The dashboard runs a transfer on the computer it is
  open on; `npm run v2 -- sync` does one pass from the command line; and
  the job container behind the app's Worker runs a pass every 15
  minutes and a whole read at 03:15 UTC against production (decisions.md
  94, 141; `docs/server-jobs.md`), while the Worker's var
  `V2_IMPORT_ENABLED` is "true" (Caleb's go-ahead, given 2026-10-14) and
  v2's key is a Worker secret (`npm run secrets`); it refuses to start
  without it. v2's read-only login, when `.env.production` has it, goes
  there too and names people.
  All three write the same progress and log. A pass that stops is finished
  by the next, and a whole read stopped within a day resumes, skipping the
  projects read since it began (decisions.md 94). The job's logs name
  projects by id only, as CI's did.
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

The first time someone signs in with a v2 account they land on **Welcome
back** (`welcome_back`, `apps/mobile/src/screens/onboarding.tsx`), never on
the plain welcome or "What brings you here?":

1. When `v2-sign-in` makes their account it reads, as them, the projects
   they belong to in v2 and keeps that list (`v2_import.arrivals`).
2. The app asks `v2_welcome()`, the one `v2_import` function a phone may
   call, which answers for the person signed in: each of those projects
   that has come over and that they can open here (the language, its
   organization, the project's v2 name, what they recorded in it and the
   passage they recorded last), and each one still on its way. A project
   the board leaves out (Not coming over) is not mentioned. The answer is
   kept on the phone (`useWelcomeBack.ts`).
3. Work here: one card per language, "Record here from now on" (work they
   record in the old app still comes here; work they record here does not
   go back), a collapsed "What's different", and Keep going, which opens
   what is waiting for them first, else the passage they recorded last.
4. Nothing here yet: their projects show as on their way, "Keep recording
   in the old app until it's here", and Check again. When one arrives, its
   organization opens and the screen says it is here.

Someone whose v2 projects all stay behind gets the ordinary welcome. Leaving
Welcome back (Keep going or Go to My Work) marks them welcomed, as Welcome
does; until then it is what they see on opening the app.

## 8. What a pass reports

Per project: rows read, events appended by type, facts withdrawn, files
copied and how many of them were converted to M4A, files missing in v2,
files v2 has that are not audio, files left for a run with ffmpeg, versions
waiting for audio, and what was left
out (tags, text without audio if not imported, and so on). The board shows
the last pass per project.

## 9. Going live

In order; each step is safe to stop after.

1. **Merge the PR.** Merging deploys the `v2_import` tables and the
   `v2-sign-in` function (decision 42) and ships Sign In's fallback to
   testers. Until step 3, signing in with a v2 account just says the
   password is wrong, and nothing is transferred.
2. **Names (optional, once):** `scripts/v2-access.sh` adds `v2_reader` to
   v2's production database, a login that may read each person's id,
   username and email and nothing else, and keeps its address encrypted in
   `.env.production`; `npm run secrets -- production` puts it on the
   app's Worker. The scheduled sync needs it to name people. The
   dashboard shows each project's people with their usernames and emails
   through it, or else through the Supabase CLI you are logged in with
   (read only, on your machine); with neither, people show by id until
   they sign in.
3. **Keys and the switch:** `npm run env:update -- production
   V2_SUPABASE_ANON_KEY` (v2's publishable key), then
   `npm run secrets -- production`, which puts it in the Edge Function and
   on the app's Worker. The scheduled sync runs while the Worker's var
   `V2_IMPORT_ENABLED` in `apps/web/wrangler.jsonc` is "true" (decision
   141); until 2026-10-19 the switch and keys were GitHub's, set by
   `scripts/v2-go-live.sh`, now gone.
4. **Place and transfer:** `npm run v2 -- board --production`. Drag
   projects into organizations, choose the languages the suggestions are
   not sure of, and press Transfer; or confirm them and let the scheduled
   sync copy them, which is faster for the big ones.
5. **Tell people:** once a project shows "In Next", its people sign in to
   Next with their LangQuest email and password.
