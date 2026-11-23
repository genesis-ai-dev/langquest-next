# The v2 import's 15-minute pass asks the log what is stored, not R2

Date: 2026-11-23 · By: Caleb Koster · Status: accepted

Reason: the ops dashboard showed 5,524,967 R2 class A operations in
November by the 23rd, against 1,000,000 a month in the plan, about $20 so
far. Class A is writes and lists. The Worker's request count (diag.jobs
`worker_requests`) showed about 5,000 uploads a day, and about 165,000
GET `/api/blobs` a day, nearly all of them lists: each hour's count
followed the v2 import's passes in that hour, and Workers Logs showed the
lists, page after page, under Every Language's prefix. Each pass of a
project listed its language's whole folder in R2 twice (`stored`, once to
copy and once to upload), and the three biggest Every Language languages
(70,000 to 89,000 files) pass on almost every 15-minute run, 76 a day,
because their teams still work in v2.

Decision:

- A 15-minute pass asks the database which of the language's files are
  not stored yet (`v2_import_unstored`, migration
  `20261123235000_v2_import_unstored.sql`). A file is stored when the
  language's log has its `v1.BlobStored`, whose id names the hash and
  size, so each file is one look-up by primary key; 5,000 files took under
  2 s on production. The answer is the few files missing, not every name.
- The nightly whole read, and a transfer someone starts, still list R2:
  only R2 itself shows a file the log holds as stored that R2 lost, and
  the import puts that file back. Once a project now, not twice.
- An invalidation (`v1.BlobInvalidated`, none on production) is not looked
  at by the 15-minute pass; the whole read finds the removed file missing
  from R2, as before.

Consequences: lists fall from about 165,000 a day to about 3,000 (the
whole read), and class A to about 250,000 a month, inside the plan. A file
lost from R2 waits until the night's whole read, not the next 15 minutes.
The database answers up to 18 more calls a pass for the biggest languages
(5,000 files a call), about 2 s of work in all.

Reverse if: the nightly reconciler finds files missing from R2 that the
log holds as stored often enough that a day's wait for the whole read
loses work, or the v2 import stops (then the question goes with it).
