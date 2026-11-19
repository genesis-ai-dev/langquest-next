# 222. The Worker signs a revocation list per organization, and phones carry it to each other

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a person whose phone was marked lost is still a live member, so the
fold does not help, and teammates would keep handing it the team's work
(plan 5.5, section 6). So the server keeps `install_key_revocations`, one
row per organization of that person with `seq` per organization, its own
table because a list worked out from current memberships would shrink when
someone is removed. Pairs `(key, person)`, not bare keys, so another person
on a shared phone is not refused because of one person's lost phone (Carl's
answer 20). The Worker signs each organization's list of the last year with
the certificate answer; the phone keeps it only once its signature checks
and its `seq` is higher than the list held (`nearbyRevoked:<org>`), and
passes it on in each session, so one trip to town protects the whole team.
`get_user_state`'s `nearbyRevokedSeq` lets a phone behind it ask at once
rather than in a day. Hello refuses a listed pair, and later-dated events
from it are refused one by one (Carl's answer 4). A revoked key's own phone
is told `{ revoked: true }`, makes a new key and drops every chain naming
the old one. Who may revoke is New password and staff only, with no admin
action on this branch (Carl's answer 23); that and `revoke_install_keys`
come in phase 4. A team that has met nobody who has been online stays
exposed.
Reverse if: lost phones keep receiving a team's work after a teammate has
been to town.

Amended (2026-11-08, Carl Sauder): a revoked key's phone that was still
signed in answered `{ revoked: true }` with a new key and got a fresh chain,
so the revocation did not stick while its session lived (final security
review). `revoke_install_keys` now also ends every session of the person's
(its body is `_revoke_install_keys`), from every caller, not only staff;
each caller signs the person in again afterwards on the phone they still
hold. A lost code taken through the password branch (`take_sign_in_code`,
builds before 59) revokes as `take_sign_in_code_v2` does, with the same
answers. Suspending an account (`suspend_account`, migration
`20261112070000_nearby_suspend.sql`) revokes the person's keys the same way,
so the list carries them and the next certificate call makes a new
discovery generation due. An access token already issued lives until it
expires.

Amended (2026-11-10, Carl Sauder): a revocation's `seq` was `max(seq) + 1`,
and the rows go with a deleted account, so when the deleted person held the
newest numbers the next revocation reused one, and every phone that held the
old list ignored the new one (pre-merge security review). The number now
comes from `install_key_revocation_seqs`, a counter per organization that a
trigger raises with every row and that deletion never lowers
(`_revoked_seq`, migration `20261112080000_nearby_revoked_seq.sql`); the
rows still go with the account, so nothing more is kept. A list may now skip
numbers, and an organization whose rows all went still says its number.
