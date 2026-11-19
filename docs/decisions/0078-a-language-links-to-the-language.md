# 78. A language links to the language list with LanguageCodeSet, and is unlinked until then

Date: 2026-10-09 · By: Caleb Koster · Status: accepted

Reason: partly supersedes 73, which said a language names its languoid's
UUID in `LanguageAdded`. Its `code` is what people and the app read: the
language page and the map show it, reports carry it, and the warning about
a repeated language compares it. A UUID there would show as a code, and
`LanguageAdded`'s shape cannot change. So a new register in the
organization stream, `v1.LanguageCodeSet { languageId, code, languoidId }`,
says which language in the world it is: `languoidId` is a languoid's UUID,
or null, and `code` takes over `LanguageAdded`'s (the languoid's ISO 639-3
code, else its glottocode). The later clock wins, then the higher id. With
no `LanguageCodeSet` a language is unlinked. Adding a language searches the
language list as its name is typed (`search_languoids`, online only, as 73
has it); picking one adds the language with that code and links it in the
same step (`addLanguage`'s `link`). Offline, or when nothing fits, the typed
name and code are added unlinked, and the language's page links it later
(More, In the language list). Whoever may rename the language may link it
(`manage_structure` there or for the organization, `mayRenameLanguage`).
The server keeps the link on `languages` (`code_set`, `languoid_id`, read
through `language_code()`), with no foreign key, since a language may name a
languoid this database does not have yet (migration
`20261009200000_language_code_set.sql`). Linking later changes the code and
the link only: the work belongs to the language, so nothing moves. This
settles the open point in `docs/streams-and-languages.md` on whether a
language's code can change. Caleb agreed to the picker, unlinked languages
and `LanguageCodeSet` (2026-10-09). Not built: sending a missing language to
us as a request, and moving v2 imports, which still put v2's languoid UUID
in `LanguageAdded`'s code, to `LanguageCodeSet`.
Reverse if: a language needs to be in more than one languoid (a project
covering two dialects, say); then the link becomes a set rather than a
register.

Amended (2026-10-12, Caleb Koster): moving v2 imports to `LanguageCodeSet`
is done (decision 94): an imported language's `LanguageAdded` carries the
readable code decided on the import's board, and `LanguageCodeSet` links it.
