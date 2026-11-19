# 193. A content template has no language: Bible book names are library items, one per language, that a language picks; and New language asks the languages its translators use right after the name

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-10-29) whether a Nepali translator's next task
says "Matthew 1:1-17" or "मत्ती 1:1-17". It said Matthew: LangQuest's
templates name every book in English, and a language had other names only
by an admin renaming its books one at a time (`v1.BookNameSet`, 74). Caleb
(2026-10-30): book names belong to the content template, not the app; New
language should name the language, then decide which languages its
translators use (Hindi, Swahili), and that choice should decide what is
offered next, with search beyond. He rejected putting every language's names
in one template ("stuffing", templates grow with every app language) and
asked for linking as FIA does: one guide collection per language, grouped
as one set (84). He chose "Build it" on that design. So:
- **Book names are a library kind**, `names`, with documents `names@1`
  (`{ name, description, language, books: [{ book, name }] }`, core
  `libraryDocs.ts`), one item per language ("Bible book names (Nepali)").
  A template says which books there are and how each is divided, in no
  language, so one template serves every language. LangQuest publishes one
  for each of the app's 15 languages (`langquest.names.<code>`; English from
  `library/books.eng.json`, the others from `library/names/<code>.json`,
  taken from the app's catalogs, decision 81). An organization can copy one
  to change a name, or publish its own for a language that has none.
- **A language uses one**: `v1.BookNamesSelected { itemId, docHash,
  language, names }`, a register in its stream (manage_templates). It
  carries every name, as a template's units come as events (36), because
  the server's projection pass builds Inbox titles from the language's
  events alone (`unitTitle`) and a phone need not hold the document. Core
  `bookNameOf` reads a book's own name (`v1.BookNameSet`, which stays on
  top), else the set's, else the template's. Passage titles, the Map's book
  list and a book's map use it; a book a set leaves out keeps the
  template's name. `REDUCER_VERSION` is 21.
- **New language asks the translators' languages right after the name**
  (the reference language page of 84, now asked "Which languages do X's
  translators use?" as the second page of the Language step), then content,
  pieces, reference material, review flow and people. A language with book
  names says so on that page. Adding the language picks the set in the
  first of those languages that has one (the organization's own before
  another's, followed first when it is another organization's); with none,
  the template's names stand.
- **Template choices follow the team's languages** in New language and Get
  ready (`useTranslate`): templates in those languages or saying none, and
  the one in use; the rest one tap away ("Templates in other languages").
  LangQuest's templates say no language, so they are offered to every team.
- **A language's book names are changed from its content template page**:
  a "Book names" row under a Bible template opens the set in use, the sets
  in the team's languages, then every other language's (`get_ready` step
  `names`, `templates/BookNamesPage.tsx`), and a newer version of the set in
  use when there is one. Existing languages keep their names until an admin
  picks a set there.
Older app builds store the new event as invalid and keep showing the
template's names until they update; their server checks accept it from
this migration on (`*_book_names.sql`). Production gets LangQuest's sets
with the next hosted library seed.
Rejected: showing each person's app language when the team named nothing
(Caleb: names come from the template's side, not the app); one template
carrying every language's names (Caleb: it grows with every language);
fifteen copies of each template, one per language (a fix to FIA's passages
would have to land fifteen times).
Reverse if: teams need two languages' names at once (then the event takes a
fallback list), or a set and a template disagree often enough about which
books exist that names need to live with the template after all.
