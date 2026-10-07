# Languages (languoids)

The languages the app knows are global reference data in the database, not
in any stream: `languoid` and `languoid_name`
(`supabase/migrations/20261008000000_languoids.sql`). Everyone may read them.
Only the service role writes, through `npm run languoids`. Decision 70 in
`docs/decisions.md` says why.

## Ids

Every languoid has a UUID, and a language names its languoid by it (`LanguageAdded`
`code` and `sourceCode`). A languoid from Glottolog also has its **glottocode**,
which is how the next release finds the row it already wrote. A language
collected in the field (`origin = 'field'`) has a UUID and no glottocode
until Glottolog catalogues it. Then a person links them by giving the field
row its glottocode before the next import.

Glottolog languoids that langquest v2 already had keep v2's UUID, so an
imported v2 project points at the same language. The languoids v2 users made
are not carried over: many are duplicates or junk. A v2 project that uses
one is imported with the v2 id and listed by `npm run import:v2`.

## Importing a Glottolog release

The source is Glottolog's CLDF release
([glottolog/glottolog-cldf](https://github.com/glottolog/glottolog-cldf), CC BY 4.0):
`languages.csv`, `values.csv` (level, category, classification) and
`names.csv`. `scripts/glottolog.ts` turns them into rows.

```
npm run languoids -- preview --release v5.3 --v2 --report ./tmp
npm run languoids -- apply   --release v5.3 --v2
```

`preview` stages the release and writes every change to
`languoid-diff.csv`, without changing anything:

| change | meaning |
| --- | --- |
| `v2 seed` | a v2 row that will keep its UUID, and how it was matched |
| `v2 unmatched` | a v2 row with no glottocode found; not brought over |
| `new` | a Glottolog languoid not here yet |
| `changed` | `field` went from `old` to `new` (name, level, category, iso639_3, parent) |
| `retired` | here, but not in this release |
| `restored` | retired before, back in this release |

`apply` does the same staging and makes those changes in one transaction,
recorded in `languoid_import`. A languoid a release drops is **retired**,
never deleted, so anything that names it still resolves; search leaves it
out. Glottolog's names are replaced on each import; names from v2 or
LangQuest stay.

`--v2` reads v2's Glottolog rows anonymously (as `import:v2` does,
`V2_SUPABASE_ANON_KEY`). v2 never stored glottocodes, so a row is matched by
its ISO 639-3 code where that is unique on both sides, else by its chain of
names from the root, else by a name and level only one languoid has. Each
glottocode is taken at most once. It only matters on the first import; after
that the rows are here and it adds nothing.

`apply` against a hosted project needs `--hosted` and the owner's go-ahead.

## Searching

`search_languoids(q, max_rows)` matches names, other names, ISO 639-3 codes
and glottocodes: exact codes first, then exact names, prefixes, and
similarity.

## Not done yet

- Choosing a language in the app still takes a typed code
  (`addLanguage` in `apps/mobile/src/orgAdmin.ts`); it should search this
  list and store the UUID.
- Adding a field language has no screen or RPC yet.
- Regions are kept as `countries` and `macroareas` on each languoid; there
  is no region table.
