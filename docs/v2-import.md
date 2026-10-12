# Bringing LangQuest v2 into this app, and keeping it coming

Status: proposal, 2026-10-12 (Caleb Koster). The choices marked **(asked)**
wait on Caleb's answers; the rest is the design they plug into.

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

## 2. Organizations: the board **(asked: where it lives)**

v2 has projects and no organizations. Each v2 project becomes one language
(its id is the v2 project id), in an organization the team chooses on a
board:

- Columns are organizations; cards are v2 projects, showing their name,
  language (decided, or the recommendation from
  `docs/v2-project-languages.csv` with its confidence), size, members and
  last activity.
- The starting layout, before anyone moves a card: every project with a
  member whose v2 email is `platform@everylanguage.com` is in **Every
  Language**; every other project is with its owner's other projects
  **(asked)**; projects named "Test" and the like with nothing to go on are
  in **Don't bring over (asked)**.
- Dragging a card moves it. A project comes over once its organization and
  its language are confirmed **(asked)**, and keeps syncing after that.
- Moving a project after it has come over is refused by the board: a
  language cannot change organization here (its events carry the org), so
  that would be a second copy. The board says so and offers "bring it over
  again into …", which hides the first.

The plan is three small tables in the `v2_import` schema (section 6):
`v2_import.orgs`, `v2_import.placements` (project → org, language,
confirmed by whom and when) and `v2_import.people` (who runs each org).

## 3. People **(asked)**

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
  projects; they come over as members with the role their work amounts to. The organization's admins are the people named on the board
  (Every Language: **asked**); an organization made for one owner has that
  owner as its admin.

## 4. How v2's work maps **(asked: Bible and FIA projects)**

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
| transcription, and text with no audio | a note on the passage (`NoteAdded`) **(asked)** |
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
- **Where it runs.** `npm run v2 -- sync` does one pass; a scheduled GitHub
  workflow runs it every 15 minutes against production once Caleb turns it
  on (a repository variable), and never before. The first pass of a big
  project is long but resumable. Logs print counts and ids only, since the
  repository is public.

## 6. Storage here

A schema of its own, `v2_import`, reachable only by the service role
through `v2_import_*` functions, holding the plan (section 2), the ledger
(one row per fact: its last event id, digest and clock), the file map and
one row per pass. Nothing in `public` changes except `profiles` names and
`user_blocks`, which the import fills like any account would.

## 7. People who come over **(screens go to the demo first)**

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
