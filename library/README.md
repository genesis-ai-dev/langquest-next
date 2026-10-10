# The LangQuest organization's library

What the official LangQuest organization (`langquest`) publishes for every
other organization to copy or subscribe to: versifications, content
templates, review flows, question sets, FIA study material and sources to
read and hear (Bibles with text and audio). None of it
ships in the app. `scripts/library-seed.ts` builds it into library documents
and publishes them; `docs/library.md` explains items, versions and documents.

## What is here

| Path | What | Source and license |
| --- | --- | --- |
| `versifications/*.json` | The six standard systems: `org`, `eng`, `lxx`, `vul`, `rso`, `rsc` (Copenhagen Alliance JSON) | Frontier's versification-tool, MIT. Do not edit; replace from upstream. |
| `versifications/paratext/*.vrs` | The same six systems as Paratext ships them | SIL's libpalaso, MIT. The seed adds the mapping lines the JSON files lost (a verse that holds two Original verses is two lines; a JSON object keeps one; 96 lines, decision 80). Do not edit; replace from upstream. |
| `books.eng.json` | English names for every book any of them lists, deuterocanon included | Written for this repo. |
| `fia/pericope_*.json` | FIA API pericopes, as the API returns them (`{ "pericope": … }`) | fia.bible; © 2025 Word Collective, CC BY-SA 4.0 (as stated on FIA's Aquifer releases, e.g. github.com/BibleAquifer/FIATranslationGuide). Every guide's `source` carries that attribution, and adaptations must stay CC BY-SA. `pericope_gen-p2.json` is the copy the app used to bundle. |
| `fia/pericopes.tsv` | FIA's passage list from its API (`list_content.py` in genesis-ai-dev/fia, 2026-10-09): 2,376 passages in 46 books, in FIA's order | fia.bible; © 2025 Word Collective, CC BY-SA 4.0 |
| `divisions/unfoldingword-chunks.json` | Where each chunk starts, every book, from unfoldingWord's Unlocked Literal Bible (`api.unfoldingword.org/bible/txt/1/<book>/chunks.json`, fetched 2026-10-08) | unfoldingWord; the ULB is CC BY-SA 4.0 (the chunk files state no licence of their own), attributed in the template's description |
| `divisions/openbible-section-counts.tsv` | For every section, how many of 20 English Bibles start it there (BSB, ESV, NIV, NLT, NRSVue, NET, NABRE and more) | OpenBible.info (openbible.info/labs/bible-section-sankeys), CC BY 4.0, attributed in each template's description |
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
- `langquest.numbering.<id>` (`versification@1`, decision 80): the
  numberings an admin chooses from, each a source system with exactly one
  tradition's books and every Paratext mapping line: `eng-66`, `org-66`,
  `vul-73` (Catholic), `rsc-66`, `rso-77` (Orthodox).
- `langquest.bible.<way>` (`template@2`, decision 74): the ways to break up
  the Bible: `chapters`, `fia` (FIA's full list; books it has none for
  wait), `unfoldingword`, `openbible-long`, `openbible-usual`,
  `openbible-short`, and `book-by-book` (every book waiting). Each is in
  English numbering; `langquest.bible.<way>.<numbering>` is the same way in
  another numbering (core `convertWay`, the rules in
  `docs/breaking-up-the-bible.md`). The older
  `langquest.template.*` items above are kept as they are for the languages
  that use them.
- `langquest.flow.<id>`: each core flow, carrying the review kinds it uses.
- `langquest.questions.<id>`: each question set, for its review kind.
- `langquest.fia.<language>`: "FIA study guides (English)" and so on, one
  collection per language FIA renders, whose entries are `study@1`
  documents made by `scripts/fia-adapter.ts`, numbered in English.
- `langquest.examples.eng`: "Example study guides (English)", the two
  guides written for the partner demo (not FIA's content). Published
  locally; a hosted seed leaves it out unless given `--with-examples`.

- `langquest.source.<abbr>`: sources to read and hear (`source@1`,
  docs/reference-material.md), built by `scripts/sources-seed.ts` with
  `--sources`:
  - Bible Brain editions, linked, with none of their text or audio stored:
    `esv`, `kjv`, `web` (New Testament audio only), `bsb` (FCBH's ENGBER),
    and one gateway-language Bible each where FCBH has text and Old and New
    Testament audio that `/download` allows for our key, by FCBH id:
    `frntls` (French, Louis Segond 1910, drama), `porbbs` (Portuguese, NAA;
    its text may not be downloaded, so it streams), `hinohc` (Hindi),
    `indasv` (Indonesian, 1974; streams), `russyn` (Russian Synodal,
    numbered as `rsc`), `arbbib` (Arabic). Spanish and Swahili had none
    (2026-10-05). The seed reads FCBH's API each run: the filesets per
    testament, books, copyright lines, and `offline: 'allowed'` only when
    `/download` allows both text and audio. A gateway Bible that no longer
    qualifies is left out and said so.
  - `bsb-fs`: the Berean Standard Bible read by Frederick Surrey, ours to
    keep (text public domain since April 30, 2023; audio CC0): one
    `sourceBook@1` per book with each chapter's verses and its MP3 on
    openbible.com, and the verse timings fia-align made for it.

Every item is shared and subscribable.

## Seeding

```sh
npm run library:seed -- --dry-run                 # counts and hashes, no network
npm run library:seed -- --dry-run --fia-dir ../fia/output   # with more FIA pericopes
npm run library:seed -- --dry-run --fia-dir ../fia/output/pericopes-2026-10   # every FIA pericope (2,376; 3,956 guides in 14 languages)
```

Locally (after `npm run db:start`), take the URL and service role key from
`npx supabase status -o env` (`API_URL`, `SERVICE_ROLE_KEY`):

```sh
eval "$(npx supabase status -o env | sed -n 's/^API_URL=/export SUPABASE_URL=/p; s/^SERVICE_ROLE_KEY=/export SUPABASE_SERVICE_ROLE_KEY=/p')"
npm run library:seed
```

Running it again changes nothing: document names and event ids come from
their content. A changed source publishes a new version of its item.

The sources need the network (even with `--dry-run`) and Faith Comes By
Hearing's key in the environment; without the key only `bsb-fs` is built.
Load the key inside the command so it is never shown, and never put it in a
file here:

```sh
export BIBLE_BRAIN_ACCESS_KEY="$(set -a; . ../fia/.env; printf %s "$BIBLE_BRAIN_ACCESS_KEY")"
npm run library:seed -- --sources [--timings <dir>] [--bsb-text <file>]
```

The BSB text is berean.bible's `bsb.txt`, downloaded once into
`$TMPDIR/langquest-sources/` (or given with `--bsb-text`). `--timings`
takes a directory of fia-align `timing@1` JSON files (one document, or a
list, per file) whose `versification` is a code (`eng`); the seed replaces
it with that versification's document hash and attaches each timing to its
chapter. A timing whose `audio.source.url` names another recording than
the chapter's MP3 is left out.

Seeding a hosted project needs its service role key and the owner's
go-ahead. The script refuses a non-local `SUPABASE_URL` unless it is given
`--hosted`; never put the key in a file here.

## Verse timings

`timings/bsb-fs/` holds fia-align `timing@1` output for the BSB read by
Frederick Surrey (OpenBible's CC0 audio, BSB text from berean.bible), made
on 2026-10-05 with `fia-align chapter --text-file … --audio-file …`; every
chapter passed the proportion check. Seed them with
`npm run library:seed -- --sources --timings library/timings/bsb-fs`.
