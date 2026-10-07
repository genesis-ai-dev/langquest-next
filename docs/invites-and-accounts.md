# Invites, accounts and getting back in

Status: design, 2026-10-01 (Caleb Koster). Decision 54 records it. Built in
the `invite-onboarding` branch; section 8 says what is built and what is
next. Updated 2026-10-05 for decision 59: joining by invite needs no
password, and a helper's code signs the person straight in.

## 1. What went wrong on 2026-10-01

Ryder made a QR invite: Translator, scoped to the Anglish language. Caleb
scanned it on Android while signed out, was sent to Sign In, created an
account, tapped Join, and landed on "What brings you here?" with no
organization. Ryder saw him as a member. Signing out and in changed nothing.

- **The cause.** The join worked: the membership is on the server. The phone
  could not download the organization. A phone with no local copy asks the
  server for a snapshot first, and the snapshot reads only admitted
  organization-wide members, while the event pull also admitted members of
  one language. Every sync of the org was refused, the org stayed empty, and
  an empty org routes to "What brings you here?". Fixed on its own in PR 22
  (`can_read_stream`, one rule for every read).
- **What made it confusing, and is fixed here:**
  1. A signed-out scan said "Continue to sign in", though the person had no
     account. The invite then waited in storage while they left the screen,
     and came back only if the timing worked out.
  2. After creating the account they had to find the invite again and tap
     Join, although they had already said yes.
  3. The held invite belonged to the phone, not to anyone: whoever signed in
     next on a shared phone was offered it.
  4. The app looked up "my organizations" when an account signed in. A slow
     reply that arrived after the join said "no organizations" and was
     believed.
- **Found on the way:** nobody can recover a lost password today. Sign-up
  sends no email, and the hosted project has no mail server for password
  resets. A translator who forgets their password has lost their account.

## 2. The principle

> **Getting in is always a key. An invite key puts a person on a team, a
> sign-in key puts a person into their account. The phone holds a key until
> it has been used, and the server decides what every key means.**

Everything below follows from that sentence.

- A key is one-time or counted, expires, and is checked by the server when
  used. What a QR or link says about itself is never shown as fact; what the
  server says about the key is.
- Scanning is the same act everywhere: the one scanner reads either kind of
  key, from the camera, a pasted code or a link that opened the app.
- "Holding" a key is the only state the flow has. Screens never remember an
  invite; they read the held key. Leaving a screen, signing up, losing the
  connection or restarting the app cannot lose it.
- A held invite is used by the account the person chose, never by whoever
  signs in next.

## 3. The two kinds of account

Every account has somebody who can get it back in.

| | Own email | Looked after |
| --- | --- | --- |
| Signs in with | email and password | nothing: the phone stays signed in (a sign-in name and an optional password, for a shared phone) |
| Made by | Create Account | joining with an invite, as a new person, with no password (59) |
| Gets back in through | a sign-in key sent to their email (section 8: next) | a sign-in key from anyone with their own email who can invite them where they are, shown as a QR (59) |
| May invite others | when their role holds Invite | when their role holds Invite (decisions.md 67) |
| May help others sign in | when their role holds Invite where that person is | no |
| Becomes the other kind | n/a | by adding and proving their own email (section 8) |

A looked-after account's address is `<sign-in name>@people.langquest.org`.
Nothing is delivered there: the domain has no mail server, and the app never
asks Supabase to email it. It exists because Supabase signs people in by
address. The sign-in name is the part before the `@`, made from the
person's name plus three digits (`nyibol-482`), so it is readable and does
not collide.

The **steward** is the person whose invite made the account (stored in
`account_stewards`, set by the server when that account redeems its first
invite). Since decision 59 it only says who to ask. Who may help is whoever
holds Invite (`invite_members`) at a scope that covers one of the person's
memberships, the organization or the person's language, while they hold it:
the inviter can help because they could invite there, and stops when they
leave or lose the role (`may_help_sign_in`).

### Why not `inviter+username@inviter's-domain`

That was the first idea, and it gets the important thing right: the inviter
answers for the account. The address is the part that does not hold up:

- Many mail providers, including some church and NGO domains, do not support
  `+` addresses, so the account would be unrecoverable for exactly those
  inviters.
- A password reset would arrive in the inviter's inbox as a link for a
  browser, far from the translator's phone, and this project has no mail
  server for resets at all.
