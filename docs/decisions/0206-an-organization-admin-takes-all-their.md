# 206. An organization admin takes all their data out as one zip made by a server job, in a fixed documented format

Date: 2026-11-07 · By: Caleb Koster · Status: accepted

Reason: LAN-227 (asked for by Ryder): an organization must know everything it
put into LangQuest can leave with it, whole and usable, without asking us.
The access-token API (70) reads one passage at a time and cannot hand out a
whole organization; the reports' CSVs hold counts, not recordings. So an
organization admin (organization-scope Manage roles, the Organization Admin
role and no other) asks for **Export all data** in the web app, on the
organization's home, for the whole organization or some of its languages.
Where it runs: a job in the job container (`org-export`, `server/orgExport.ts`,
decision 141), not the organization's Durable Object. The object has a 128 MB
isolate and a request's time limit (decision 132); a zip of several hundred
recordings, or a Bible's, fits neither, and the job container has 4 GiB and
hours. The job folds each language as the projection pass does (`foldStream`),
reads each recording from R2 through the Worker by hash, and writes one zip
in parts (R2 multipart, 32 MiB a part, through `/api/org-exports/:id/upload`,
because a Worker takes 100 MB of request body at most), so no archive sits in
memory or on disk and no phone is involved. The admin sees progress and a
Download link, an hour long and signed with a key derived from the service
key as blob links are (`worker/orgExports.ts`); the zip is deleted after 7
days. A request is a private row in `org_exports` (the pattern of decision
48), not an event: no new event type. One export at a time per organization.
What is in it, and how it is laid out, is `docs/org-export.md`, which partners
may rely on: recordings as standard audio in folders by language, book,
chapter and passage with readable names; a manifest (CSV and JSON) of every
recording and every voice note; spreadsheets by language, book, person, month
and passage; people, passages, reviews, notes and key terms; and the raw event
log as JSON lines, which is the guarantee: the rest is a reading of it.
What is read is core's own (`planOrgExport`, pure, in `packages/sync` where only servers use it, so the phone and web bundle does not carry it): it uses
`derivePassage`, `approvedVersion` and `languageReport`, so a figure in a sheet
is the figure the dashboard shows. `packages/sync/test/orgExport.test.ts`
checks a fixture organization's manifest against its event log, and
`apps/web/test/orgExports.test.ts` unzips what the job writes with a real tool.
The format is versioned (`EXPORT_FORMAT_VERSION`): a column may be added, never
renamed or removed, without a new version. Not built here, as the issue says:
importing an export back in, scheduled exports, and per-person data requests.
The phone does not offer it (a browser saves a zip; a phone has no place to).
Choosing the job over the Durable Object, and the Organization home over the
Reports section for the button, were the recommended options on the question
card; Caleb asked for the issue to be built as written and did not rule on
either, so both are open to change.
Reverse if: exports are small enough for the Durable Object to stream (then
the job and its multipart door are needless), or an organization needs a
format this one does not give (add a version beside it, or a tailored export
from what that organization says it needs).
