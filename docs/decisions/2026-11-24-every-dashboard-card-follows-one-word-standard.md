# Every dashboard card follows one word standard, and a test enforces it

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: Caleb, on a Tutorial videos card titled "Edit a finished version:
Claude could not make the change": the card did not say why Claude could
not (it could not see the problem, lacked access, needed a person's
choice, did not understand?), and its text "assumes I have deep knowledge
of the problem". "Every single bloody issue on the dashboard should assume
I'm dropping into the context of that card fresh and should start at a very
high elevation and zoom in (but be brief)." Earlier fixes (decision
2026-11-24-a-card-asks-only-what-a-person-must-do, the short user issue
cards) wrote the rules only into the skills, so the words drifted back.

What changes:

- **One standard, one file.** `docs/card-words.md` says the shape of a card
  (what this is about, what is wrong, why Claude stopped, what you can do,
  Details) and the words (25-word sentences, active voice, no file, code
  word, id or minute-only time outside Details). `scripts/card-words.mjs`
  holds the same rules as code; the dashboard, the scripts that check
  Claude's words and the tests import it.
- **A stop always has a reason.** A change Claude did not make names one
  reason of `WHY_STOPPED` (a person must choose, the cause is in the app,
  the tests failed, no access, the job broke, and so on), what the person
  can do, and the one action the card makes its main button. Claude gives
  its reason as `why` and `plain` in `fix.json`; the workflow gives its
  own. Both go in the fix's note (`why=<reason>` on its first line), so no
  database change is needed. An older note's reason is read from its words.
- **Enforced, not only written.** `apps/admin/test/cardWords.test.ts`
  fails on a fixed card text that breaks the standard. The tutorial look's
  `check` step lists Claude's words that break it, for Claude to mend. The
  watch for user issues runs the checker on its decisions before it ends.
  A card shows Claude's plain words only when they pass; else they go under
  Details beside the fixed words of the reason.
- **Each square of the videos' grid leads to its cards.** A tap on a square
  says which video it is and shows the cards about that video; each card
  says which square it is ("Square 21 of 34 in the Spanish row") and shows
  that square.

Reverse if: cards that pass the checker still leave Caleb without the
reason or the next step, or the checker rejects plain text so often that
Claude's words end up under Details more than in view.
