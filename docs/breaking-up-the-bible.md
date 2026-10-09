# Breaking up the Bible

How a language's Bible is set up, so translators know exactly what they
translate: first its numbering, then how each book is divided into sections.
Agreed with Caleb on 2026-10-09 (decision 80). Decision 74 built the first
part (books divided one by one, the ways to divide); the rest is the plan.

## Words used here

- **Numbering** (versification): which books a Bible has, and which chapters
  and verses each book has. Bibles differ. English Malachi has 4 chapters;
  in Bibles numbered like the Hebrew (Luther 2017, for example), Malachi has
  3, and English Malachi 4:1 is Malachi 3:19.
- **Original numbering** (`org`): the Hebrew and Greek numbering every other
  numbering is compared to.
- **Way of dividing**: a method of cutting books into sections: FIA's
  passages, unfoldingWord's chunks, OpenBible's long, usual and short
  sections, or by chapter.
- **Section**: what a team studies, records and reviews as one piece.
- **Covered**: a verse a way of dividing puts in one of its sections.

## The order of decisions

1. **The Bible, or something else.** Something else is folders and things
   to record, made by the admin; nothing below applies to it.
2. **The numbering, for the whole Bible.** It comes first because it decides
   which books exist and how their chapters and verses run. The admin
   chooses it in one of three ways: by the Bible the team translates from,
   by naming the numbering, or with the short quiz (what Psalm "The Lord is
   my shepherd" is, whether Psalm 3's heading is numbered, how many chapters
   Malachi has, how Romans 16 ends). It is one choice for the whole Bible.
3. **How the books are divided.** For the whole Bible at once, or one book
   at a time. A book must be divided before anyone translates it. Until
   then it shows as waiting to be divided.

Setting up a Bible is a work item on the admin's list: "Choose the
numbering", then "Divide Malachi" for each book that is waiting.

## What a numbering is

A numbering is its books, their chapters and their verses, together. The
app's six source files (`library/versifications/`: English, Original,
Septuagint, Vulgate, Russian Protestant, Russian Orthodox) each list every
book any Bible numbered that way might have; the English file has 92. So a
numbering offered to admins is built from a source file with exactly the
books of one tradition, for example:

| Numbering | From | Books |
| --- | --- | --- |
| English, 66 books | English | the Protestant canon |
| Hebrew, 66 books (like Luther 2017) | Original | the Protestant canon |
| Hebrew, 73 books (Catholic) | Original | with Tobit, Judith, Wisdom, Sirach, Baruch, 1 and 2 Maccabees, and Daniel 13–14 |
| Russian Synodal (Orthodox) | Russian Orthodox | with the extra books it prints |

Each source file also says where it differs from the Original numbering
("English Malachi 4:1 = Original Malachi 3:19"). The app converts any verse
from one numbering to another through the Original numbering.

**Data repair before this is built.** In Paratext's original files, a verse
that matches two verses of the Original is written as two lines. The app's
copies keep one line per verse, so 96 such lines were lost (66 Vulgate, 25
Russian, 5 English, among them English Acts 19:40–41). The files are rebuilt
so a verse can match several. Nobody using the app does anything.

## Dividing by chapter

"By chapter" means the chapters of the language's numbering. With Hebrew
numbering, Malachi has 3 sections; with English numbering, 4.

## Dividing by FIA, unfoldingWord or OpenBible

These ways divide the text itself. They were written with English numbers,
but a section is the same words in any numbering, so each section is
converted into the language's numbering. Example: FIA's "Malachi 4:1–6" is
"Malachi 3:19–24" in Hebrew numbering. Four rules settle what does not
convert one to one.

**1. Verses a way does not cover, inside a covered chapter, become their own
section.** Example: Luther 2017 numbers Psalm 51's heading as verses 1–2.
FIA's Psalm 51 (English 1–19) is Luther 51:3–21, so Luther 51:1–2 is a
section of its own. No exception for psalm headings.

```
Sections:  [own: 1–2][ FIA: Psalm 51 ............................ ]
Luther:     1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21
```

**2. Verses a way does not cover, in the middle of one of its sections,
split that section.** Example: Catholic Daniel 3 has 67 verses (3:24–90)
between English 3:23 and 3:24. FIA's "Daniel 3:19–30" becomes three
sections: 3:19–23 (FIA), 3:24–90 (own), 3:91–97 (FIA). FIA's study guide
shows on both FIA sections.

```
Sections:  [ FIA: 19–23 ][ own: 24–90 (67 verses) ][ FIA: 91–97 ]
Catholic:   19 … 23        24 … 90                   91 … 97
```

A single section of 3:19–23 and 3:91–97 was considered and left for later:
every part of the app that reads a section's verses (the map, the Bible
text, guides, timings, verse labels) reads one range today.

**3. A verse two sections both want goes to the earlier one.** Example:
Douay-Rheims Judges 21:24 is English 21:24 and 21:25. unfoldingWord's
chunks are 21:23–24 and 21:25. Douay 21:24 joins the 21:23–24 chunk, and
the 21:25 chunk, now empty, is not made.

```
Chunks:    [ 20–21 ][ 22 ][ 23–24 ][ 25 ]
English:     20  21   22    23  24   25
Douay:       20  21   22    23  [ 24 ........ ]   → 24 goes to 23–24; "25" is not made
```

**4. Whole chapters a way does not cover, in a covered book, become one
section per chapter.** Example: FIA covers Daniel 1–12, not the Catholic
Daniel 13 (Susanna) and 14 (Bel). They become two sections, Daniel 13 and
Daniel 14. The admin can divide them further.

**Books a way does not cover at all** (Tobit, Maccabees, or Romans under
FIA) stay waiting to be divided until the admin divides them. Choosing a
way that does not cover the whole numbering shows which books it leaves
waiting; the admin may go ahead.

## When divisions change

Divisions change three ways: a way of dividing publishes a new version
(FIA changed "Acts 2:41–47" to "Acts 2:42–47"), an admin divides a book
again, or an admin changes the numbering. All three work the same:

- The language gets the new sections. The old ones expire; nothing is
  deleted.
- An expired section that overlaps a current one, and has recordings or
  reviews, stays reachable. The current section shows a warning mark, and
  its page has an "Earlier sections" list, closed by default, with each
  expired section that overlaps it and what was recorded and reviewed on
  it.
- Before an admin's own change, the warning says that what was recorded on
  the old sections, including recordings on phones that have not synced,
  moves to "Earlier sections" and will need to be done again on the new
  ones.

```
FIA before:  [ 37–41 ][ 41–47 · recorded ]
FIA now:     [ 37–41 ⚠ ][ 42–47 ⚠ ]       each lists "Earlier sections: 2:41–47"
```

**Copying.** Anyone allowed to manage templates can copy a way and change
it; the copy is the organization's own and no longer follows the
original's versions.

## Who decides

Coordinators and admins (`manage_templates`) choose the numbering and
divide books. Everyone else sees a book waiting to be divided, and why.
