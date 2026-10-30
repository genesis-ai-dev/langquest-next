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
waiting; the admin may go ahead. Those books are divided later, one at a
time, from the map (decision 93).

## Dividing a book your own way

A book can also be divided by hand (decision 93, demo ADR-041). "Divide it
your own way" comes first on the list of ways, set apart from it. It opens
the book as text in a Bible the team has, starting from how the language
divides it now, else by chapter. Where at least 10 of OpenBible.info's 20
English Bibles start a section, a dashed line says how many and offers
"Start here"; each section's card says how many start one there too. The
counts are bundled in core (`packages/core/src/bibleBreaksData.ts`, made by
`scripts/bible-breaks.ts` from `library/divisions/openbible-section-counts.tsv`)
and moved into the language's numbering through the Original (rule 1's
mapping, `bibleBreaksIn`). Tapping a verse starts a section there, or joins
it to the one before; a section can be named. The book's outline (guides
that come as a collection), notes on its verses and the guides offered to
the language sit in a pane under the text, and their parts can become the
sections. Any ready-made way can be the starting point, with Undo. Saving
makes a way with just this book (`ownWayDoc`) and applies it like any other
way, so the warning, the languages a shared template changes, and Undo are
the same; in another numbering, sections whose verses differ from the same
numbers in English are marked `renumbered` (decision 80).

The same page opens from the template editor (decision 107): Manage ›
Content Templates › a template, or New template › Scripture, then a book.
There a ready-made way or your own way changes the template being edited,
and Save publishes it. New template › Scripture asks what New language
asks: the Bible the team translates from (or the quiz), then how the Bible
is divided, with "Divide it your own way" first (LangQuest's "Book by
book": every book waits until it is divided). When the team has no Bible
of its own, LangQuest's shared Bibles in its language show the words.

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

- An expired section's own page says it is an earlier section, and in
  which numbering, and links to the sections its verses are in now. It
  can be heard but not worked on.
- Changing the numbering expires only the sections whose verses change.
  English 2 Corinthians 1 is the same verses in Hebrew numbering and keeps
  its recordings; English 2 Corinthians 13 (14 verses) is not, so the
  Hebrew 2 Corinthians 13 (13 verses) is a new section and lists the
  English one under "Earlier sections". Of 1,189 chapters, 139 differ
  between English and Hebrew numbering, most of them psalms with a
  numbered heading.

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

## What the app offers today

Five numberings, each a source numbering with one tradition's books
(`scripts/library-seed.ts` `NUMBERINGS`, published as
`langquest.numbering.<code>-<books>`):

| Numbering | Source |
| --- | --- |
| Like most English Bibles · 66 books | eng |
| Like the Hebrew and Greek · 66 books | org |
| Like the Latin Vulgate · 73 books (Catholic) | vul |
| Russian Synodal · 66 books | rsc |
| Russian Synodal · 77 books (Orthodox) | rso |

Every way of dividing is published once per numbering, already converted
with the four rules (`langquest.bible.fia` in English numbering,
`langquest.bible.fia.org-66` in Hebrew numbering, and so on). A language's
numbering is its template's numbering; the app offers only the ways in it.

An admin finds the numbering one question a screen. First, "Bibles number
verses differently": a picture of Malachi in an English Bible (4 chapters,
the verse 4:1) and a Hebrew Bible (3 chapters, the same verse 3:19). Then
"Find your Bible's numbering" offers three ways side by side (LAN-193):
"Pick your Bible", "Take the quiz" and "Choose the numbering". "Pick your
Bible" asks "Which Bible do you translate from?": tap it in a short list or
search 49 Bibles checked against their text
(`apps/mobile/src/breakup/numberingGuide.ts`). The quiz asks a few
questions answered with big buttons and the Bible open ("The Lord is my
shepherd": 23 or 22?), and the third way is the list of numberings. The answer shows as three facts that tell the numberings
apart: how many books, Malachi's chapters, and whether psalm headings are
verse 1. A Bible that mixes numberings gets the closest, with a note.

Not offered yet:

- The Greek Old Testament (Septuagint) numbering. The quiz and the Bible
  list say so and ask the admin to choose the nearest.
- Catholic Bibles numbered like the Hebrew (NABRE, NJB). The nearest is
  the Vulgate's.
- Esther with the Greek additions (the Vulgate numbering's Esther). No way
  of dividing covers it, so it waits for the admin.

In the code: `convertWay`, `numberingOf` and `earlierSections` are in
`packages/core/src/breakup.ts`; the numbering step is
`apps/mobile/src/breakup/NumberingStep.tsx`; Earlier sections and the
warning mark are `apps/mobile/src/breakup/earlier.tsx`. A language keeps
every template version it has used (`templateHistory` in its state), so an
expired section is read in the numbering it was made in. A converted way
lists, per book, the parts whose verses differ from the same numbers in
English (`renumbered`); their unit ids carry the numbering
(`2CO.13~org`), and the same way in another numbering keeps the
language's unit prefix, so every other part keeps its id and its work.

## Bibles from Bible Brain

The Bibles "Which Bible do you translate from?" lists are to be every Bible
we can reach, Bible Brain's included, each with the numbering it uses
(Caleb, 2026-10-30; decision 196). Nobody checks two thousand Bibles by
hand, so a survey reads them: `npm run bibles:survey`
(`scripts/bible-survey.ts`), run by GitHub with the Bible Brain key
(`.github/workflows/bible-survey.yml`, Run workflow).

For each Bible with text, the survey reads its book list (how many chapters
each book has: Malachi 3 or 4, Joel 3 or 4) and the last verse of about
forty chapters (`scripts/bibleSurvey.ts` `chaptersToRead`): first the
fewest in which any two standard numberings differ at least four times,
then thirty more spread over the other chapters where numberings part,
since that is where a Bible's own numbering parts from them too. A Bible
that agrees with one numbering in every chapter read gets it; a New
Testament alone cannot tell the Hebrew numbering from the Greek, or the
two Russian ones apart, and gets the commoner, with the others noted. A
Bible that agrees with none is custom: the report names the nearest and
every place it parts from it. `--full <Bible>` then reads every chapter of
it; when several Bibles part the same way, that is a numbering to add to
`library/versifications`, with its mapping to the others.

A whole survey is about 80,000 calls. The app's reference material uses
the same key, so the survey goes at 4 calls a second and waits when Bible
Brain asks it to; a run stops starting Bibles after five hours and the
next run carries on. What it finds is the run's artifact (`survey.json`)
and summary (`survey.md`).
