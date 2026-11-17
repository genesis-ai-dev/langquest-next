# 73. Languages and regions are LangQuest v2's reference tables, filled from Glottolog itself and kept outside the event log

Date: 2026-10-08 · By: Caleb Koster · Status: partly superseded by 78

Reason: the app had no list of languages. A new language took whatever code
an admin typed (`addLanguage`, "din"), while `import:v2` carried v2's
languoid UUIDs. v2 already has a carefully normalized model, which Caleb
designed: languoids in a tree; aliases written in a label languoid and typed
endonym or exonym (so a language's name can be shown in the reader's app
language); sources (glottocode, ISO 639-3, Wikidata, WALS, …); open
properties; regions with their own aliases and sources; and languoid–region
links with majority, official and native. That model is what lets LangQuest
map the world's languages and their regions from what people enter. So this
app takes v2's nine tables with the same columns and constraints, and fills
them from Glottolog's own release files (one `md.ini` per languoid, plus its
CLDF category and macroareas), shaped as v2's loader shaped them, rather
than copying v2's rows (Caleb, 2026-10-08): `npm run languoids -- explore /
preview / apply` (`scripts/languoids.ts`, `scripts/glottolog.ts`). A
languoid v2 also had keeps v2's id, matched by ISO code or by its names, so
imported v2 projects point at the same language; languoids v2 users made
are not brought over (Caleb, 2026-10-05). Ids are UUIDs because languages
collected in the field may not be in Glottolog yet. Departures from v2:
`download_profiles` is dropped (PowerSync's sync list; nothing syncs these
tables here), `ui_ready` is dropped (v2's interface languages; this app's
will come from published localizations), and the glottocode, which v2
never kept, is a `languoid_source` row so each release merges into the rows
the last one made: added, renamed, moved, or made inactive, never deleted.
The tables are reference data, not events and not in any stream: a language
in the app names its languoid's UUID in `LanguageAdded`, and phones keep no
copy; they search online, and offline a typed name is added unlinked and
linked later. This replaces the "languoid list in a static `catalog@N`
bundle" of `docs/flow-coverage-audit.md` 5.D. `docs/languoids.md` has the
details.
Reverse if: people often need to pick a language they have never searched
for while offline and cannot wait to link it; then phones keep a compact
copy of the names (about 2.7 MB gzipped), and the tables stay the source.

Amended (2026-10-09, Caleb Koster): the language explorer is part of the web app only, at `/languages`, reading `/api/languoids` (the Worker caches `languoid_explorer()` for an hour); the phone app does not show it. Names tagged with an umbrella ISO code take its main language as their label (nine codes, checked by Caleb), names of six words or more are `alias_type = 'description'`, retired ISO entries keep ISO's reason and their replacements as properties, and Glottolog's macroareas are `region.level = 'macroarea'`.
