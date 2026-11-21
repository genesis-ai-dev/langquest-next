# A user issue's card is short: Wrong, Known and Next, the rest behind Details, and Claude answers first

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-11-21, thread "Make user issue cards short and clear")
read the card of a slow-play issue on the User issues page and called it
"confusing and unnecessarily verbose. Big and a lot going on. Saying a whole
lot of nothing." The card said the same fact four times (the 3-box diagram,
What happened, What goes wrong, The fix), said "not proven" three times, and
never said what the records show and what they do not. Under his
instruction "You must prove the cause", Claude's answer did not answer him:
it did not say that the app times the full wait and the link signing, but
not the 3.3 s between them. Decided (`apps/admin/src/pageIssues.ts`
`shortCard`, `pageCards.ts`, `.agents/skills/user-issues/SKILL.md`):

- **The card's face has three lines**: Wrong (`problem`), Known (`known`, new)
  and Next (the pull request, or `solution`, or what the page knows). Then the
  buttons, then the talk with Claude. The meta line under the title names the
  step in words ("No fix yet").
- **One Details tap holds the rest**: the diagram or the pictures, the five
  steps as dots, What happened (`context`), the records' keys and the Linear
  state, and What Claude did with Claude's reasons. The same holds on a
  line's card for an issue (Overview rows).
- **A new line, `known`**: what the records show and what they do not, with
  the numbers. The watch writes it when it files an issue
  (`ops.user_issues.known`, migration `20261121231500_user_issue_known.sql`,
  checked like the other lines in `server/userIssues.ts`). An issue filed
  before it has no Known line, and the card leaves it out.
- **Claude's answer on a card starts with the answer** in one sentence (yes,
  no, the fact asked for, or what Claude did), then at most two sentences on
  why, with no repeat of the card's lines or the admin's words; at most 400
  characters unless the admin must run steps.

This amends the card layout of
`docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md` for user
issues only; the cards of the Tutorial videos page keep their layout.

Rejected: a time bar diagram for each slow-step issue (green: the part the
app times; red: the part it does not). Caleb asked for the short card first,
without it.
