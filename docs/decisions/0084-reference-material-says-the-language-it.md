# 84. Reference material says the language it is in, and FIA is chosen with its language

Date: 2026-10-10 · By: Caleb Koster · Status: accepted

Reason: nobody chose the language of the FIA guides a team read. `bestGuide`
preferred English for every team because its one caller passed no language,
and a new language was offered English guides only because `sourceCode` on
`v1.LanguageAdded` is always `eng`. LangQuest publishes FIA as one
collection per language (fourteen of them), so admins saw look-alike rows
for each language. Notes, question sets and other material said nothing
about their language at all. Caleb chose (2026-10-10): turning FIA on asks
which language it should be in, defaulting to the admin's own (the app
language, decision 81), and every piece of reference material is tied to a
language that shows wherever someone chooses it. So:
- The language a team's reference material is in is a setting with a page
  of its own (Caleb, 2026-10-10: "give the language setting its own page
  (for reference material in general)"): step 4 of New language, and the
  first page of What will help them. It lists every language LangQuest or
  the organization has material in, each saying what is there (a guide
  set's passages, Bibles, other guides), and starts on the admin's app
  language when there is anything in it, else English
  (`apps/mobile/src/reference/ReferenceLanguagePage.tsx`). New language
  writes it as `sourceCode` on `v1.LanguageAdded`; changing it later is
  `v1.ReferenceLanguageSet { language }`, a register in the language's
  stream (Manage Reference). It decides what New language offers (a Bible
  and FIA in that language, nothing in a language with none), which
  language FIA follows when the team has FIA on, which Bibles are listed
  first, which other organizations' guides are shown, and which guide a
  passage prefers when several fit as well.
- Collections that follow one method from one organization (`pattern` and
  `language`, such as LangQuest's `langquest.fia.<code>`) form one guide set
  (`apps/mobile/src/reference/guideSets.ts`). What will help them shows the
  set as one row; tapping it opens a sheet listing each language with how
  many passages it covers, for a team that wants FIA in a language other
  than its own.
- Choosing a language writes the team's say in its own log with
  `v1.ReferenceSet`, so there is no new event. The chosen collection is
  recommended (followed from LangQuest first when needed), and the set's
  other collections in the library are hidden. A team has one language per
  set. Passages the chosen language does not cover show no guide rather than
  another language's: `chosenOnly` leaves a set's unchosen languages out of
  the library fallback of decision 62.
- `material@1` gains an optional `language` (ISO 639-3). The library
  material editor, the in-app material editor (when the material goes to
  the library) and the guide editor ask for it, starting with the writer's
  app language. The lists of Bibles, guides and notes, a passage's reference
  page, the library and the translator's Bible picker name each item's
  language, or say "Language not given". LangQuest's seeded question sets
  now say English; production gets that with the next hosted seed.
- Language names come from the catalogs (all fourteen of FIA's), else the
  platform's `Intl.DisplayNames`, else the code.
Toasts stay clear of a screen's buttons on phones too: they sit just above
its footer, show a bar counting down to their going, and have an X.
Reverse if: teams need two languages of one set at once (then the sheet
becomes a pick-many and `bestGuide` ranks the team's languages), or teams
want another language's guide where theirs has none (then `chosenOnly`
keeps the rest of the set as a fallback).

Amended (2026-10-19, Caleb Koster): a language's Bibles on the reference
language page are every Bible the team could add, not only the library's.
Caleb asked why English showed 5 Bibles and other languages 1 when Bible
Brain has more: the page counted only LangQuest's seeded sources. It now
adds Bible Brain's Bibles in that language that the library does not have
(`biblesFor`, each edition counted once; English 21, French 6, Portuguese
12). Wherever a language shows a Bible count from Bible Brain (Add a
Bible's chips, the translator's More Bibles), the count is the length of
the list that opens for it (`useBibleBrainBibles`), because Bible Brain's
language search counts Bibles our key cannot open (English 51, of which
20 open); its number is kept for order only.
Then (Caleb, 2026-10-19: "allow the user to type in the language, but have
a dropdown similar when selecting a language from the glottolog-based
languoid system ... only shows languages ... that have translations"):
Add a Bible, More Bibles and the reference language page's Another
language find a language by typing it, in the language list's own
dropdown (`LanguoidPicker`) narrowed to languages that have something to
pick (`useOfferedLanguageSearch`, `offeredLanguagesModel.ts`). What is on
offer comes from the data: every language Bible Brain has Bibles in
(`/api/bible/languages/all`, kept a day) and the languages the library's
material is in. A language is found by the world list's names and aliases
(Glottolog) and by its own names where a word starts; each says its code
and what it has ("FRA · 6 Bibles"), and one none of whose Bibles open is
dropped. Add a Bible opens on the team's language with its Bibles listed.
Then (Caleb, 2026-10-20: should flows and templates be linked to languages
"in the backend ... yes, absolutely"): `flow@1`, `template@1` and
`template@2` take the same optional `language` as `material@1`, in the
document (no new event). The flow and template editors ask "Written in"
(a new flow starts in the writer's app language). A language's Checks,
review flow page and Get ready's checks offer only flows in the team's
languages or saying none, and always the one in use (`useCheckChoices`).
The organization's Templates and Flows lists name each one's language.
Template choices in New language and Get ready are not narrowed: the
template is picked before the team's languages are asked (Caleb's setup
order). LangQuest's own flows and templates say no language until the
library seed gives them one.


Amended (2026-10-30, Caleb Koster): New language now asks the team's
languages right after the language's name (decision 193), so template
choices in New language and Get ready are narrowed as flows are: templates
in the team's languages or saying none, and the one in use, the rest one
tap away.
