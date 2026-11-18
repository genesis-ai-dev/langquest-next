# 188. The access-token API gives the server's time of arrival as `uploadedAt`, read from the database's own stamp on each event and file, and LangQuest v2's as `v2UploadedAt`

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-29, thread "Give partners server upload times via
API") said partners need the time LangQuest's server received the content
and the recording files, through the API. Every time the API gave was a
phone's clock (`submittedAt`, a review's `at`, `askedAt`, `updatedAt`), so a
phone that was offline for a week showed last week. The server already had
the times: the database stamps every event as it is appended
(`public.events.received_at`, default `now()`, never overwritten, and the
log refuses UPDATE), and every stored file has a `v1.BlobStored` that only
the server appends, on its own clock (69). Nothing needed backfilling: both
hold for everything since the databases were reset (63). Decided:
- **`uploadedAt` beside the phone's time** on `version` and `versions`
  (the first publish of the take to arrive), `reviews`, `requests` and
  `releases`, from `received_times` (migration
  `20261029160000_received_times.sql`, service role only). It reads one
  stream's rows through the indexes the log has: `events_type_idx` for a
  take's `v1.TakeSubmitted`, `events_entity_idx` for a review or request,
  the id for a release. No index is added, since one would lock the log
  while it builds (161).
- **A file's `uploadedAt`** on `audio`, `approvedAudio` and a review's
  `voiceNotes` is its `v1.BlobStored`, already in the language's records,
  so files cost no lookup. It is null while the server holds no good copy,
  which is honest about a version published before its parts finished
  uploading.
- **Asked once a page and remembered.** `apps/web/worker/agent/view.ts`
  builds each item with `uploadedAt: null` and stamps the page with one
  question (`Receipts`). The organization's object keeps the answers
  (`RECEIPTS_KEPT` in `agent/org.ts`): a stamp never changes, so a partner
  reading the same passages again costs the database nothing. A failed
  lookup fails a read (502, try again) rather than answer null, and a
  write's read-back answers `passage: null` rather than an error a client
  would retry.
- **Not in core.** The stamp stays out of the fold: a phone's pending
  event has none, and one event carrying two values would break the
  fold's idempotence and order-independence (PLAN.md section 4).
- **v2's own server time too, as `v2UploadedAt`.** Caleb, the same day:
  "the time that content was uploaded to the v2 db shouldn't be lost, but
  we should also capture when info was brought into next ... This is for
  billing purposes so the partners know how much to pay their
  translators." For work the import brought over, `uploadedAt` is when
  the import appended it, and v2's `created_at`, which becomes
  `submittedAt`, is a phone's. v2's server stamped each segment and vote
  as it arrived (`uploaded_at`) and each segment's audio
  (`audio_uploaded_at`). The import keeps those stamps in
  `v2_import.stamps`, by language and by the key the API asks, before it
  appends the events they are about, and again when they change
  (`Fact.stamps` and the ledger's `stamped` in
  `packages/v2-import/src/reconcile.ts`). The first whole read after this
  merges (03:15 UTC) keeps them for work that came over before. They stay
  beside the log, not in it: they are v2's record, not something anyone
  did here, and a pass may correct one. Retiring the import, which drops
  the `v2_import` schema (94), must keep this table. The API gives `v2UploadedAt` on a file (when v2
  had its audio), a review (its newest vote's stamp) and a version (the
  newest stamp on its parts' segments and audio: when v2 had all of it),
  and null for work made in Next or where v2 has no stamp. The Worker asks
  for them only for work the import made (its clock names the import's
  device) and asks again after a while for one not kept yet
  (`V2_RECHECK_MS` in `agent/org.ts`).
Rejected: R2's own object dates, since an upload is an idempotent overwrite
(a phone's retry moves it) and the copy into R2 on 2026-10-07 reset them;
a `receivedSince` filter on the passage list, which the change feed (101)
already answers in the order LangQuest received things; and v2's stamps in
the log as a new event type, which every phone would fold for a value only
partners read.
Reverse if: a language's `v1.TakeSubmitted` scan shows in the database's
statement times (then a partial index on the take id, built concurrently);
or partners need the stamp in the change feed or webhooks too.

Amended (2026-11-12, Caleb Koster): each audio file and version also says
how it was made, as `origin`. Every Language pays recording teams per
chapter by when the audio arrived, and its staff also upload archives
recorded before LangQuest. They told the two apart by the v2 asset's name,
which the API does not give and which goes away with v2 (Every Language,
2026-11-12; Caleb: "add the origin field"). The import knows a recording
by the name v2's app gives it, a UUID (`recordedInApp` in
`packages/v2-import/src/rows.ts`); no version of the app names a recording
any other way, except old iPhone builds' `recording-<UUID>`. Every other
name is a file someone uploaded: v2's website names its uploads from the
time (`<milliseconds>-…`, four shapes from four screens), and names under
`content/` come from no v2 code. On v2 production that day, 1,096,018 of
1,228,354 names were recordings. The asset's name is not used, since
people choose it. For a file that is not
a recording the import keeps one more stamp, `upload:<hash>` (when v2 got
it), in `v2_import.stamps` beside the others: no migration and no event,
and the first whole read after this merges marks the uploads that came
over before. The API gives `origin` on `audio`, `approvedAudio`, `version`
and `versions`: `app_recording`, `web_upload`, or on a version `mixed`,
since the import makes one version of a chapter from every recording in
it. Next takes no uploaded audio yet, so its own work is `app_recording`;
an upload added to Next later marks its own parts. Rejected: a yes-or-no
on the version, which cannot say `mixed`; and a list of the website's
name shapes, which already missed two of its four screens and would miss
the next one, where the app's own shape has held since 2025-10-13.
