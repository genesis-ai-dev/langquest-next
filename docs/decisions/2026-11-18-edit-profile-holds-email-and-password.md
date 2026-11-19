# Edit Profile is the one place to add or change an email and a password, and an email is no more proven there than at sign-up

Date: 2026-11-18 · By: Carl Sauder · Status: accepted

Reason: partly supersedes 59. LAN-304: an account made without an email
(a looked-after account, 59) had no way to add one later, nobody could
change their email, and a password could be set in two places (More
settings' "Set a password" row, which opened Edit Profile, and Edit Profile
itself), both worded as if a password were only for a shared phone, which
stopped being true when it became the way into another device and back into
this one offline (168). Carl asked for all of it under Edit Profile. 59 and
flow H of `docs/invites-and-accounts.md` planned for an added email to be
proven by an emailed code first; Carl chose (2026-11-18) that changing an
email is no stricter than signing up with one, and sign-up proves nothing
(Auth's confirmations are off). He also chose that a password is typed
twice everywhere one is set, and that an account with no password must
choose one with its first email. What was built:
- **Edit Profile** (`apps/mobile/src/screens/profileEdit.tsx`, rules in
  `src/account/profileModel.ts`) has the name, an email field and a
  password field for every account but someone let in offline, who has no
  account until first contact. It is a module of its own, loaded the first
  time it opens, which keeps the web app's first visit inside its budget
  (`scripts/export-web.mjs`). The email field starts with the account's own
  email, or empty for a looked-after one. The password field sets a first or
  a new password with the session alone, as it did for a looked-after
  account; no current password is asked. Once something is typed, "Confirm
  password" comes below it, with Create Account's words, and Save refuses
  while the two differ. The name still saves offline; the email and the
  password need a connection, and what was saved before one of them failed
  is said to be saved.
- **New password** (Forgot password's link, 200) asks twice too, so
  Create Account, New password and Edit Profile all do.
- **A password comes with the first email** of an account that has none
  (`has_password` false, set by `join`): the field's label loses
  "(optional)" and Save refuses without one, since an email ends helpers'
  codes and, never proven, a mistyped address would leave no way back in.
  The phone sets the password first, through the person's own session, then
  the email: Auth keeps that session, whereas a password set with the
  service role ends every session of the account (seen on the local stack),
  and if the email then fails the account still has its sign-in name and
  the new password. The function refuses an email for an account still
  without a password (`password_required`).
- **The `change-email` Edge Function** (`supabase/functions/change-email`)
  sets the signed-in caller's address with the service role and marks it
  confirmed, since a change made through Auth would ask Auth to email both
  addresses (`double_confirm_changes`) and this project sends Auth no mail.
  It refuses something that is not an address, a looked-after address
  (`@people.langquest.org`, made by the server), and one another account
  has (`email_exists`, which tells the caller that address has an account,
  as Create Account already does). It asks `email_taken` (migration
  20261118160000, service role only, smoke `server/emailTakenSmoke.sql`)
  first, in any case: Auth answers a taken address with only "Error
  updating user", and its unique index lets the same address in capitals
  through. An email cannot be taken away.
- **A looked-after account that adds an email becomes an own-email
  account** (`is_managed_account` reads the address): it signs in with the
  email instead of its sign-in name, helpers' codes stop
  (`take_sign_in_code_v2`, 59), Forgot password reaches it (200), and its
  steward row, which only said who to ask, goes.
- **The phone follows the change.** `setAccountEmail`
  (`src/account/accountAuth.ts`) renews the session so `ctx.session.email`
  and `isManaged` change at once, and moves the offline lock to the new
  address (`rememberAddress` in `src/server/lock.ts`), so a password typed
  beside it on Sign In opens it offline; a pattern is untouched.
- **More settings loses "Set a password"** and the edge to Edit Profile
  (`flow.ts`); Me's name row is the way in, and its line now says "Name,
  email and password" (it said "Name and photo"). "A phone of mine was lost
  or taken" stays in More settings: it is for a lost phone, not routine
  changes. The words that tied a password to a shared phone are gone, in
  all 16 languages (the 15 others machine-translated, 81), and the "Your
  account" tutorial shows the two fields.
What it gives up: an address is not proven, so a typo leaves an account
whose Forgot password emails someone else, and a person may take an
address that is not theirs, keeping its owner from signing up with it until
they ask us. Someone holding a signed-in phone can change the account's
email and password, and Forgot password then goes to the new address; the
app lock (253) is what guards a phone left signed in. Nothing new is
collected (an email was already, optional, `docs/play-store-declarations.md`).
Tests `apps/mobile/test/profileModel.test.ts`, `accountEmail.test.ts`,
`lockFlow.test.ts`, and the UI tests ACCT-059 to ACCT-061
(`e2e/ui/11-account-email.spec.ts`).
Reverse if: accounts are taken over through a changed email, or people
lock themselves out with a mistyped address often enough to matter (then
prove the address with an emailed code, as the blue check does, 173, and
ask for the current password before a change). Caleb should see this,
since 59 is his entry.
