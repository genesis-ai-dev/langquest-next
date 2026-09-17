# PR #4 gap review and implementation plan

Reviewed 2026-09-17 against remote main at `119c66f` and the current local
workspace. Local HEAD is `515913e`, with additional uncommitted changes.
Local implementation does not prove deployment or successful user journeys.

PR: https://github.com/ryderwishart/langquest-next/pull/4

## Findings

PR #4 removes the duplicate Inbox task list and hides its tab when there
are no decisions. However, its new decision navigation has two problems:

- Remote `flow.ts` does not declare `inbox_home -> piece_review`.
  `App.tsx` rejects undeclared navigation to screens outside the bottom tabs.
- The link supplies `takeId`, `stepId`, and `actorId`. `PieceReview` reads
  `takeId` and `round`, where `round` contains `stepId:actorId`.
  Adding the edge alone still leaves the destination without a review.

These findings come from source inspection, not a device reproduction.

The local implementation needs deliberate reconciliation with this PR.
`deriveInbox` currently derives open tasks, decisions, and blockers.
`InboxHome` renders them under "Your work", restoring the task duplication
that PR #4 removes. Local decision rows also route through translation tasks
instead of opening the review detail.

## Recommended implementation order

1. **Repair the decision journey and protect it with a behavior test.**
   Declare the navigation edge and use one review route contract. Carry
   enough context for the reviewed-version link and back navigation.
   Acceptance: tapping an approval or suggestion opens that exact review,
   then its version; no blocked navigation or "Review not found" state.

2. **Reconcile Inbox and notification semantics across local and remote code.**
   Keep My Work as the actionable task list. Inbox should show addressed
   updates, rather than every outstanding task on every visit. Decide whether
   assignment and review-request updates appear as discrete notifications.
   Align worker output, offline fallback, visible rows, and tab counts.
   Acceptance: no duplicate task board; join-request-only admins can reach
   Inbox; notification reads and offline restarts preserve consistent state.
   Specify whether the tab count means available rows or unread rows.

3. **Finish and verify the existing account and onboarding implementation.**
   Local code already implements display-name editing, organization listing
   and switching, public discovery, queued access requests, QR scanning,
   and organization creation. Do not replace these with hidden controls based
   on the older follow-ups document. Verify persistence, offline retry,
   rejection feedback, organization isolation, and navigation after switching.
   Profile photo support remains separate from display-name editing.
   Organization creation currently seeds a Luke project and sample passages;
   plan an explicit production setup flow rather than implicit demo content.

4. **Complete notification delivery as an operational feature.**
   Local projection and push worker code exists, including an uncommitted
   edge entry point and mobile notification helper. Verify deployment,
   scheduling, retries, duplicate suppression, and push receipt handling.
   Preserve exact review/request targets and navigate after cross-organization
   loading completes. Verify push-tap navigation with the app closed.
   Acceptance: a real request reaches an eligible admin; a real review reaches
   its author; both open the correct destination online and after reconnect.

5. **Remove the legacy progress route chain.**
   Replace task-card progress navigation with contextual `piece_status`,
   preserving unit and lane. Reserve `status_home` for the overall map.
   Remove obsolete screens, registry entries, edges, and test expectations.
   The original follow-up mixes `status_home` and `piece_status`; resolve
   that distinction before implementation.

6. **Close the remaining product-depth gaps.**
   Revalidate the audit's remaining work: organization summaries and audits,
   invite email delivery, audio responses and review comments, audio material
   fields and term adjustments, key terms as content, and assignment scope
   beyond one unit. Treat this as backlog verification, not a claim that every
   item remains wholly absent in the newer branch.

7. **Add interaction and visual regression coverage.**
   Test decision navigation, conditional Inbox visibility, offline account
   retry, organization switching, and task-card progress navigation first.
   Add representative Avatar U/P visual checks afterward. Component-name and
   prose-length checks alone cannot establish the one-primary-action design.

## Audit reconciliation

The original G1-G12 inventory describes an earlier implementation. Section 6
of `docs/flow-coverage-audit.md` already marks org roles, catalogs, review
teams, response events, reference materials, and key terms as implemented
or partly implemented. Do not plan these again as new foundational work.

PR #4's `docs/ux/follow-ups.md` is useful for UX intent, but its stub claims
and short effort estimates do not describe the current local implementation.
Re-estimate after integration and user-journey verification.

This review changes documentation only. It does not merge branches, modify
application code, run the app, or verify the deployed database and worker.
