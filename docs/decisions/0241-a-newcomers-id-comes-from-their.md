# 241. A newcomer's id comes from their key, and the code they scan holds no pass or key

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a newcomer has no account when they are let in, so their phone
makes a new install key and a 16-byte `idSalt` and derives its profile id
from them (docs/nearby-sync-plan.md 5.12, Chains), keeping them with the
join's progress, so a dropped link or another inviter gets the same id.
`checkChain` recomputes the id from the key, so a chain cannot name an
existing member, an imported v2 person who has not signed in yet, or anyone
else: an imported person has live memberships and no `auth.users` row, and
without this a chain could claim their id and inherit every role. The
inviter's Let someone in shows a QR holding only how to reach the phone, a
one-time secret and a pin on its opening (`langquestnext://join?...`), and
no pass or key (Carl's answer 21), because a photo of the QR gives anyone
all they need to get that far, and the discovery key cannot be taken back
once it is out. The pass, its chain and the key travel only after the
inviter's one tap beside two of decision 168's pictures worked out from the
link (`joinPictures`), which both phones show, so a QR holder who connected
first and typed the expected name is caught. `parseKey` reads this third
kind of key, and a newcomer joins only on a phone with nobody on it, because
a local person makes Sign In unreachable for everyone signed out there (168).
Reverse if: field tests show the pictures do not catch a wrong phone, or a
newcomer's key is lost often enough that an id they could recover is worth
what it costs.
