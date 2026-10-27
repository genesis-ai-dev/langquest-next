# Publisher imports

A publisher keeps its material in an organization of its own, with its blue
check (docs/verified-organizations.md), and brings it in with an importer
LangQuest staff turn on for that organization (decisions.md 174). Other
organizations follow what it publishes, as they follow any shared library
item, and get each new import as an update.

## Turning an importer on

Staff check that the organization owns the material the importer reads
(its blue check says its admins speak for its website), then:

```sh
npm run publisher-import -- grant <organization id> fia --hosted          # Bible Aquifer's FIA
npm run publisher-import -- grant <organization id> fia --source <owner>  # another GitHub owner's copy
npm run publisher-import -- list --hosted
npm run publisher-import -- revoke <organization id> fia --hosted
```

Revoking stops runs under way at their next step; what the organization
already published stays. The script puts your `git config user.name` on
each change.

| Importer | Reads | Makes |
| --- | --- | --- |
| `fia` | `github.com/<source>/FIATranslationGuide`, `FIAKeyTerms`, `FIAImages`, `FIAMaps` (raw files, no key) | one `collection@1` per language (`fia.<language>`, "FIA study guides (English)") listing a `study@1` guide per passage, with each step's audio, the key terms, pictures and maps its text points at |

## Importing

Someone with Manage Reference at the organization's level sees
**Import from FIA** under Setup → Reference Material (`imports/ImportRows.tsx`).
The sheet:

1. **Choose.** The languages Aquifer publishes FIA in, English first; a
   language already in the library says so, and importing it again makes a
   new version. **Import** asks for a run (`import_request`); an
   organization has one open run per importer.
2. **Importing.** The app Worker's ten-minute schedule (`apps/web/worker/index.ts`)
   builds open runs for up to eight minutes (`server/publisherImport.ts`):
   `import_run_next` hands it the oldest run no step holds and holds it for
   15 minutes; each step builds one language and saves where it got to
   (`import_run_save`). A step that dies leaves the run to the next schedule,
   which builds that language again (documents are named by their content,
   so nothing is kept twice); a language that fails three times fails the
   run. The sheet asks again every 15 seconds and may be closed.
3. **Ready.** Nothing is in the library yet. The sheet lists the items the
   run made, new or an update, and **Share with other organizations** (on).
   **Publish** moves the run's documents to the organization
   (`import_run_accept`), then the admin's app appends
   `v1.LibraryItemDefined` and `v1.LibraryVersionPublished` (and
   `v1.LibrarySharingSet`) as the organization (`useLibrary.publishHeld`).
   **Don't publish this import** throws it away.

## What is new at the source

Each language a run builds keeps the source's names for the guides it took
(`import_run_parts`; Aquifer puts a guide's version in its name,
`eng-1ch-p17-v1.1`). Once a day for each importer with a published import,
the Worker's schedule (`checkImports` in `server/publisherImport.ts`) takes
it with `import_check_next`, reads each published language's
`metadata.json` (1.3 MB for English) and saves, with `import_check_save`,
how many guides are for passages the import did not have and how many are at
a new version. The app reads that with `org_importers`: the importer's row
says "16 new or updated guides since your last import" with a **New** badge,
and its sheet ticks those languages. Publishing a run makes its lists the
ones the next look compares with, and clears what they took from the count.

Importing a language again rebuilds it whole. Unchanged guides come out as
the same documents, named by their content, so nothing is kept twice, and
organizations following it get the new version as an update.

`npm run publisher-import -- check` looks now, on a local stack.

## Where a run keeps its documents

In `library_documents`, like everything in the library, with access rows in
`library_document_access` under the run's own key, `_import.<run id>`,
instead of an organization's. So `_library_store` checks them as it checks
any organization's (format, size, and that what a document depends on is the
run's too), and nobody can read them: no person is a member of that key.
Publishing moves the rows to the organization; withdrawing or failing drops
them. The server writes nothing into an organization's library (decisions.md
62); the events that publish are the admin's.

A run copies LangQuest's English versification (`langquest.versification.eng`)
because FIA numbers its passages by it.

## Sizes

Measured on a local stack (2026-10-26): English FIA is 1,523 guides and
47 MB of documents, built in 48 seconds; French took 27 seconds, about
6 seconds of CPU and a 57 MB heap, inside a Worker's limits.

## Trying it locally

```sh
npm run publisher-import -- grant <organization id> fia --workdir <stack>
# ask for a run in the app (Setup → Reference Material → Import from FIA), then build it now:
SUPABASE_URL=http://127.0.0.1:<api port> SUPABASE_SERVICE_ROLE_KEY=<local key> npm run publisher-import -- step
# after publishing it, look at the source for what is new:
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run publisher-import -- check
```

`server/publisherImportSmoke.sql` holds the server's side: who may ask,
what only the Worker may do, that nobody reads a run's documents early,
publishing, what is new at the source, withdrawing and revoking.

## Not yet

- Door43 (unfoldingWord): its converters are on branch
  `claude/project-thread-ipwajx`; its 450 MB of documents come from zip files
  and need the job container (decisions.md 141), not the Worker.
- LangQuest's own copies of FIA, which teams follow: what happens to them
  once Word Collective publishes its own is Caleb's call.
