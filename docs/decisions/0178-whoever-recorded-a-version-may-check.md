# 178. Whoever recorded a version may check it themselves: "Review it myself" sits after asking, and leads when nobody else there holds Review

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-20), alone in his organization, finished a recording
and found no way to review it: each check offered Ask someone, Already
happened and Set aside, and Ask someone listed nobody ("Nobody on the team
can do this"). The block was a line in `kindRowActions` from the UI test
suite (PR 109, 2026-10-14), filed as a bug fix after its role matrix ("not
their own version unless asked"); no entry here decided it, and it went
against the demo's design principle 5 ("Any action can be done yourself or
given to someone else") and against Caleb's rule for written work (give
translators more freedom and record what happened). He chose (2026-10-27)
to bring it back:
- **On every check** (passage/recordTextModel.ts `kindRowActions`), the
  version's author who holds Review gets **Review it myself** (a check that
  records gets its own action, "Back-translate it"), after the sending and
  asking buttons. Someone asked to check their own version still gets
  Review it now, as before (REV-030).
- **Alone** (`nobodyElseReviews`: Ask someone would list nobody, because
  nobody else whose role covers the language holds Review), it leads:
  first on the check's sheet with Ask someone beside it, the record's main
  button is "Do the … check" (`recordModel`, `openCheckFor` with `alone`),
  and Done's main button finishes the version and opens its next check
  (`DoneAsk` `checkNow`, the record's `checkNow` param), with Ask someone
  and Send later under it. The back translation's Done does the same.
- **Something else?** offers "I'll do this myself" to the author when the
  main button asks someone (on a team); alone, the main button already does
  it, so it is not offered twice.
- Nothing new is stored. A review of your own version is an ordinary
  `v1.ReviewRecorded` by you on a take you made, so the record and history
  already show who recorded it and who checked it, and it counts like any
  other review, checkpoints included, as an asked one always did. The server
  never refused it.
Reverse if: teams rely on checks being done by someone other than the
recorder (then a check, or a checkpoint, could say "not by its recorder"),
or people on teams check their own work instead of asking.

Amended (2026-11-02, Caleb Koster): Done's "Send later" above is now "Done,
don't ask anyone" (LAN-136, decision 199).
