# 240. A join pass lets a member let a new person in offline, one pass to a window, and it stops only by itself

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl chose (plan section 2) that a new person can join offline, on
Android, in a later phase (docs/nearby-sync-plan.md section 14). A phone
that may let someone in holds a *join pass* for each language its person
can invite to, in the certificate answer (`nearby_certificate_facts`
gains `passes`; the phone keeps them in `nearbyPasses`, replaced whole as
chains are). The Worker issues one only while the organization has both
`nearby` and `nearby_join` on, its own feature granted separately in
`org_features` (Carl's answer 11). A pass names the organization, language,
inviter and inviter's key, the roles allowed, 10 uses (`JOIN_PASS_USES`)
and an expiry. One id per organization, language, inviter, key and 90-day
window, derived by the Worker, expiring at the window's end (answer 17), so
the daily refresh makes no new uses. Nothing is written at issue, since
`issue_invite_v3` appends an event for each invite and a row per inviter,
language, role and sync would grow the immutable log without end: the first
use at the server makes the invites row under `token_hash = 'pass:' ||
passId`, which no token can reach, and its `v1.InviteIssued`, then redeems
through `_redeem_invite_row`, the body of `redeem_invite_for` split out with
the link's role, so `redeem_invite_for` keeps its results for store builds
(152). Roles: only those with no privilege in core's `MANAGE_PRIVILEGES`
whose privileges the inviter holds (answer 8), so a local person never holds
a role that makes other hooks write organization events, and an admin can
raise the role after first contact. Looked-after accounts hold passes (answer
18): Invite goes by permissions alone (67). A pass stops automatically only
(answer 9, and the security review): past expiry or uses, the inviter lost
Invite or that role, the role retired or gained a manage privilege, the
inviter's key revoked, or either feature off. There is no withdraw button,
so for a taken phone the key's revocation is the stop that holds.
`pass_refusal` asks the same stops read-only before any account is made, and
`redeem_pass_for` answers a person who already redeemed this pass first, so
a repeat answers after the uses run out. Migration
`20261112050000_nearby_join.sql`, `server/nearbyJoinSmoke.sql`.
Reverse if: teams leaving town often hold a pass with days left (section 13
asks whether to hold the next window's too), or passes are misused faster
than their stops catch.

Amended (2026-11-08, Carl Sauder): a suspended inviter's pass stops too:
`pass_refusal` answers 'pass inviter suspended' while `banned_until` is
ahead (final security review), and suspending revokes the inviter's key, so
the pass stays stopped after they are let back.
