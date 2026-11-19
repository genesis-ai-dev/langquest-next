# 172. FIA's key words are a key-word list per language, picked apart from FIA's guides, shown where a passage links or says them, and every reference list can be searched

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: FIA's guides already carried each passage's Master Glossary words,
but only as tappable words inside a guide step: they never reached the
team's key words, and reviewers never saw them. Caleb (2026-10-20): FIA's
key words should be usable without FIA's guides, a team turning on the
guides should see at once that the words go with them, words should show on
a passage where its verses are linked to them or where a translation says
them, and reference material should be searchable ("FIA" finds FIA's items
among a hundred from twenty organizations).
- **Format.** The library's unused key-word list (`material@1` of kind
  `key_terms`) is filled in rather than a new format made: each word
  (`KeyWordDoc`) may carry its full meaning in markdown (`[mercy](#t91)`
  links another word, as guides link terms), a recording (`MediaRef`) and the
  verses it belongs to (`links`); the list may say the method it goes with
  (`pattern: 'FIA'`, as FIA's guide collections do) and its credit line.
  One document per language holds the whole list (English 752 KB, about
  190 KB compressed), so its words show and search offline once it has
  come; recordings stay on FIA's server and play when tapped, as guide audio
  does.
- **Import.** FIA's `get_terms.py` (genesis-ai-dev/fia) writes every term with
  its translations and linked pericopes; `scripts/fia-terms.ts` makes a list
  per language that has meanings (English 302 words, French 237, Portuguese
  237, Indonesian 236, Mandarin 155, Spanish 10; Russian has names alone and
  is left out), placing each pericope by FIA's passage list. `npm run
  library:seed -- --fia-terms <file>` publishes `langquest.fia-words.<lang>`;
  without it the seed uses the Genesis 2 sample in `library/fia`.
- **Picking.** Key-word lists are their own kind of reference material
  (`RefKind` `words`) with their own row and switch. A method's lists form a
  set by language like its guide collections (`guideSets.ts`, set key
  `<origin>|FIA|words`), chosen with the same per-language
  `v1.ReferenceSet` writes; no new event. A list reaches a team only when
  chosen for it (recommended for the language, or by the organization for
  every language), never by merely being in the library as guides and notes
  do, so a phone fetches only its team's list: of FIA's, the one language its
  admin picked. Items from the same organization
  that follow the same method are related (`HelpItem.family`): turning on
  FIA's guides turns on FIA's key words in the same language (else English),
  and New language ticks them with the guides it suggests; the first row of
  the family that is on says how many related resources came on, and tapping
  that line filters the list to them, each with its own switch. Turning one
  off never turns off the others.
- **Search.** Every list of reference material has a search bar matching
  name, description, organization, language, kind and method, every typed
  word in any order (`matchesHelpItem`). A search reaches past the team's
  language (typing "French" finds French material) and lists what the
  organization does not have yet last, under "Not in your library yet".
  The Key words screen searches the team's words and every list by word,
  short meaning and full meaning.
- **On a passage.** A list's word shows when one of its links meets the
  passage's verses (each side in its own numbering, as guides are matched) or
  when the word or another form of it (the list's `match`, and simple English
  endings) is a whole word in a Bible the team reads in the list's language
  (`keyTerms/listsModel.ts` `wordsOnPassage`). Words the team has made its
  own show with the team's words instead.
- **The team's own.** Adding a list's word makes an ordinary key term whose
  id is `fia:<FIA's id>` (the prefix `isFiaTerm` already read), so the
  team's word and FIA's stay one word and its page shows FIA's meaning.
- **Checks.** A key-word list is a library item, so a check can link it as
  a help (decision 91); the reviewer sees each of the list's words in the
  passage with the team's word, whether the translator marked it in this
  version, or that the team has no word yet.
- **A word's own page.** Key words → a word lists every passage of the
  language the word is in: where its list links it, where the team's chosen
  Bible says it in the book the word belongs to, and where a version marked
  it. Each shows where the team stands (used, not marked, not recorded),
  with chips to keep one kind, and opens that version, or the passage when
  nothing is recorded (a new edge, `key_term_detail` to `passage_record`).
  Below come the notes on the word and the review notes about it from any
  check, newest first, with passage, version and replies; they are read from
  those passages' records, which may not be in memory (decision 143). A
  list's word the team has not taken opens the same page from the Key words
  search or a word's sheet ("Every passage it's in"), with Add to our key
  words at the top and the passages its list links it to
  (`keyTerms/wordPageModel.ts`, `useWordPage.ts`). "Where it's used" folds
  into the passages, and the list's meaning becomes a row under Details.
Cost: about 70 KB more of the web app's code. A word's sheet and a check's
key words load when first opened, and the search helpers live apart from
the recorder's (`keyTerms/searchModel.ts`): a first visit is 3.77 MB of its
3.9 MB budget, and every file together 4.63 of 4.75 MB
(`apps/mobile/scripts/export-web.mjs`, decision 123 amended).
Reverse if: lists grow past what one document per language holds (then a
list goes book by book, as `helps@1` does on the Door43 branch), or teams
need to edit a library list's words one by one (then each word becomes a
register).
