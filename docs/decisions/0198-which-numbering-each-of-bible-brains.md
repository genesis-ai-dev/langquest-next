# 198. Which numbering each of Bible Brain's Bibles uses is found by a survey of its text, run by GitHub with the Bible Brain key

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-30) found that "Which Bible do you translate from?"
lists 49 Bibles checked by hand (80), none of them in Hausa, Bengali,
Nepali, Thai or Burmese, though the app speaks those languages. He asked
for every Bible we can reach, Bible Brain's included, each with its
numbering found by a script that surveys its books, chapters and verses,
and for a numbering to be added when Bibles part from all of ours. So:
- **`npm run bibles:survey`** (`scripts/bible-survey.ts`) reads, for every
  Bible Bible Brain has text for, its book list and the last verse of about
  forty chapters of the Old Testament and thirteen of the New, each
  testament planned on its own: the fewest in which any two standard
  numberings differ at least four times, then more spread over the other
  places where numberings part (`scripts/bibleSurvey.ts`, tested). A Bible that agrees
  with one numbering in every chapter read gets it; one that agrees with
  none is custom, reported with the nearest and every place it parts.
  `--full` reads every chapter of one Bible, for when several part alike
  and a numbering is to be added (`library/versifications`, with its
  mapping). This is the hand check of 80 done by a script, at Bible
  Brain's scale.
- **GitHub runs it** (`.github/workflows/bible-survey.yml`) when the
  survey changes and by hand, with `BIBLE_BRAIN_ACCESS_KEY` as a
  repository secret (`npm run secrets -- production` sets it, like the
  Gemini key), so anyone on the team sees and reruns it, and no one needs
  the key on their own machine. It is not a production job (141): it
  reads Bible Brain and writes an artifact, nothing else.
- **It goes slowly** (4 calls a second, waiting when Bible Brain says 429)
  because the app's reference material uses the same key; a run stops
  after five hours and the next carries on from the cache.
- **A Bible one verse off English is English.** Of 1,778 Bibles with
  text, 743 part from English numbering only where 2 Corinthians 13 ends
  at verse 13 (as the NRSV ends it) or Revelation 12 at 17 (as the
  KJV, ESV, NASB and NKJV do). English Bibles that the app already calls
  English (80) part there too, so these get English as well. A Bible that
  parts anywhere else is left out until a numbering for it is added.
- **The list is the Worker's, not the app's.** `npm run bibles:survey --
  --write-numberings <survey.json>` writes the numbered Bibles to
  `apps/web/worker/bibleNumberings.ts` (about 1,500 Bibles, 140 KB, too
  big for the web app's first visit, 123). Bible Brain's rows for a
  language (`/api/bible/bibles`) carry each Bible's `numbering`, and
  `/api/bible/numbered?q=` finds numbered Bibles by name, language or id
  from that file alone, with no call to Bible Brain. A Bible with no
  numbering, or a tie the survey cannot break (a Gospel alone fits them
  all), is not offered.
- **Find your Bible lists both** (`knownBiblesModel.ts`): before anything
  is typed, the team's languages' Bibles, the app's 49 first and then
  Bible Brain's (whole Bibles before a testament alone), up to three a
  language, then the common ones; typing finds the app's and Bible
  Brain's, each once. The 49 stay in the app, so the page works offline;
  Bible Brain's show once seen, since the phone keeps each answer.
Rejected: reading every chapter of every Bible (about two million calls,
weeks at a rate the key can bear, to learn little more than the places
numberings are known to part); trusting Bible Brain's own versification
field (not given for most Bibles, and not checked against their text); a
server job in the Worker's container (it would need somewhere to put a
result that people review and commit).
Reverse if: custom Bibles turn up that part from every numbering only
outside the chapters read (then read more, or every chapter, for them), or
Bible Brain offers each Bible's versification checked against its text.
