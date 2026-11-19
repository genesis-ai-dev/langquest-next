# 168. Signing out of a phone locks the sign-in on it, and a picture and pattern, or the password, opens it again offline

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: amends 60 and 87. Every way into the app needed the server (a
password, a helper's code, an invite), so someone who signed out offline
could not get back in, or reach the work kept on the phone, until it was
online, which in the field can be months; on a shared phone nobody else
could get in either. Caleb said (2026-10-12) that signing out and back in
must both work offline: field users will tap Sign Out, and in countries
where Christians are persecuted they may do so on purpose before a phone is
taken. Of the options put to him then he chose an encrypted lock with no
names on Sign In, a swipe pattern rather than digits, and a picture for each
person to find themselves by. That work (pull request 90) was merged into a
branch that had already reached main, so it never shipped; Caleb asked
(2026-10-26) for it on main, with nothing lost and nobody signed out. Little
research covers low-literacy users: less-literate smartphone users already
lock their phones with a PIN or a pattern; patterns are faster and liked,
PINs give fewer errors; text-free designs suit non-literate users. A pattern
needs no reading and no numbers, in any language. Chosen:
- On a phone, Sign Out seals the person's session (AES-256-GCM) with a
  random data key the phone keeps for them while they are signed in, and
  keeps that key only wrapped under their password and, if they drew one, a
  pattern (PBKDF2-SHA256, 10,000 rounds stored per wrap; `@noble/hashes`,
  `@noble/ciphers`) (`apps/mobile/src/auth/sealModel.ts`,
  `apps/mobile/src/server/lock.ts`; the web build takes `lock.web.ts`, which
  does nothing). The lock, the key and the sealed session
  live in the Keychain or Keystore with the session (60, amended
  2026-10-15). It asks the server nothing and no longer ends the session
  there. Neither the password nor the pattern is stored; an email or sign-in
  name is kept only as a hash salted per phone. The rounds are few on
  purpose: plain JavaScript is slow at them (50,000 took 15 seconds on the
  simulator's debug build, 10,000 took 3), and against a copied lock the
  patterns fall whatever the count. The stretching pauses on a timer, so
  "Signing in…" shows and the screen does not freeze.
- The password wrap is made on every online sign-in with a password and
  when a password is set (`rememberPassword`); the same password typed
  again brings back the key it wrapped, so a pattern stays good. Someone
  with no password here (a QR join, a helper's code, or signed in before
  this build) chooses a picture and draws a pattern twice when they first
  sign out; anyone may add or change one there. Two people on one phone
  never share a picture (sixteen things known everywhere, drawn by the
  phone's emoji font); they may share a pattern, since the picture says
  whose lock to open.
- A pattern joins at least five of nine dots, as on the Android lock screen
  (`apps/mobile/src/auth/patternPad.tsx`): dragging and lifting finishes it;
  tapping the dots one at a time and then Done works too, which is also how
  a screen reader enters one.
- Sign In tries a typed password against the lock before the server. While
  someone here can come back with a pattern it shows their pictures, never
  names: tap yours, then draw (`signBackIn`). Wrong guesses count for that
  person's lock: four are free, then each try waits twice as long, from a
  minute up to an hour. Words that explain any of this are in help mode,
  not on the screen.
- Unsent work stays as 60 has it: a hand-over still sends it as its author
  when the phone is online, and its kept session is sealed too. Coming back
  takes the session back from the courier (`takeBackHandOver`); after the
  courier is done the session stays sealed for its owner instead of being
  ended. A session the server ended takes the lock's copy with it.
- Signing in again here by any other way drops an older sealed session of
  theirs (`signedInHere`). A browser forgets everything on sign-out (11), as
  before.
What it guards against: the next person on a shared phone, and someone who
takes the phone and tries patterns in the app. Someone who gets past the
Keychain or Keystore and copies the lock can try all of about 390,000
patterns as fast as their computer allows, so a pattern then holds for
hours, a long password much longer; a pattern is also easier to see over a
shoulder than a PIN. A helper marking the phone lost (59) ends the session
on the server the next time the phone is online. Nothing new leaves the
phone, so no store answer changes (`docs/play-store-declarations.md`).
Tests `apps/mobile/test/lockModel.test.ts`, `lockFlow.test.ts`,
`handOverSend.test.ts`.
Reverse if: people forget their pattern more often than they come back with
it (then offer a helper's code first), or a locked phone is opened by
someone it does not belong to (then a larger grid, or a server-held key).

Amended (2026-10-30, Caleb Koster): someone with an account could not join
another organization or language with it by scanning. Signed in, nothing
led to the scanner, so people signed out to scan, and Scan's Join made a
new account with no email (LAN-197). Switch Organization now offers "Scan
their code" and "Find your organization" (the cards of Join your team)
above New organization, and Scan, joining as the account signed in, adds it
to that organization too. Signed out on a phone where people signed out
before, Scan shows their pictures under "Who is joining?": tap yours, draw
the pattern, and the invite joins that account; "Someone new" makes a new
one, and "I already have an account" still signs in with a password first.
Pictures, never names, as above.

Amended (2026-11-07, Carl Sauder): Carl chose (his answer 5, 2026-11-06)
that on a shared phone a signed-out person's unsent work may be shared
nearby, so the nearby install key (217) and each person's certificates
(218) sit outside this entry's seal: the key in the Keystore beside it, the
chains as plain meta rows. They are used only when someone signed in has
opened Share nearby, apart from proving the key to the Worker in the
certificate call of whoever is signed in. This weakens what this entry
guards against: whoever controls that phone can sign, as any certified
person on it, whatever is in its log, and with a live join pass on the phone
(phase 6) can let in a new person with no manage privilege. It is not a way
to sign in: a copied key gets a server session only on an account made from
a chain, before that account's first session. Discovery keys stay inside
the seal: each person's (`nearbyFindKeys:<profileId>`) are sealed with their
session at sign-out, in `apps/mobile/src/server/lock.ts`, come back at
sign-in from the lock, and with no key to seal them under are dropped, since
only that person's Share nearby uses them. This goes to the security review
and to Caleb, whose entry this is (`docs/nearby-sync-plan.md` 5.5 and
section 13); Carl's answer stands unless the review finds a reason.

Amended (2026-11-07, Carl Sauder): a sign-out the server forces (renewing
refused, the session ended elsewhere) seals nothing, and sealing the
discovery keys then would be pointless, because that person's lock key is
still in the clear on that path. So at any sign-out the app drops the
signed-out person's `nearbyFindKeys:<profileId>` and every `nearbyPeers` row
(`apps/mobile/src/nearby/nearbySignOut.ts`, from App's auth listener); a
chosen sign-out has sealed them first. Discovery keys are written only by
`keepFindKeys` in `lock.ts`, in the queue sign-out uses, and only while the
stored session is that person's, so a certificate answer that arrives after
they signed out is dropped rather than left in the clear. Sign-out does not
wait for that call, which may be waiting on the network.

Amended (2026-11-16, Caleb Koster): the pattern also locks the app, for
whoever turns Lock the app on in More settings (decision 253, LAN-255): it
asks for their own pattern each time the app opens or is come back to,
checked against their pattern's wrap here while they stay signed in, and
wrong tries there count with Sign In's. Forgot? on that lock signs out as
Sign Out does, and they come back as this entry says.
