# A developer claims an issue, and each admin sees Claude's replies in one list

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-11-24) for two things on the ops dashboard. First,
more than one developer could start on the same user issue: a card did not say
that someone works on it. Second, Claude answers on many cards (an instruction
on a user issue, a question from any card or page,
`docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md`, an
instruction on a tutorial video), and an admin saw an answer only when the
admin opened that card again.

- **A claim is the dashboard's, not Linear's.** A Global Viewer taps Claim on
  an issue's card (a user issue's card, or a line's card with one Linear
  issue). The page sends `issue-claim` to the app Worker's `OpsActions`
  (decisions.md 162), which calls `ops_issue_claim()`. `ops.issue_claims`
  keeps one claim for each issue (migration
  `20261124003000_ops_issue_claims.sql`). Only the admin who claimed it can
  release it, and a second claim is refused with the reason. Linear's
  assignee does not change: the watch and its agents leave issues without one
  (Caleb, 2026-11-21), and the dashboard's admins are LangQuest accounts, not
  Linear users.
- **Every admin sees who claimed it, by display name.** The card shows
  "Claimed by <display name>", or "Claimed by you". This follows the exception
  of `docs/decisions/2026-11-21-every-dashboard-tap-shows-its-state.md`: only
  Global Viewers see it, and it never goes to GitHub or Linear. The page never
  gets the profile id, only whether the claim is the viewer's own. The card's
  record names who claimed and released it.
- **Claude's replies are in the corner, for the admin who talked.** A bell at
  the top right counts the replies the admin has not seen, and opens the list
  of the last 40 of 30 days: Claude's replies on each card the admin talked on
  (also replies to another admin there), and on each issue the admin claimed.
  A row opens its card. One read, `/ops/api/mine` (`diag.ops_mine`), takes
  the person from the sign-in the dashboard's Worker checked, never from the
  page. Opening the list sends `replies-seen`; the time of the last one in
  `ops.actions` is the admin's "seen", on every device.
- **The fix team does not read claims.** A claim tells developers. The agent
  team still skips only what Linear says is In Progress or In Review.

Reverse if: the team tracks who works on an issue in Linear (its assignee)
and wants one place for it; or the agent team must also skip claimed issues,
which would then be its own decision.

Code: `apps/admin/src/pageMine.ts`, `apps/admin/src/index.ts` (`mine`),
`apps/web/worker/opsActions.ts` (`issue-claim`, `replies-seen`).

Amended (2026-11-24, Caleb Koster): on a claimed issue the fix team assists
the developer. Caleb: "Claude fix team can suggest solutions and make PRs for
an issue a developer has claimed, but shouldn't merge on its own. Its role is
more of an assistant to the developer in that case." The fix team still
writes a fix and opens a pull request, and the gate holds it for the
developer with the reason `claimed` (`gate()` in `scripts/agent-team.mjs`).
The watch's door answers `claimed` with an issue's notes
(`ops_issue_claimed()`, migration `20261124023000_fix_team_assists_on_claim.sql`).
A pull request of the team that merges without a person becomes a draft that
waits when its issue is claimed later (the job `follow`). The last point of
the list above ("The fix team does not read claims") no longer holds.
