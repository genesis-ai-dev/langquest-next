# The live check decides if a problem is there, and Linear and the card follow it

Date: 2026-11-26 · By: Caleb Koster · Status: accepted

Reason: on 2026-11-26 the ops dashboard's card for LAN-312 ("A Workers Build
failed") said "Live in Linear" and "Still here after its fix" at once, and it
had no box to talk to Claude. Caleb had closed LAN-312 on 2026-11-24, when the
failed web build of 2026-11-19 had passed. On 2026-11-26 a new web build failed
for a new cause: its Cloudflare build token belonged to a person who left the
organization. The line came back under the same watch key, so three parts
disagreed. The page counted the close in Linear as a fix with no pull request
(`lineFix` took `fixedAt` without `fixedBy`). The watch hands an ops line to
Claude again only a week after its last look. A closed issue hid the box and
took no instruction. Caleb asked for one clear rule. The rule:

1. **The live check says if the problem is there.** For a dashboard line, the
   line is on the page. Nothing else (Linear's state, a merged pull request,
   Claude's last record) can say the problem is gone while the line shows.
2. **A fix is a merged pull request that names the issue.** A close in Linear
   with no pull request is a close, not a fix. While the line waits for its
   check after a close or a fix, the card says so (`closing`, `merged`). Past
   that check, a line whose issue is closed is `back`: the card says that
   Linear closed the issue and the problem shows now, and Claude acts next
   (`apps/admin/src/pageFixes.ts` `lineFix`, `pageCards.ts` `lineWay`). The
   issue's card on User issues says the same: "Claude looks again", no fix
   yet (`withLiveLines`, `pageIssues.ts` `issueWay`). The line's card says
   "Closed in Linear", not Linear's state name ("Live"), beside the problem.
3. **Linear follows the live check.** The watch hands such a line to Claude at
   its next run, not after the week (`ops_user_issue_watch`, migration
   `20261126194500_user_issue_came_back.sql`, with each line's `settleMin`
   from `apps/admin/src/alertKinds.ts` `settleMinutes`). Claude opens the
   issue again (or files a new one), writes the card's words again for what
   is true now, and the fix team takes it first with the logs of the moment.
   A Workers Build line's logs hold its build log
   (`scripts/user-issues.mjs` `buildReads`).
4. **The box to talk to Claude is on every card.** An instruction on a closed
   issue opens it again in Linear before Claude takes it
   (`ops_user_issue_instruct`, `ops_user_issue_notes_waiting`,
   `closedWithNotes`). The card says so under the box.
5. **What Claude said before the problem came back is history.** The card
   shows a record of Claude's only when it is newer than the issue's last
   opening in Linear (`apps/admin/src/sources/ops.ts` `currentFixes`), or,
   while the issue is still closed, newer than the close (`lineCard`,
   `withLiveLines`). The card's Steps keep the old record.

Also: Claude's answer on LAN-312 on 2026-11-22 was dropped as if it carried
what a person sent. The privacy check read the dashboard line's own words in
the issue (a quote under "The ops dashboard shows") as a person's words.
Those words are the dashboard's code's, so the check leaves them out
(`quotedBySomeone`); a person's words from help mode stay in it.

Not chosen: closing an issue by itself when its line goes away (a line can go
for a part that did not answer, or come and go; a person or a merge closes
it, as now); a new Linear issue each time a line comes back (one line keeps
one card and its talk; Claude files a new issue when the cause is plainly
another problem); waiting for the week (the reason for this decision).

Reverse if: lines come and go so often that issues open and close again many
times a day. Then a line must stay past its check twice before the watch
hands it over.
