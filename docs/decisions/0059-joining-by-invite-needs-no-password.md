# 59. Joining by invite needs no password, and whoever can invite you can get you back in

Date: 2026-10-05 · By: Caleb Koster · Status: accepted

Reason: supersedes part of 54. People invited by QR in the field often have
no email and will not remember a sign-in name or a password, so 54's join
(a name, a password twice, a sign-in name to write down) asked them for what
they would lose, and its recovery made them choose a new password anyway.
Caleb chose (2026-10-05) the direction tried in the partner demo (its
ADR-031, branch `caleb-qr-onboarding`):
- Joining by invite makes the account with no password. The `join` Edge
  Function takes the invite from a signed-out phone, makes a looked-after
  account named as the inviter typed (a group invite asks for the name),
  adds the membership through `redeem_invite_for`, and returns a session.
  It is safe to repeat: the phone sends one request id per join
  (`invite_join_requests`). The account's password is random and never
  shown; the person may set one later, for a shared phone.
- Getting back in is a helper's code that signs the person straight in
  (`sign-in-code` without a password returns a session). Whoever holds
  Invite at a scope that covers one of the person's memberships may help,
  while they hold it (`may_help_sign_in`); the steward row now only says
  who to ask. A helper can mark the old phone lost
  (`issue_sign_in_code_v2`), and the code then signs every other session of
  the account out.
- Adding a proven email ends help codes for that person
  (`take_sign_in_code_v2` refuses accounts with their own email); the
  emailed codes that prove an address come next.
Builds from before keep working: `redeem_invite_v2`, `issue_sign_in_code`
and the password path of `sign-in-code` keep their contracts. Migration
`20261005120000_join_without_password.sql`, tests `server/joinSmoke.sql`,
design in `docs/invites-and-accounts.md`.
Reverse if: people lose their way back in more often than helpers can bring
them back (then joining asks for an optional password again), or help codes
are misused (then help narrows to organization admins, as 54 said).

Amended (2026-10-05, Caleb Koster): the app side. Sign In and Create Account
put their fields first, then "or", then the scanner, and the scanner opens
its camera by itself. A one-person invite joins with "Join as {name}"; a
group invite asks the name first. The Welcome says there is nothing to
remember and who helps on a new phone; Settings says who helped and when
(kept on the phone, `signInHelp.ts`), and offers Set a password for a shared
phone (`has_password` in the account's metadata, set false by `join`). A
scanned invite is now held until the invite itself expires, or a week when
it was scanned offline, instead of 24 hours (`heldInvite.ts`): someone who
scans in a village may find a signal days later, and claims already keep it
from the next person on a shared phone.

Amended (2026-10-09, Carl Sauder): "whoever can invite you" now means
everywhere you are (75). A helper must hold, for every membership the
person has in an organization they joined themselves, Invite at that scope
and every privilege of the role; a membership someone else made for them
counts for nothing. A repeated `join` request signs the account in again
only within an hour and while it is still looked after with no password.

Amended (2026-11-08, Carl Sauder): a join can now also come through the
Worker's `POST /api/nearby/join`, taking a two-link chain, proof of the key
and the phone's own id, for a newcomer let in offline (243, 244; docs/
nearby-sync-plan.md 14.1, step 6). It makes the same kind of looked-after
account with no password, but with the id the key gives, and redeems a join
pass instead of a token (240). `supabase/functions/join` stays as it is for
current builds. A newcomer whose pass stopped is let in by an ordinary
invite: the phone posts the token to the same route with its chain, the
route calls `preview_invite` before making anything, and the token is still
the permission this entry made it. Getting back in is unchanged: after the
key's first session, a helper's code as for anyone (75 as amended). Caleb
should see this, since 59 is his entry.
