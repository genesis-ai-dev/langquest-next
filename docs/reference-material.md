# Reference material

Everything a translator consults beside the recorder: Bible text and audio
to read and hear, study guides (FIA and guides an organization writes), and
notes for translators. Decision 59 in `docs/decisions.md` says why it is
shaped this way; the review behind it is the Claude Doc "LangQuest Next:
reference material review and design" (2026-10-05).

## The model

- **Every piece of material is a library document** that says where it
  applies (decision 36): sources (`source@1` with `sourceBook@1` per book),
  verse timings (`timing@1`), guides (`study@1`, `study@2`, `collection@1`)
  and notes (`material@1`, kind `note`, plus the in-app materials of
  decision 26). Shapes and validation: `packages/core/src/libraryDocs.ts`.
- **Three levels decide what is offered** (`packages/core/src/references.ts`):
  the organization recommends library items (`v1.ReferenceRecommended`, org
  partition); a language admin recommends more, hides some, or follows the
  organization (`v1.LaneReferenceRecommended`); translators choose for
  themselves on their device and may explore any Bible online. Every option
  says whether it has audio and whether it can be kept offline.
- **Coordinates place material on passages.** A passage's verse range comes
  from its unit id (`libraryUnitRange`), never its label; material lines up
  through the versification engine, or by template node for outline
  templates. An admin can place an item on one passage by hand or hide a
  match there (`v1.PassageReferenceLinked`).
- **Timings join any text to any recording.** A `timing@1` names the
  recording by SHA-256 and lists each verse's start and end, so any text in
  the same versification can be highlighted against it. Order of preference
  for a chapter: a person's correction, our aligner or FCBH's timestamps as
  stored in the source's book, then FCBH's live `/timestamps`.
- **The record keeps what was used.** Publishing a version and recording a
  review add `v1.ReferencesUsed`: what was offered, and which items were
  opened or played. It is the record, not the work, so it never leaves the
  organization (decision 38).

## Bible Brain

Faith Comes By Hearing's API ([license](https://www.faithcomesbyhearing.com/bible-brain/license),
last modified 4/15/21). What we hold to:

- The key stays on the server (the Worker below); phones never see it.
- Streaming: any fileset the key reaches, free to users.
- Offline: only filesets `/download` returns for our key, kept inside the
  app's cache, never exportable, and purged if FCBH revokes it (the Worker
  reports `offline: false` from then on and the app drops the files).
- Nothing of theirs is kept on our servers. The timing job fetches audio
  through `/download` (filesets that do not allow it are refused), deletes
  it when the job ends, and keeps only the timings, which are our numbers.
- Each fileset's copyright is shown with its text and audio, with the DBP
  terms a tap away.
- Filesets are chosen by testament: many Bibles have New Testament audio
  only, and asking for Genesis from one returns 404.

## The Worker's Bible routes

All `GET`, `Authorization: Bearer <Supabase access token>` (members of any
organization), JSON. `503 {"error"}` when the Worker has no
`BIBLE_BRAIN_ACCESS_KEY`. Implemented in `apps/web/worker/bible.ts`.

| Route | Answer |
| --- | --- |
| `/api/bible/languages?q=fra` | `{ languages: [{ code, name, autonym?, bibles }] }` (ISO 639-3 codes) |
| `/api/bible/bibles?lang=fra` | `{ bibles: [BibleSummary] }` |
| `/api/bible/bibles/:bibleId` | `{ bible: BibleDetail }` |
| `/api/bible/text/:filesetId/:book/:chapter` | `{ verses: [[verseStart, verseEnd, text], …] }` |
| `/api/bible/audio/:filesetId/:book/:chapter` | `{ url, durationMs?, bytes?, expiresAt, offline }` (a signed MP3 link without the key; through `/download` when `offline`) |
| `/api/bible/timestamps/:filesetId/:book/:chapter` | `{ rows: [{ verse, seconds }] }`, 404 when FCBH has none |

