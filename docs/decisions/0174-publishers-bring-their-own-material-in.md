# 174. Publishers bring their own material in with an importer LangQuest staff turn on for their organization; the server builds it and their admin publishes it

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-26) wants publishers to make their own LangQuest
organizations and host their material there, with "special access to a
custom content-importing tool for their own organization's externally stored
content": Word Collective's FIA, unfoldingWord's Door43. LangQuest's library
held copies of both until now (62, 147). Built (docs/publisher-imports.md):
- **Staff turn it on.** `org_importers` names an organization's importer and
  where it reads from (for `fia`, the GitHub owner of Bible Aquifer's FIA
  repositories). Staff grant and revoke it with `npm run publisher-import`,
  after checking that the organization owns that material (its blue check,
  173).
- **The admin asks.** Someone with Manage Reference at the organization's
  level sees "Import from FIA" under Setup → Reference Material, chooses
  languages and starts a run (`import_request`); one open run per importer.
- **The server builds it.** The app Worker's ten-minute schedule takes the
  oldest open run (`import_run_next`, held 15 minutes) and builds one
  language a step from Aquifer's public repositories into the same
  `study@1` guides, with their audio, key terms, pictures and maps, and the
  same `collection@1` per language that the seed makes from fia.bible's API
  (`server/fiaAquifer.ts`). Aquifer is the source because it is public and
  needs no key; Word Collective's own API would need one. A language that
  fails three times fails the run.
- **Nobody reads what a run made until the admin publishes it.** A run keeps
  its documents under its own key in `library_document_access`
  (`_import.<run id>`), so `_library_store` checks them as it checks any
  organization's, and no person is a member of that key. Publish moves the
  rows to the organization (`import_run_accept`), and the admin's app appends
  `v1.LibraryItemDefined` and `v1.LibraryVersionPublished`, shared for
  following unless the admin says not to. So 62 holds: the server writes into
  no organization's library; the events are the admin's.
- Where a run stands is worked out from its times, never stored (invariant 5).
Measured on the local stack: English FIA is 1,523 guides and 47 MB of
documents, built in 48 seconds; French took 27 seconds, 6 seconds of CPU and
a 57 MB heap, inside a Worker's limits.
Not yet: the Door43 importer (its converters are on the unmerged branch
`claude/project-thread-ipwajx`, and 450 MB of documents from zip files need
the job container of 141, not the Worker); and what happens to LangQuest's
own copies of FIA, which teams follow, once Word Collective publishes its own
(Caleb to decide: moving followers changes their data).
Reverse if: a publisher's material sits behind a key (then the importer needs
the organization's secret, kept like the Worker's), or imports outgrow the
Worker's schedule (then they move to a container job).

Amended (2026-10-27, Caleb Koster): Caleb asked that a publisher can tap the
importer again to bring in what its source added, with "some indicator ... of
'detected x new content'". Each language a run builds keeps the source's own
names for the guides it took (`import_run_parts`; Aquifer names a guide with
its version, "eng-1ch-p17-v1.1"). Once a day the Worker's schedule reads the
`metadata.json` of each published language (`checkImports`,
`import_check_next`, `import_check_save`) and counts guides for passages the
import did not have and guides at a new version; the importer's row says
"16 new or updated guides since your last import" with a New badge, and its
sheet ticks those languages. Importing a language again rebuilds it whole,
but unchanged guides are the same documents (they are named by their
content), so only what changed is new, and followers get it as an update.
Publishing a run clears what it took from the count. Only the importer's own
organization sees its importer: unfoldingWord would see its own Door43
importer, once it is built.
