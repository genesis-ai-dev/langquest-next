# 114. How someone joined is the server's to say

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `v1.InviteIssued` and `v1.JoinDecided` were open through
`append_events` to anyone holding `invite_members`, though only
`issue_invite_v3` and `decide_join_request` append them, as the server.
A security audit found that `_joined_by_consent` counts any accepted
`JoinDecided` naming a person as their consent, and `may_help_sign_in`
lets a helper issue a sign-in code for a looked-after account that joined
by consent, so an organization's admin could forge the consent that rule
asks for. Both are now server-only, as `v1.InviteRedeemed` was: null in
core's `EVENT_PRIVILEGE` (`packages/core/src/org.ts`) and in SQL
`event_privilege` (migration 20261016030000). The RPCs keep their own
`invite_members` checks and are unchanged; no client emitted either event.
Server smoke: a lead's own JoinDecided and InviteIssued are refused.
Reverse if: a client must issue invites or decide requests offline; then
`_joined_by_consent` must instead require a matching row the server wrote.
