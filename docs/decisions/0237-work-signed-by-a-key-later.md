# 237. Work signed by a key later revoked is accepted when dated before the revocation, up to 50,000 events and 100 MB per revoked key

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl's answer 4: refusing everything a revoked key signed would
fail the most common case, a phone that was simply lost, so events dated
before `revoked_at` are accepted and later ones refused, per event, by the
wall part of `hlc`, in `relay_append_events`. The security review showed
that setting a phone's date back is enough to date new work before
`revoked_at`, so the rule protects a lost phone's earlier work and does not
stop whoever took it; Hello's refusal on phones holding the list does that.
So that millions of backdated events cannot take 2 GB phones out of service
for a language, Carl's answer 16 caps a revoked `install_keys` row at
50,000 events and 100 MB through the relay, counted one by one under a row
lock taken only when `revoked_at` is set, duplicates uncounted, and only
what `append_events` took counted; an event past either limit is refused
alone with a reason that reads as `NOT_ALLOWED`, so it is listed with Try
again. There is no closing date. A thief who goes first can use up the cap,
so staff raise one row's limit (`install_key_limit_raise`, which never
lowers one; `npm run nearby-keys -- raise`), and Try again then delivers.
Keys are revoked by `revoke_install_keys`, which writes the revocation list
that the certificate facts carry, from three places: New password's lost
choice (200 as amended), a helper's lost-phone sign-in code when the person
next signs in (`take_sign_in_code_v2`, Carl's answer 26), and staff, who
also end the person's sessions (`npm run nearby-keys -- revoke`). No admin
can revoke a member's phone (answer 23), and only the named person is
revoked, the list holding (key, person) pairs (answer 20).
Reverse if: field data shows backdated floods, or real work refused at the
cap more often than staff can raise it.

Amended (2026-11-08, Carl Sauder): every revocation now ends the person's
sessions, not only staff's (222 as amended), the password branch's lost
code revokes too, and suspending an account revokes its keys.
