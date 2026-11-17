# 74. A Bible template breaks up each book its own way, or not yet, and a change goes to the languages chosen

Date: 2026-10-09 · By: Caleb Koster · Status: partly superseded by 80

Reason: an admin should first say what a language translates (the Bible or
something else), then, if they want, how the Bible is broken up, and a book
has to be broken up before anyone records it (Caleb, 2026-10-09). The ways
are by chapter, FIA's passages, unfoldingWord's chunks and OpenBible.info's
sections where at least 15, 10 or 5 of 20 English Bibles start one; FIA's
way includes FIA's study guides' requirement for how things are divided,
and FIA covers 46 books, not all 66. A `template@1` divides every book one
way, and in its passage form a book with no passages is not listed at all.
So a new document format, `template@2` (`libraryDocs.ts`): each book says
how it is broken up (`divide: chapters | passages`, the part's name, the
passages) or nothing yet, and a book with nothing in it is listed and
waits (`Indexes.waiting`); nobody records in it. Unit ids are
`template@1`'s, so a language moves between the two, and between ways that
agree on a piece, without losing anything; `asTemplateV2` carries a
`template@1` over unchanged. A new format rather than new fields on
`template@1`, because an older app would read such a document with its
one `divide` and hide every part it did not expect; an older app refuses a
format it does not know. The ways are LangQuest library items
(`langquest.bible.*`, `scripts/library-seed.ts` from `library/fia/pericopes.tsv`,
`library/divisions/`), plus "Book by book" with every book waiting; the
existing `langquest.template.*` items are unchanged, because a new version
of them would move the parts of every language that follows them.
Templates stay shared between languages (Caleb, 2026-10-09). What a book is
called in a language is its own register, `v1.BookNameSet` (language
stream, `manage_templates`), read wherever a book's name shows
(`unitTitle`, `unitPlace`). Breaking up a book, or changing one, asks which
of the languages using the template it goes to (`library_template_users`
says which languages use what, since a phone pulls only the languages it
opens), offering only those the person may change: all of them, and it is
the template's next version; some, and the chosen ones move to a copy split
off for them (`v1.LibraryItemDefined` with `copiedFrom`, then the version
they had, then the change), keeping their unit prefix (`TemplateSelected`
`unitPrefix`), so the pieces that did not change keep their recordings.
Offline, who else uses it is unknown, so the change is always a copy.
Changing a book that is already broken up warns first that every recording
and review on its old pieces, including ones on phones that have not
synced, will stop showing and need to be redone; they are hidden, not
deleted (TPL-7). Only `manage_templates` (coordinators and admins) breaks
books up. A guide set says which method it follows (`collection@1`
`pattern`) and a template which one it was made for (`goesWith`), so FIA's
guides say they go with FIA's passages; any later guide set links the same
way. Verse numbers are not asked: a language's numbering is its Bibles',
English when it has none, and when its Bibles disagree the team sees one
verse that shows how (`verseNumbering`), which it may put away.
Reverse if: teams need to break up one book differently from every other
language using the same template, often enough that copies pile up; then a
language keeps its own overrides on top of a shared template instead.


Amended (2026-10-09, Caleb Koster): decision 80 puts the numbering first, for the whole Bible, and replaces the warning that recordings on old pieces "will no longer show": expired sections that overlap current ones stay reachable under "Earlier sections".

Amended (2026-10-12, Caleb Koster): decision 93 drops the choice of what the books a way leaves out get when the template is made (they wait, and are divided from the map), adds dividing a book your own way, and has naming a book offer what the language's Bibles and the organization's other languages call it.

Amended (2026-10-30, Caleb Koster): a language's names for the books can
also come whole from a library set of book names in one language
(`v1.BookNamesSelected`, decision 193); a book's own `v1.BookNameSet` stays
on top of it.
