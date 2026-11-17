# 54. Getting in is a key the phone holds, and an account without email has a steward

Date: 2026-10-01 · By: Caleb Koster · Status: partly superseded by 59

Reason: a signed-out person who scanned a QR invite was sent to Sign In with
no account, had to find the invite again after signing up, and an invite
left in storage went to whoever signed in next. Translators in the field
often have no email, and nobody could recover a lost password, since sign-up
sends no email and the hosted project has no mail server. Every way in is
now a key: an invite key adds a membership, a sign-in key sets a looked-after
person's password. The phone holds one scanned invite with who it is for
(`apps/mobile/src/heldInvite.ts`); one redeemer above the organization uses
it, and screens only read it. Accounts made by invite without email use a
non-delivering address on `people.langquest.org` and a sign-in name; the
inviter becomes their steward (`account_stewards`), and the steward or an
organization admin can show a one-time sign-in QR (`issue_sign_in_code`,
Edge Function `sign-in-code`). Looked-after accounts cannot invite, in the
session and in `issue_invite_v3`. Invites gain a label shown to the scanner
by `preview_invite` and a use count for groups (`invite_redemptions`);
membership still enters the log as `v1.OrgMemberAdded` and
`v1.InviteRedeemed`, so no event changed. The first proposal put the
account at `inviter+name@` the inviter's domain; it was not used because many
providers do not accept `+` addresses, there is no mail server to send
resets, and it would put the inviter's address in another person's account.
Migration `20261002010000_invite_keys_and_stewards.sql`; design and flows in
`docs/invites-and-accounts.md`.
Reverse if: field teams reliably have email (then invites can require an
address and stewards are unneeded), or steward recovery is abused (then
recovery moves to organization admins only, or to proven email alone).

Amended (2026-10-03, Carl Sauder): a key also travels as an https link,
`https://next.langquest.org/invite#org=…&token=…` and `/signin#code=…`,
which a phone with the app opens in the app (universal links, app links)
and anything else opens in the web app (58). The key is after the `#`, so
no server receives it or keeps it in a log, and the web app takes it out
of the address once read. Links use the address when a build has
EXPO_PUBLIC_APP_URL (the invite email: APP_URL); otherwise the
`langquestnext://` link, and both are always read (`inviteCode.ts`).

Amended (2026-10-07, Carl Sauder): "Looked-after accounts cannot invite" is
superseded by 67; their role decides, as for anyone. Helping someone sign
in still needs an account with its own email.

Amended (2026-10-15, Carl Sauder): a looked-after account is one `join`
made, not any address at people.langquest.org. Sign-up is open, so anyone
could make a password account in that domain and be taken as looked-after
by the server, which lets helpers issue it sign-in codes. `join` now sets
`app_metadata.managed`, which only the service role can write, and
`is_managed_account` asks for it as well as the domain (migration
20261016080000; the accounts already in the domain were all made by `join`
and are marked there). The phone still tells a looked-after account by its
domain, which only changes what it shows.
