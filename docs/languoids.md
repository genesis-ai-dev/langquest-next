# Languages and regions

The languages the app knows, and where they are spoken, are global
reference data in the database. They are not events and not in any stream:
nothing syncs them, and they cost an organization nothing to open
(decision 70). The tables are LangQuest v2's, with the same names, columns
and constraints (`supabase/migrations/20261008000000_languoids.sql`).

| Table | Holds | Why it matters |
| --- | --- | --- |
| `languoid` | every family, language and dialect, in a tree (`parent_id`), with `ui_ready` and `active` | the thing a language in the app points at |
| `languoid_alias` | each name a languoid goes by, written in a **label languoid**; `endonym` when the label is the languoid itself, else `exonym`; `source_names` says who gives it | show a language's name in the reader's own app language; find a language by any name |
| `languoid_source` | where it is catalogued: `glottolog` (the glottocode), `iso639-3`, `wikidata`, `wikipedia`, `wals`, `phoible`, `elcat`, … with URLs | look a language up and learn more about it; match it to other datasets |
| `languoid_property` | open facts: `category`, `macroareas`, `latitude`, `longitude`, `hid`, `fia_available`, … | add facts without a schema change |
| `region` | continents and nations (and debated or subnational areas), in a tree | browse and search languages by place |
| `region_alias`, `region_source`, `region_property` | a region's names in label languoids, its ISO 3166-1 code, facts | the same, for places |
| `languoid_region` | where a languoid is spoken, with `majority`, `official`, `native` | map languages to regions, from Glottolog and in time from what people tell us |

Two differences from v2: `download_profiles` is gone (it was PowerSync's
per-user sync list, and nothing syncs these tables here), and `creator_id`
names a profile here. Everyone may read; only the service role writes until
adding a field language has its request flow.

## Ids

Every languoid has a UUID, and a language in the app names its languoid by
it (`LanguageAdded` `code` and `sourceCode`). Rows copied from v2 keep v2's
ids, so imported v2 projects point at the same languages. A Glottolog
languoid's glottocode is a `languoid_source` row (`name = 'glottolog'`,
`version` = the release, with its URL); that is how a newer release finds
the row it made. A language collected in the field is a languoid without a
glottocode until Glottolog catalogues it.

## Filling the tables

Once, from v2:

```
V2_SUPABASE_ANON_KEY=<v2 publishable key> npm run languoids -- seed-v2 --dry-run
V2_SUPABASE_ANON_KEY=<v2 publishable key> npm run languoids -- seed-v2
```

This copies every languoid from v2's Glottolog load (2025-10-01) and every
alias, source, property and region link that hangs off one, plus all
regions with their aliases and sources, ids and timestamps unchanged
(`scripts/v2Languoids.ts`). Languoids made in v2 on other days stay behind:
the 17 users made, a legacy "English" from 2024, and 61 from an ISO 639-3
list. `--dry-run` prints the counts per table.

Then each Glottolog release, from its CLDF files
([glottolog/glottolog-cldf](https://github.com/glottolog/glottolog-cldf), CC BY 4.0):

```
npm run languoids -- preview --release v5.3 --report ./tmp
npm run languoids -- apply   --release v5.3
```

`preview` changes nothing. It writes each languoid change to
`languoid-diff.csv` and prints how many rows each table would gain:

| change | meaning |
| --- | --- |
| `linked` | a languoid without a glottocode is matched to one (first import after seed-v2): by a unique ISO 639-3 code, else its chain of names from the root, else a name and level only one languoid has |
| `unmatched` | a languoid with no glottocode and no match; left as it is |
| `new` | a Glottolog languoid not here yet; it gets a new UUID |
| `changed` | name, level, parent or ISO 639-3 code differs from Glottolog's |
| `deactivated` / `reactivated` | a glottocode the release drops (`active = false`, never deleted) or brings back |

`apply` makes those changes in one transaction and records the release in
`languoid_import`. It updates names, levels and the tree to Glottolog's (a
renamed languoid keeps its old name as an English alias), adds glottolog
and ISO sources, adds names (each labelled with a languoid through its ISO
639-3 code, using v2's tag table in `scripts/glottologLabelCodes.ts`;
untagged names are English, and artificial languages get none, as in v2),
adds region links from Glottolog's macroareas and countries, and refreshes
category, macroareas and coordinates where the languoid already has that
key (every key for a new one). Names, sources and properties from
elsewhere (v2's `hhbib_lgcode` names, Wikidata links, `fia_available`) are
never removed. Running a release twice changes nothing.

Writing to a hosted project needs `--hosted` and the owner's go-ahead.

## Reading

- `search_languoids(search_query, result_limit, ui_ready_only)`: v2's
  search over names and aliases (exact, starts with, contains; endonyms
  first), plus an exact ISO 639-3 code or glottocode first. It returns
  which alias matched, its type, the ISO code and the glottocode.
- `list_nations_with_languages(names)` and `list_nation_names()`: v2's.

## Not done yet

- Choosing a language in the app still takes a typed code
  (`addLanguage` in `apps/mobile/src/orgAdmin.ts`); it should search this
  list and store the UUID.
- Adding a language that is missing: start with a placeholder, then link
  it or send a request (agreed 2026-10-07). It needs `LanguageCodeSet`.
- An offline copy of the list for phones (about 2.7 MB to download).
