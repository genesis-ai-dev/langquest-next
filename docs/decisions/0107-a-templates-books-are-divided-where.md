# 107. A template's books are divided where the template is made, as they are from the map, and making your own comes first everywhere

Date: 2026-10-14 · By: Caleb Koster · Status: accepted

Reason: Caleb opened Manage › Content Templates › New template ›
Scripture and found an older editor: a plain list of numberings (old and
new mixed), "Whole books" or "Chapters" for every book at once, and a book
that could only be renamed or removed. A partner (Spoken) chose "Book by
book" for a language and then saw only the ready-made ways when dividing
later. Dividing a book its own way (93) was reachable only from a
language's book. Divisions are the per-book `divide` of a Bible template
(74), so the template editor is a place to make them too.
- New template › Scripture asks what New language asks (80): the Bible the
  team translates from, the quiz, or the list, then how the Bible is
  divided (`useTranslate`, `TranslateQuestion`). The template starts as
  that way divides it (a `template@2`), with the admin's own name.
- The whole-Bible list puts "Divide it your own way" first, set apart
  (design principle 12). It is LangQuest's "Book by book": every book
  waits until someone reads it and chooses where its sections start.
- In the template editor each book says how it is divided ("FIA passages ·
  105 pieces", "Its own way · 17 pieces", "Waiting to be broken up").
  Tapping it opens the same page as from the map (`BreakUpBook`): your own
  way first (`DivideOwnWay`), then the ready-made ways, and "Rename or
  remove". There they change the template being edited (`apply`) rather
  than the language's, and Save publishes them; a template that languages
  use warns before a book divided before is divided again (`RedoSheet`).
  An older `template@1` keeps its "Divide into" choice until one book is
  divided on its own, which makes it a `template@2` with the same unit ids.
  Its numbering cannot be changed in the editor once books divide on their
  own: the ways are made per numbering (80).
- The own-way editor reads a Bible the team has; when the team has none
  (or the template has no team), LangQuest's shared Bibles in the team's
  language stand in (`useSources` `wholeBook`). A book's page shows the
  same words.
- A template is never named as the way its own books are divided, nor
  offered as a way to change itself (`wayNow`, `isItself`): a book divided
  its own way said "Book by book (Kara)".
- A language's template view lists books waiting to be divided, so they
  can be opened there.
- Content Templates and Choose a Template list LangQuest's ways once, in
  the language's numbering, and not its older `langquest.template.*`
  items (kept for the languages that use them) or the same ways in other
  numberings (`sharedTemplateShown`). Another organization's are listed as
  before.
Reverse if: admins need to make a template without any way to start from
(then offer an empty Bible template), or the numbering of a template must
change after books are divided (then convert each book's sections, as 80
does for a language).
