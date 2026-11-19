# 21. Blockers are derived, like status

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: reachability proves a screen exists, not that the work can finish.
A required step with no eligible reviewer, or an assignee who was removed,
leaves a passage waiting forever with nothing on screen saying why. These
are properties of the fold, so `deriveBlockers` computes them and the status
screen can show the one action that clears each. Reverse if: never.

Amended (2026-10-06, Carl Sauder): `deriveBlockers` and the blocker rows went
with the role-based v1 workflow model (63). The record model says what a
passage waits on (`waitingOn`) and what concerns a person (`updatesFor`),
which the Inbox and the server's notifications both read.
