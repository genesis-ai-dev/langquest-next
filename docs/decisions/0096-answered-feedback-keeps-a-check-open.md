# 96. Answered feedback keeps a check open until its reviewer says it looks good

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: a check that asked for changes counted as complete as soon as the
translator answered it (a new version, or keeping it with a reason). Core
`isCompleteState` counted `addressed`, so the new version was never offered
to the check again unless someone asked, though the record told the
translator "Then it goes back to the check". The UI test suite found it
(JRN-002, JRN-011). Answering is not a verdict, so the check stays open:
`addressed` is no longer complete, the step is not done, and its reviewer is
offered the new version. A checkpoint already worked this way (72).
- The passage record shows the step as open, "answered · back to the check"
  (`passage/record.ts`, `pathModel.ts`), not ticked green. Older versions
  still show what they heard (`oldStepState`).
- `done` in reports and the API (70, 72) follows: a passage whose last
  feedback was answered is not done until the check passes it.

Reverse if: teams find re-checking every answered note slows them more than
the missed second look costs. Then let a flow mark a check as one that an
answer completes.