- The inviter's personal address would sit in another person's account, and
  deleting either account would leave it in a confusing state.
- If the inviter changes their own email, every account they made silently
  points at the old one.

The steward record keeps the relationship without borrowing an address, and
the steward helps in person, with a QR, which works in a village with one
bar of signal and no email at all.

## 4. Data model

Server tables (no new events: membership still enters the log as
`v1.MemberAdded` and `v1.InviteRedeemed`, as before):

- `invites`: unchanged columns, plus
  - `label`: the name the inviter typed ("Nyibol Deng"), shown to the person
    scanning so they know the code is theirs, and offered as their name.
    Kept out of the log, so deleting an account never has to chase it.
  - `max_uses`: 1 for one person, up to 50 for a group (a workshop table).
- `invite_redemptions (invite_id, profile_id, redeemed_at)`: one row per
  person who used a key. Using the same key again returns the same answer.
  `invites.redeemed_by` stays as the first redeemer, for old clients.
- `account_stewards (profile_id, steward_id, since)`: who looks after a
  looked-after account. Deleting either account removes the row.

Server functions:

- `preview_invite(token)`: what a key means, for anyone holding it (also
  signed out): organization, role, language, the label, who made it, and
  whether it is usable (`ok`, `expired`, `used`, `not_found`). This is what
  the scan screen shows. Offline, the screen says only "Invitation to join
  an organization", as today.
- `issue_invite_v3(…, label, max_uses)`: anyone whose role holds Invite at
  the scope. It refused looked-after accounts until decision 67.
- `redeem_invite_v2(token)`: the same contract, now counting uses and
  recording the steward. Idempotent per person.
- `sign-in-code` Edge Function: a helper makes a one-time key for a
  looked-after member (`issue_sign_in_code_v2`, checked by
  `may_help_sign_in`, valid one hour, optionally marking the old phone
  lost). The person's phone sends the key, and the function signs them in
  with Supabase's own one-time sign-in token, made and used on the server
  and never emailed, and returns the session and who helped. A key marked
  lost signs every other session of the account out. Builds from before 59
  send a password with the key; the function then sets it, as before.
- `join` Edge Function (59): a signed-out phone sends an invite, a request
  id and, for a group invite, the person's name. It makes the looked-after
  account (a random password nobody sees), adds the membership with
  `redeem_invite_for` (redeem_invite_v2's body for a named account, service
  role only), and returns a session. A repeat of the same request id
  (`invite_join_requests`) signs the same account in again.

Phone state: one value, the **held key**, in `AsyncStorage` under
`held-invite`:

```ts
{ token, orgId?, heldAt, claim: 'unclaimed' | 'next-account' | <profileId> }
```

`apps/mobile/src/heldInvite.ts` is the whole rule, pure and tested:

- `unclaimed`: scanned, nobody has said who is joining. A signed-in person
  is asked "Join as you?"; nothing joins on its own.
- `next-account`: a signed-out person chose "new person" or "I have an
  account". The next account to sign in on this phone takes it.
- `<profileId>`: that account joins, now or when the phone is next online.
- A held key is dropped after it is used, when the server says it is
  expired, used up or unknown, or when the invite expires (a week after it
  was scanned, if the phone never reached the server; it was 24 hours
  before decision 59).

## 5. Flows

Each is the whole sequence the person sees.

**A. Signed out, scans an invite (the field case).**
Scan → "Invite for Nyibol · Translator · Anglish · Ryder's Translation
Organization · from Ryder" → **Join as Nyibol** (primary) → the `join`
function makes the account and the membership, and the phone is signed in
→ Welcome: "Ryder invited you. You're a Translator on Anglish." Nothing to
remember: on a new phone, they ask for help (F). A group invite asks for
their name first. (Before 59: a name, a password twice, and a sign-in name
to write down.)

**B. Signed out, already has an account.**
Scan → same card → **I already have an account** → Sign In, with a line
"After you sign in you'll join Ryder's Translation Organization" → Welcome.

**C. Signed in, scans an invite.**
Scan → card → **Join as Caleb** → Welcome. Underneath: "Not Caleb? Sign out
first", which signs out and keeps the key for the next person (flow A or B).

