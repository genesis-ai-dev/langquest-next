# Languages and regions

The languages the app knows, and where they are spoken, are global
reference data in the database. They are not events and not in any stream:
nothing syncs them, and they cost an organization nothing to open
(decision 70). The tables are LangQuest v2's, with the same names, columns
and constraints (`supabase/migrations/20261008000000_languoids.sql`), filled
from Glottolog itself.

| Table | Holds | Why it matters |
| --- | --- | --- |
| `languoid` | every family, language and dialect, in a tree (`parent_id`), with `active` | the thing a language in the app points at |
| `languoid_alias` | each name a languoid goes by, written in a **label languoid**; `endonym` when the label is the languoid itself, else `exonym`; `source_names` says who gives it | show a language's name in the reader's own app language; find a language by any name |
| `languoid_source` | where it is catalogued: `glottolog` (the glottocode, with the release), `iso639-3`, `wikidata`, `wikipedia`, `wals`, `phoible`, `elcat`, … with URLs | look a language up and learn more about it; match it to other datasets |
| `languoid_property` | open facts: `category`, `macroareas`, `latitude`, `longitude`, `hid`, … | add facts without a schema change |
| `region` | continents (Glottolog's macroareas) and nations (and, later, debated or subnational areas), in a tree | browse and search languages by place |
| `region_alias`, `region_source`, `region_property` | a region's names in label languoids, its ISO 3166-1 code, facts | the same, for places |
| `languoid_region` | where a languoid is spoken, with `majority`, `official`, `native` | map languages to regions, from Glottolog and in time from what people tell us |

Differences from v2: `download_profiles` is gone (it was PowerSync's
per-user sync list), `ui_ready` is gone (it marked v2's interface
languages; see "Interface languages" below), and `creator_id` names a
profile here. Everyone may read; only the service role writes until adding
a missing language has its request flow.

## Ids

Every languoid has a UUID, and a language in the app names its languoid by
it (`LanguageAdded` `code` and `sourceCode`). A languoid LangQuest v2 also
had keeps v2's id, so imported v2 projects point at the same language; v2's
ids are read for that match only, never its rows. A languoid's glottocode
is a `languoid_source` row (`name = 'glottolog'`), which is how the next
release finds the row it made.

## Loading a Glottolog release

```
npm run languoids -- explore --release v5.3 --out languoid-explorer.html
npm run languoids -- preview --release v5.3 --report ./tmp
npm run languoids -- apply   --release v5.3
```

The source is the release's own files (`glottolog/glottolog`, CC BY 4.0):
one `md.ini` per languoid under `languoids/tree`, nested as the
classification is, fetched with a sparse git clone (about 110 MB, cached
under `GLOTTOLOG_CACHE`), plus the release's CLDF `values.csv` (category)
and `languages.csv` (macroareas Glottolog computes for dialects and
families). `scripts/glottolog.ts` shapes them as v2's loader did:

- `languoid`: name and level; the parent is the folder it sits in.
- `languoid_alias`: every name under `[altnames]`, by provider. A name
  tagged `[fr]` is written in the languoid whose ISO 639-3 code the tag
  maps to (`scripts/glottologLabelCodes.ts`, v2's table; a macrolanguage tag
  goes to its main language, as v2 did for Chinese, Estonian and Persian);
  an untagged name is English. Endonym when the label is the languoid
  itself. Artificial languages get no names, and placeholders such as "not
  specified" are dropped.
- `languoid_source`: the glottocode with the release, the ISO 639-3 code,
  and every link in the file, named by site with its last path segment as
  the identifier.
- `languoid_property`: `hid`, `macroareas`, `category`, `latitude`,
  `longitude`.
- `region`, `region_source`, `languoid_region`: the macroareas and the
  countries each languoid names, with English country names from the
  Unicode CLDR and their ISO 3166-1 codes.

Ids: a languoid keeps the id it has here; one not here yet takes v2's id
when `V2_SUPABASE_ANON_KEY` (v2's publishable key) is set and it matches a
row from v2's Glottolog load (a unique ISO 639-3 code, else the chain of
names from the root, else a name and level only one languoid has);
otherwise a new UUID.

`explore` writes a page (`scripts/languoidExplorer.html` with the data in
it) to browse, search, filter and group the tables, follow parents and
children, read names by the language they are written in, look by region,
and page through each table as it will be stored. It needs no database.

`preview` stages the tables and changes nothing: every languoid that is
new, renamed, moved or gone goes to `languoid-diff.csv`, with counts of the
rows each table would gain, change or retire. `apply` makes those changes
in one transaction and records the release in `languoid_import`. The
import owns the rows with no `creator_id` on languoids that have a
glottocode (and, for properties, Glottolog's five keys). Of those, a row
the release no longer has becomes inactive; nothing is deleted, and rows
people add are left alone. Running a release twice changes nothing.

Writing to a hosted project needs `--hosted` and the owner's go-ahead.

## Finding a language

`search_languoids(search_query, result_limit, levels, region_id)` matches a
name or any other name in any language, an ISO 639-3 code or a glottocode,
ignoring accents, and tolerates typos from four letters. It ranks an exact
code first, then exact names, names that start with the text, a word that
starts with it, names that contain it, and near spellings; languages come
before dialects and families. It can be narrowed to levels and to a nation
or macroarea, and says which other name matched. `list_nations_with_languages`
and `list_nation_names` are v2's.

The app searches online. Offline, a person types the language's name and it
is added unlinked; once online it is linked to a languoid or sent to us as a
request (agreed 2026-10-07; needs `LanguageCodeSet`). Phones keep no copy
of these tables.

## Interface languages (proposed, not built)

v2 marked the languoids its interface was translated into with `ui_ready`.
Here a translation of the interface is work an organization does and
publishes, so it lives where such work lives, in the library (decision 36),
not as a flag on reference data:

- A `localization` library item: versions of a document with the
  languoid's UUID, a BCP 47 locale (`sw-TZ`), the app versions it covers
  and its strings. The organization that made it shares it, and others
  subscribe, as with templates and flows.
- Translating the interface is a language like any other: its template is
  the app's string catalog, translators and reviewers use the usual flow,
  and publishing a version produces the `localization` document.
- Whether a languoid has an interface comes from those published, shared
  items (a read model the server folds from library events), never a column
  someone has to keep true.
- The phone reads its locales, maps each to a languoid through its ISO code
  (`languoid_source`, and the tag table for two-letter codes), and offers
  the shared localizations for it; a person's choice is a small event in
  their person stream. Language names are then shown in that language from
  `languoid_alias` (label = the interface language).
