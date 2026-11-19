# 80. A language's numbering is chosen first, for the whole Bible, and ways of dividing are converted into it

Date: 2026-10-09 · By: Caleb Koster · Status: accepted

Reason: how a book is divided depends on its numbering. "By chapter" has
no meaning until the chapters are known: English Malachi has 4, Hebrew-
numbered Malachi 3. And the numbering decides which books exist. So when a
language translates the Bible, its numbering is chosen first, for the whole
Bible (by its Bible, by name, or with the quiz), and only then are books
divided, all at once or one by one (Caleb, 2026-10-09). A numbering offered
to admins is a source versification with exactly one tradition's books.
FIA, unfoldingWord and OpenBible divide the text, not the numbers, so their
English-numbered sections are converted into the language's numbering, with
four rules: uncovered verses inside a chapter are a section of their own
(Psalm headings included); uncovered verses inside a section split it
(Catholic Daniel 3:19–23, 3:24–90, 3:91–97); a verse two sections want goes
to the earlier one (Douay Judges 21:24); uncovered whole chapters are a
section each (Catholic Daniel 13 and 14). Books a way does not cover wait
for the admin. When divisions change (a way's new version, an admin
dividing a book again, a new numbering), sections expire but are not
deleted: a current section that overlaps an expired one with recordings
shows a warning mark and lists it under "Earlier sections", closed by
default (Caleb, 2026-10-09); this replaces decision 74's "will no longer
show" for an admin's own change. `docs/breaking-up-the-bible.md`
holds the rules with examples. Decision 74 stays as built; this extends it.
The source files are rebuilt first, because their JSON copies lost every
second line of a verse that matches two (96 lines). Five numberings are
offered (English, Hebrew, Vulgate 73 books, Russian Synodal 66 and 77);
every way is published once in each, converted by the seed. A language's
numbering is its template's versification, so no new event is needed; a
language's state keeps every template version it used, to read an expired
section in the numbering it was made in. Changing numbering keeps the
work on sections whose verses stay the same: a converted way marks the
parts whose verses differ from the same numbers in English, and only
those get new ids (`2CO.13~org`). The Septuagint numbering and Catholic
Bibles numbered like the Hebrew are not offered yet.
Reverse if: teams need one section made of two separate ranges (Daniel
3:19–23 with 3:91–97) often enough; then a section holds a list of ranges,
and every reader of a section's verses learns to read one.

Amended (2026-10-30, Caleb Koster): the quiz was easy to miss, at the
bottom of the page under every Bible. Before any Bible, a page now shows
why the numbering is asked (Malachi 4:1 in an English Bible is Malachi
3:19 in a Hebrew Bible), and the next page offers the three ways side by
side: pick your Bible, take the quiz, or choose the numbering (LAN-193,
Caleb). "Choose another" and the numbering's chip go back to the three
ways. A numbering that other languages here use ("Like most English
Bibles · Used in Alpha") leads those three ways, one tap from done, as it
had led the Bibles before.
