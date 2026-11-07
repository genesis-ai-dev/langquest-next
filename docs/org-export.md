# The organization export

An organization admin can take everything the organization holds out of
LangQuest as one zip, without the app, an engineer or a request to us
(LAN-227, decisions.md 205). This page is the format: partners may rely on it.
The format version is in `README.txt` and `manifest.json` (`format`), now `1`.
A version-1 file keeps its meaning: columns may be added at the end of a
sheet, never renamed, removed or reordered, without a new version.

## Asking for it

In the web app, on the organization's home, **Export all data** (only the
organization's admin, the Organization Admin role, sees it). Choose the whole
organization or some languages, then **Make the zip**. A job on the server
builds it; the sheet shows how far it is and a **Download** when it is ready.
Close the page and come back: the zip waits for 7 days, then is deleted. One
export is made at a time. The download link works for an hour; ask again by
opening the sheet. The phone does not offer it.

## What is in the zip

```text
README.txt
manifest.csv, manifest.json            one row per audio file
<language> (<code>)/
  <NN book>/Chapter NN/<passage>/      the audio, named so a person can read it
  Key terms/                           voice notes on key terms
spreadsheets/
  languages.csv  books.csv  people.csv  activity-by-month.csv  ledger-by-passage.csv
metadata/
  passages.csv  reviews.csv  notes.csv  key-terms.csv  missing-files.csv
events/<stream>/0001.jsonl ...         the raw log
```

Every CSV is UTF-8 with a byte-order mark and CRLF line ends, so Excel and
Google Sheets open it cleanly. A cell that a spreadsheet would run as a
formula (starting `=`, `+`, `-`, `@`) is prefixed with `'`. Times are ISO 8601
in UTC. Booleans are `yes` and `no`.

### Audio

Each recording is a standard audio file, `.m4a` (AAC in MP4) or `.wav`, as it
was recorded. A file is named `<passage> - v<version> part <NN> - <recorder> -
<date> - <first 8 of its hash>.<ext>`. Voice notes (a review's comment, a
response to suggestions, a note, a reason for setting a step aside, a request's
note) sit in the same passage folder beside the version they belong to:
`<passage> - v<version> review <kind> - <person> - <date> - <hash>.m4a`. A
part that several versions share is written once, in the folder of the first
version that has it; every manifest row says where (`file`). Folder names are
the book as the language names it, prefixed by its place in the canon so they
sort in Bible order; names are cleaned of characters a file system refuses.
Files the server no longer has are listed in `metadata/missing-files.csv`
rather than stopping the export.

### manifest.csv and manifest.json

One row per audio file, including voice notes. `manifest.json` is
`{format, orgId, exportedAt, rows}` with the same rows.

| Column | Meaning |
| --- | --- |
| `kind` | `recording`, `review_comment`, `review_artifact`, `response`, `departure_reason`, `note`, `request_note`, `term_note` |
| `language`, `languageCode`, `languageId` | the language as the organization names it, its code, its id |
| `book`, `chapter`, `passage`, `unitId` | where it belongs; `passage` is the reference as people say it |
| `version` | the version's number, 0 for what belongs to the passage and no version |
| `part` | the part's place in the version, from 1; a version's parts in order are its cards in order |
| `takeId` | the version's id in the log |
| `verseFrom`, `verseTo`, `verseMark` | the verses a part was labelled with when someone set them (`set`); `next` and `join` mean the part follows or repeats the one above; `none` means unlabelled |
| `by`, `byId` | who recorded or wrote it, and their profile id |
| `at` | when it was recorded or written |
| `durationMs` | length in milliseconds, for recordings |
| `hash`, `format`, `size`, `stored` | the SHA-256 the log names the file by, its format, its size in bytes where the server confirmed it, and whether it did |
| `current` | the version is the passage's newest: the current take |
| `approved` | every step of the language's review flow cleared this version |
| `reviewsPassed` | the kinds of review whose latest check of this version looks good |
| `outcome`, `text` | for a review row, its outcome and comment; for a note or reason, its text |
| `file` | the file's path in the zip |

### Spreadsheets

- `languages.csv`: per language, passages, recorded, in review, with feedback,
  done; shares in percent; verse-weighted coverage of the Bible, recorded and
  done; recordings on the server; last activity. The figures are the web
  dashboard's.
- `books.csv`: per language and book, passages, recorded, done, shares.
- `people.csv`: everyone with a role or any work: roles and their scope, the
  languages they work in, versions published, parts recorded, time recorded,
  reviews given, first and last activity.
- `activity-by-month.csv`: per month, language and person: versions
  published, parts recorded, time recorded, reviews given.
- `ledger-by-passage.csv`: per passage: state, versions, the current
  version's parts and length, reviews, first and last publishing, the approved
  version.

### Metadata

`passages.csv` (state; current and approved version; the current version's
parts in order, by the first 8 characters of each hash), `reviews.csv`,
`notes.csv` (with what each anchors to), `key-terms.csv` (term, gloss,
renderings, the passages it applies to, linked versions) and
`missing-files.csv`.

### The raw log

`events/<stream>/NNNN.jsonl` holds every event of the organization's stream
(`_org`: roles, members, languages, library) and of each exported language's
stream, in order, one JSON object per line, as the server holds them
(`packages/core/src/events.ts`), 20,000 events a file. Another tool can rebuild
the history exactly by applying them in order; the folders and sheets are a
reading of the same events. People's own streams are not included.

## Who may

Only an organization admin (Manage roles at organization scope), and only for
the organization's own languages. The Worker checks it on every call; the job
reads only the request's organization. A request is a private row
(`org_exports`), not an event, and carries who asked and when.

## Where it runs

`server/orgExport.ts` in the job container (`docs/server-jobs.md`), started by
the request. It folds each language, reads each file from R2 by hash through
the Worker, and writes the zip in 32 MiB parts to R2 through
`/api/org-exports/:id/upload`. `packages/sync/src/orgExport.ts` decides what
goes where and is pure; `server/orgExportJob.ts` and `server/orgExportZip.ts`
write it. Zip64 is used past 4 GB or 65,535 files, and no one file may pass
4 GB.

## Tests

`packages/sync/test/orgExport.test.ts` exports a fixture organization and checks
the manifest against its event log: every audio hash the log names is in it and
nothing else is. `apps/web/test/orgExports.test.ts` unzips the job's output with
`unzip -t`, and checks who may ask and that links expire.
