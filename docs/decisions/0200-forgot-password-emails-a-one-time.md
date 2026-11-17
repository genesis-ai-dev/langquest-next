# 200. Forgot password emails a one-time link to the account's own address; the link opens New password, which sets it and signs in

Date: 2026-11-03 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-17): "Can you check if we have a full password reset
flow in the app? If we don't, can you implement it?", and an eye on the
password fields; on 2026-11-03, "Let's fix the password reset", after three
people had a password refused in a week and one of them made a second
account. There was none: an account with its own email that forgot its
password had no way back but a teammate's code or writing to us ("Can't
sign in?", added by the UI audit until people could reset their own;
docs/invites-and-accounts.md flow G). What was built:
- **Sign In → Forgot password? → an email.** `supabase/functions/password-reset`
  keeps a one-time code by its hash (`password_resets`, migration
  20261103160000) and the email Worker's `/send-reset` sends
  `https://next.langquest.org/signin#reset=<code>` in the language the app
  showed, with the reset words written for LAN-42. The link is on `/signin`,
  which the app links already declare, so no new build is needed: Android
  opens the app; iOS (associated domains are still off, 58 amended) and
  computers open the web app. A code works once, for an hour. Asking again
  does not cancel an earlier link, since on a slow connection the first
  email often arrives after the second request; using one ends the
  account's other codes.
- **The same answer whether or not the address has an account**, so typing
  addresses does not tell anyone who uses LangQuest. Every request is
  counted before anything is looked up: 5 an hour for one address (kept by
  its hash), 30 an hour from one caller, 300 in five minutes overall. An
  address with no account here goes to LangQuest v2, which sends its own
  reset email as its app does: someone from v2 who has not signed in here
  yet signs in with the password they choose there (docs/v2-import.md
  section 3).
- **New password sets the password and signs in** in one call, the session
  coming back with the answer as `sign-in-code`'s does, so one moment of
  connection is enough (`resetPassword` in `auth/signInFlow.ts`). Already
  signed in as that account, the phone keeps a fresh session; signed in as
  someone else, only the password changes. The phone remembers the new
  password for signing back in offline (168). Setting a password ends the
  account's other sessions (Supabase Auth, as 87 notes); their unsent work
  waits on those phones for the next sign-in (60).
- **No email, no email reset.** A sign-in name on Forgot password says the
  account has no email and offers Scan a code, for a helper's code (flow F,
  59). "Can't sign in?" stays for the ways in that need no password.
- **Every password field has an eye** (kit `Field` with `secure`) that shows
  what was typed and hides it again: a 48 pt button with its own help.
Nothing in production's Auth settings changes: no redirect URL, email
template or mail server is used. The function, the migration and the Worker
deploy on merge (42) with the secrets they already have.
Reverse if: people cannot finish within the hour on field connections (then
lengthen it, with the email's words), or v2's own reset emails confuse
people (then stop passing unknown addresses to v2).

Amended (2026-11-08, Carl Sauder): New password can revoke the person's
nearby install keys, for "A phone of mine was lost or taken"
(docs/nearby-sync-plan.md section 6, decision 237): `password-reset`'s
`choose` takes an optional `lost`, which builds before it never send, and
calls `revoke_install_keys` before setting the password, giving the code
back if that fails so the person can retry. The authority is the mailbox,
not a session, so a taken phone cannot use it against its owner's new
phone, and setting the password already ends the account's other sessions.
It is opt-in, because revoking on every forgotten password would refuse
newcomers that person let in. On this branch only the server and the app's
`passwordReset` call take `lost`; the choice on New password and the More
settings row that sends the link are not built yet, and need their words in
every app language and the demo's look. Caleb should see this, since 200 is
his entry.

Amended (2026-11-08, Carl Sauder): the choice and the row are now built.
New password has "A phone of mine was lost or taken" as a switch row, off
unless turned on, whose line says teammates' phones stop trusting that
phone's work dated after now and the person's other phones need a new
sign-in to share nearby; turned on, the call sends `lost: true`, and off it
sends what builds before it sent (`newPasswordBody` in `auth/model.ts`).
More settings has a row of the same name for an account with its own email,
which only emails the Forgot password link, with no confirm since a link
changes nothing until it is used. Both are in all 16 app languages, the 15
others machine-translated. They show on every platform, since the person
may reset from a computer or an iPhone for a lost Android phone.
