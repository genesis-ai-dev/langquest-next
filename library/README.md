# The LangQuest organization's library

What the official LangQuest organization (`langquest`) publishes for every
other organization to copy or subscribe to: versifications, content
templates, review flows, question sets and FIA study material. None of it
ships in the app. `scripts/library-seed.ts` builds it into library documents
and publishes them; `docs/library.md` explains items, versions and documents.

## What is here

| Path | What | Source and license |
| --- | --- | --- |
| `versifications/*.json` | The six standard systems: `org`, `eng`, `lxx`, `vul`, `rso`, `rsc` (Copenhagen Alliance JSON) | Frontier's versification-tool, MIT. Do not edit; replace from upstream. |
| `books.eng.json` | English names for every book any of them lists, deuterocanon included | Written for this repo. |
| `fia/pericope_*.json` | FIA API pericopes, as the API returns them (`{ "pericope": … }`) | fia.bible; © 2025 Word Collective, CC BY-SA 4.0 (as stated on FIA's Aquifer releases, e.g. github.com/BibleAquifer/FIATranslationGuide). Every guide's `source` carries that attribution, and adaptations must stay CC BY-SA. `pericope_gen-p2.json` is the copy the app used to bundle. |
| `fia/demo_*.study.json` | Luke 15:11–32 and John 3:1–21, written for the partner demo in FIA's format (their notes are the demo's, not FIA's) | Converted from the app's former `src/study/fia.ts`; `versification` names a code, which the seed turns into a hash. |

Built from core as well: the flows (`FLOWS` and `DEFAULT_KINDS` in
`packages/core/src/record.ts`), the question sets (`QUESTION_TEMPLATES` in
`catalog.ts`) and the FIA passage list (`FIA_PERICOPES`).

## What it publishes

Item ids are `langquest.<kind>.<slug>`:

- `langquest.versification.<code>`: each versification.
- `langquest.template.bible-chapters-<code>`: every book the versification
  has, by chapter; `bible-books-eng` (the 66 books, one part each);
  `nt-chapters-eng`; `fia-passages-eng` (FIA's passages, in FIA's order).
- `langquest.flow.<id>`: each core flow, carrying the review kinds it uses.
- `langquest.questions.<id>`: each question set, for its review kind.
- `langquest.fia.<language>`: "FIA study guides (English)" and so on, one
  collection per language FIA renders, whose entries are `study@1`
  documents made by `scripts/fia-adapter.ts`, numbered in English.
- `langquest.examples.eng`: "Example study guides (English)", the two
  guides written for the partner demo (not FIA's content). Published
  locally; a hosted seed leaves it out unless given `--with-examples`.

Every item is shared and subscribable.

## Seeding

```sh
npm run library:seed -- --dry-run                 # counts and hashes, no network
npm run library:seed -- --dry-run --fia-dir ../fia/output   # with more FIA pericopes
```

Locally (after `npm run db:start`), take the URL and service role key from
`npx supabase status -o env` (`API_URL`, `SERVICE_ROLE_KEY`):

```sh
eval "$(npx supabase status -o env | sed -n 's/^API_URL=/export SUPABASE_URL=/p; s/^SERVICE_ROLE_KEY=/export SUPABASE_SERVICE_ROLE_KEY=/p')"
npm run library:seed
```

Running it again changes nothing: document names and event ids come from
their content. A changed source publishes a new version of its item.

Seeding a hosted project needs its service role key and the owner's
go-ahead. The script refuses a non-local `SUPABASE_URL` unless it is given
`--hosted`; never put the key in a file here.
