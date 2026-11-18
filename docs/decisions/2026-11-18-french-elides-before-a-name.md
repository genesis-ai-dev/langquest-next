# French "le" and "la" before a name put into a sentence become "l’" in code, not in the catalog

Date: 2026-11-18 · By: Caleb Koster · Status: accepted

Reason: Caleb asked for the ops dashboard's "tutorials failed on main" line
to be cleared. The tutorial videos' frame check held French films in three
nights' runs (49 to 51) for the button "Faire la approbation finale": French
writes "l’approbation". The French catalog says "Faire la {{check}}", and
about twenty more of its sentences put "le" or "la" before a name they are
given (a check's, a language's, a Bible's). A catalog cannot know how that
name starts, and an organization names its own checks. Decided:
`apps/mobile/src/i18n/elision.ts` is an i18next post-processor on every `t`
call. In French only, it makes "le " or "la " that stands right before a
name the call gave into "l’" when the name starts with a vowel. It leaves
the catalog's own words alone, and a name that starts with h or y (French
elides before some and not others, and the letters do not say which),
"onze" and "oui". A translator writes the whole article in the catalog.
`apps/mobile/test/i18n.test.ts` holds it. It is in every visit's first
JavaScript (about 700 bytes), so the all-chunks budget in
`apps/mobile/scripts/export-web.mjs` rose by 1 KB. Rejected: French sentences
with no article ("Faire : {{check}}"), which read like a form and not like
French; a second French key for names with a vowel, which
`i18n.test.ts` refuses (every catalog holds English's keys and no others)
and which every call would have to choose; fixing only the one button, which
leaves the same fault in the other sentences. Other app languages are not
touched: the fault was found in French only.
Reverse if: the elision changes a sentence that was right (then it acts only
on keys that ask for it), or another app language needs a rule of this kind
(then the rules move into a table for each language).
