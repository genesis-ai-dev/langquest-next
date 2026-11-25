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

Amended (2026-11-24, Carl Sauder): a newcomer stays accepted for 90 days
from being let in, not until the pass expires. Every pass expires at its
window's end, the same date for every pass, so someone let in the day before
was refused the day after by every teammate at Hello, and at first contact
(review of 2026-11-24, item 1). The inviter's phone now signs `madeAt`, when
it made the invite link by the clock Hello checks with, into the link's
body. Teammates and the server accept the newcomer while `madeAt` is not
past the pass's `expiresAt` and now is within 90 days of it
(`NEARBY_NEWCOMER_MS`), so every newcomer gets the same 90 days whatever the
calendar. It is an optional field of `invite@1`, not a new `invite@2` kind:
the whole body is signed, so a teammate on an older build still accepts the
newcomer until the pass expires, where it would refuse an unknown kind
outright, and a link with no `madeAt` (an older inviter's) lasts as before.
The Worker passes it as `p_made_at` to `pass_refusal`, `redeem_pass_for`,
`nearby_join_state` and `nearby_join_finish`, and a pass's own invites row
no longer refuses by its expiry (`20261124230000_nearby_newcomer_life.sql`).
An inviter whose clock runs ahead can give a newcomer at most 90 days past
the pass's expiry, since `madeAt` past it is refused. Answering section 13,
in a window's last 30 days a certificate answer holds the next window's
pass too (`passWindowTimes`), the very pass the next window gives, so a team
leaving town late in a window can still let people in, at the cost of up to
20 uses in that time. Let someone in uses the pass in effect, checks it on
Hello's clock, says how many days this phone can still let people in, and
warns under 30; Hello's refusal is recorded as `pass-expired`, not `other`.
Reverse if: newcomers often need longer than 90 days to first reach the
server, or the extra uses of a next window's pass held early are misused.

Amended (2026-11-24, Carl Sauder): the inviter's phone counts whom it let
in under each pass, and stops at the pass's `maxUses` (review of 2026-11-24,
item 7). Uses were counted only by the server at first contact, so an
eleventh newcomer was let in, then cut by teammates, who each keep the first
ten keys they meet under a pass, differently on each phone, and refused at
first contact. A pass is used only by the phone that holds it, so its count
is exact: the people let in are kept per pass, by id
(`nearbyLetIn:<org>/<language>`), written before the grant is sent, so a
grant that never arrives costs a use here, never one past the count, and the
same person again is still one use. At the count the session turns the next
newcomer away before the tap (`pass used up`), and Let someone in shows no
code and says so, offering a pass with room first, so the next window's pass,
held in this one's last 30 days, takes over. The list says who joined the team
through this phone, so it goes at any sign-out with `nearbyPeers` and
`nearbyMet`: a pass's count starts again only if the same person signs in
again on this phone while the pass still holds, and the server still refuses
past the count at first contact.