**D. A link opens the app** (tapped in a message, or Android's camera).
The key is held, and the scan screen opens on the card: flow A, B or C.

**E. Offline.** Scanning works offline. The card says "Saved. You'll join
when you're connected" for an existing account; a new person needs a
connection to create the account, and the button says so. The key stays
held across restarts until it can be used.

**F. New phone, reinstalled, or signed out (looked-after account).**
A helper opens Members → the person → **Help them sign in** (with "Their
old phone is lost" when it is) → a QR. The person taps **Scan a code** on
Sign In → signed in, with nothing to type; their Settings says who helped.
(Before 59: they chose a new password.)

**G. Lost password (own email).** Section 8: a sign-in key emailed through
the existing Cloudflare email worker, using the same `sign-in-code`
function. Until then, a steward or admin can do F for them only if the
account is looked after; own-email accounts have no recovery yet, which is
today's state.

**H. Adding your own email (looked-after → own).** Section 8: Settings →
Add your email → a sign-in key sent there proves it → the address changes
and the steward row is removed.

## 6. How each situation falls out

| Situation | What happens | Why, in the model |
| --- | --- | --- |
| Caleb's case: one-language invite, signed out | A, lands on Welcome in that language | PR 22, and the key is claimed by the new account |
| Leaves the scan screen, signs up elsewhere | Still joins | The key is held, not the screen |
| Translator without email | A: a looked-after account | Section 3 |
| A new phone, or signed out | F, from anyone who can invite them where they are | Every account has someone who can get it back in |
| Phone lost or stolen | F with "Their old phone is lost": the old phone is signed out | The code ends every other session (59) |
| Inviter leaves the organization | They can no longer help; anyone else with Invite there can | `may_help_sign_in` follows current roles (59) |
| The reply to Join is lost | Tapping Join again signs the same account in | One request id per join (59) |
| Shared phone, several translators | Each can set a password for it; signing out keeps nobody's key | Claims bind to one account |
| Signs out of a shared phone with work unsent | Signs out anyway; the work still goes, as them, when the phone is online | The hand-over keeps their session only until it has gone (60) |
| Someone else signed in when a key is scanned | Asked "Join as X?", with "Not X?" | `unclaimed` never joins on its own |
| Scans the same code twice | Joins once, the second scan says "You're already in" | Redemption is idempotent per person |
| Someone else's used code | "This invite has been used. Ask for a new one." | `preview_invite` says `used` |
| Expired code | "This invite has expired. Ask … for a new one." | Server status, key dropped |
| Already a member, new invite for another role | Adds that role | A membership is per scope; the server keeps both |
| A workshop of 20 | One group QR with 20 uses | `max_uses` |
| Scans offline | Saved, joins when online | E |
| Edited or forged link | Shows only what the server says the token means | `preview_invite`; the link carries the token alone |
| Looked-after account tries to invite | No Invite button; the server refuses too | The privilege is removed in the session and in SQL |
| Account deleted | Memberships end as before; steward rows go | Foreign keys cascade from `auth.users` |
| The invite's role was retired | "This invite can no longer be used" | Server check, unchanged |

## 7. Requirements from the brief, and what became of them

- **Inviter-managed accounts for people without email.** Kept, as stewards
  (section 3), with a non-delivering address instead of `inviter+name`.
- **Inviting is a role permission.** Already true: `invite_members`
  (decision 23). Looked-after accounts never hold it, whatever their role.
- **Only email-verified users can invite.** Looked-after accounts cannot
  invite now. Sign-up does not prove an address today (confirmation is off
  and there is no mail server), so "verified" cannot mean anything yet.
  Section 8 adds proving an address with an emailed sign-in key, then the
  rule tightens to proven addresses.
- **Signed out: new account first, existing account second.** Flow A and B.
- **Signed in: join with the current account.** Flow C, with a guard for
  shared phones.

## 8. Built here, and next

Built in this branch:

- The held key and its rule (`heldInvite.ts`), one redeemer, and the
  organization lookup race fixed.
- Flows A to F; the scan screen reads both kinds of key.
- `preview_invite`, labels, group invites, `invite_redemptions`,
  `account_stewards`, the invite refusal for looked-after accounts (lifted
  by decision 67), and the
  `sign-in-code` function for stewards.
- Sign in by sign-in name.

Next, because they need email delivery through the Cloudflare worker
(`apps/invite-email`) and so a deploy of their own:

- G, H, and proving an address; then "only proven addresses may invite".