```ts
type Testaments = { OT?: string; NT?: string };            // fileset ids
interface BibleSummary {
  bibleId: string; name: string; abbreviation: string; language: string; languageName: string;
  text: Testaments; audio: Testaments;                    // text_plain and non-drama MP3 audio preferred
  timestamps: { OT: boolean; NT: boolean };               // FCBH has timings for that audio
}
interface BibleDetail extends BibleSummary {
  books: { book: string; name: string; chapters: number; testament: 'OT' | 'NT' }[];
  copyright: { text?: string; audio?: string };
  offline: { text: boolean; audio: boolean };             // /download allowed for our key
}
```

## Timing jobs

`request_timings` (an admin with Manage Reference) queues one source's audio
for some books; `timing_jobs_for` lists them with progress. fia-align's
`worker` (genesis-ai-dev/fia) claims a job (`timing_job_claim`), reports
progress and finishes with `timing@1` documents (`timing_job_finish`), each
with `check.ok` from its proportion test. An admin's app then publishes the
passing ones (`timing_job_results`): each becomes a `timing@1` in the
library, its book's `sourceBook@1` gets the hash, and the source item gets a
new version, so subscribers follow it like any other update.

## Guide editor

Write a guide (`guide_editor`, reached from Reference Material, or from a
study guide's Edit for the organization's own and Copy to adapt for FIA's
and other organizations') makes `study@2` documents with everything FIA's
material has. Web first; on a phone it edits text and records step audio.

- **Draft.** A pure reducer (`src/guides/draft.ts`) over details, steps,
  media and glossary, saved on the device as it changes (`draftStore.ts`),
  one draft per guide per device. One person edits a guide at a time: two
  drafts never merge, and the later publish is simply the next version.
- **Methods.** A new guide starts from FIA's six steps (the same ids,
  phases and purposes as `scripts/fia-adapter.ts`), one empty step, or the
  steps of a guide the organization already has.
- **Text.** Markdown with a toolbar: bold, list, a callout of each kind in
  `CALLOUT_KINDS` (`> [!kind] text`), and links to pictures, maps and terms
  by ref (`[the well](#m1)`). The preview is the step screen's own
  rendering (`study/ui.tsx` `SectionBody`). Unknown callout words read as
  `action`, so FIA's localized `[! kitendo]` still reads as "Stop here".
- **Files.** Audio is recorded with the app's recorder or uploaded (web);
  pictures, maps and films are uploaded on the web. Everything is kept in
  the blob store by SHA-256, as recordings are. Pictures get a phone copy
  made in the browser (canvas, 500px longest side, JPEG) as `lowHash`;
  films have no phone copy yet. Publishing uploads the files to
  `<org>/_org/<hash>.<ext>` in the blobs bucket, then publishes the version.
  Readers fetch a missing file from there once and keep it.
- **License.** A new guide takes the organization's license. Adapting FIA
  keeps FIA's credit and CC BY-SA 4.0, which cannot be changed
  (share-alike); a source that forbids adapting cannot be published.
- **Publishing** needs Manage Reference; core `validateDoc` runs first and
  any problem is said in plain words with a link to where to fix it.

## Where the code is

| Part | Where |
| --- | --- |
| Formats, events, derivations | `packages/core/src/libraryDocs.ts`, `references.ts` |
| SQL | `supabase/migrations/20261005200000_reference_material.sql` |
| Bible Brain routes | `apps/web/worker/bible.ts` |
| Reader, sources, explore, record of use | `apps/mobile/src/sources/` |
| Admin: recommendations, coverage, passage links, timings | `apps/mobile/src/screens/config.tsx`, `apps/mobile/src/reference/` |
| Guide editor | `apps/mobile/src/guides/`; reading `study@2` in `apps/mobile/src/study/` |
| Seeding LangQuest's sources | `scripts/library-seed.ts`, `scripts/sources-seed.ts` |
