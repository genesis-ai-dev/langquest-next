# 195. LangQuest's library items have names in each of the app's languages, kept in the library as one `labels` item per language; New language counts in the language showing and lists the translators' Bibles first

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-30) went through New language with the app in
Hindi and asked whether it read right for a Hindi user. It mixed Hindi
with English: LangQuest's own names ("Standard Bible Flow", "By chapter",
"Like most English Bibles · 66 books", "FIA passages", "Bible book names
(Nepali)") came in English, the counts said "2,376 passages", Find your
Bible listed English Bibles before the Hindi one, and on his Android phone
the Preview button showed "पहले" of "पहले देखें". He said "Yes please" to
fixing all of it in one change. So:
- **What an item is called in a language is a library kind**, `labels`,
  with documents `labels@1` (`{ name, description, language, items: [{
  itemId, name, description? }] }`, core `libraryDocs.ts`), one item per
  language, as book names are (193). LangQuest publishes one for each of
  the app's 14 other languages (`langquest.labels.<code>`, "Library names
  (Hindi)", from `library/labels/<code>.json`), naming its templates, ways
  to break up the Bible, numberings, review flows and book name sets, and
  the flows' descriptions. The seed fails when one of those has no name in
  a language, so a new item gets its names when it is added. Whoever runs
  an organization (`manage_structure`) publishes its sets, since they name
  every kind.
- **A set names its own organization's items only**, so no one renames
  another's.
- **Only what a screen shows changes.** The phone reads the sets in the
  language showing once a session and keeps them for the next start,
  offline too (`library/labels.ts`, `labelsModel.ts`). An item another
  organization shares, or one this organization follows, shows its name
  there; an item an organization made or copied keeps the name it was
  given. Events, copies and every comparison carry the published name, so
  a team that changes its app language changes nothing in its data.
- **Names that are brands or published titles stay as they are**: FIA,
  unfoldingWord, OpenBible.info, and Bibles' own titles ("New International
  Version"); a set leaves them in when only part of a name is translated
  ("FIA अंश").
- **New language's counts are in the language showing**: "2,376 अंश",
  "1,189 अध्याय" (`breakup.count.passage`, `chapter`, `chunk`, `section`
  in every catalog); a template's own word for its pieces is shown as the
  template writes it.
- **Find your Bible lists up to three Bibles in each of the translators'
  languages first** (the languages New language asks right after the
  name, 193), then the common ones; Search finds the rest. The list of
  Bibles loads with that page (`knownBiblesModel.ts`), not with the web
  app's first visit, which this and 194 together took past its budget (123).
- **The Preview button's words take the card's width** (`breakup/parts.tsx`),
  as 139 says of a label beside other things, so Android does not cut them
  when it measures Devanagari short.
Older app builds never ask for `labels` items (shared items are listed by
kind) and keep showing the English names; their server checks accept the
new kind from this migration on (`*_library_labels.sql`). Production gets
the sets with the next hosted library seed.
Rejected: the names in the app's catalogs (only LangQuest's items could
have them, they would change only with an app release, and the library
is not app code, 36); one copy of each item per language (fifteen copies
of every template and flow, as 193 rejected for book names); writing the
name in the language showing into events (people on one team use the app
in different languages).
Reverse if: organizations need to name their own items in several
languages from the app (then a page for a language's names), or the sets
grow big enough that reading them once a session is too slow.
