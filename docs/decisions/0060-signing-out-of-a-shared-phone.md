# 60. Signing out of a shared phone hands unsent work over, and it still goes as its author

Date: 2026-10-05 · By: Caleb Koster · Status: accepted

Reason: amends 12. A family or a team often shares one phone, and the
people 59 brings in by QR are the least able to wait for a signal before
handing it on. Under 12 the phone refused sign-out while anything was
queued, so the next person could not sign in until the first person's work
had gone, and offline that could be days. Caleb asked (2026-10-05) that
several people's work on one phone be accounted for, and chose this:
- Signing out with work still to send moves the session to its own key on
  the phone with no server call (`signOutHandingOver` in `handOver.ts`), so
  it works offline and the session stays good. The app then shows the
  signed-out screen as for any sign-out; nothing on screen can use the
  kept session.
- A courier runs for the whole app, whoever is signed in
  (`useHandOvers`). When the phone is online it sends that person's queued
  events in every partition (`deliverQueued`, a push-only `SyncClient` that
  never folds or re-stamps), their account changes, the recordings the
  server had not confirmed at sign-out, and the disconnect of their
  notifications, all under their own session, so the server's rule that an
  event comes from its author holds. Then it signs the kept session out and
  forgets it.
- If they sign back in on this phone first, their own session takes over
  and the courier forgets theirs. If the server will not renew the kept
  session, the courier forgets it and the work waits, still queued, for
  their next sign-in; nothing is ever deleted unsent (events are pruned
  only once confirmed, recordings evicted only once the server has them).
- Everyone's events share the phone's one log as before; each session
  pushes and counts only its own (`pendingPage` filtered by actor,
  `pendingCountBy`). A browser forgets everything on sign-out (11), so the
  web keeps 12's refusal.
The kept session is the same kind of secret supabase-js already keeps on
the phone (AsyncStorage), and lasts only until the work has gone.
Recordings in a language other than the one open at sign-out are not
listed; they go when anyone who works in that language opens it here, as
before. Tests `packages/client/test/courier.test.ts`,
`apps/mobile/test/handOver.test.ts`.
Reverse if: kept sessions outlive their work in the field (then they
expire after a set time), or a phone signs work in as the wrong person.

Amended (2026-10-15, Carl Sauder): the signed-in session and the sessions
kept here now live in the iOS Keychain and the Android Keystore through
`expo-secure-store`, not in AsyncStorage; the web build is unchanged and keeps
the browser's storage, which signing out wipes. A security audit found
refresh tokens, ours and other people's, in plaintext AsyncStorage, where a
backup, a rooted phone or a stolen one could read them. A session is longer
than SecureStore's 2 KB guidance, so `apps/mobile/src/server/secureStorageModel.ts`
cuts a value into parts and encodes the key; the list of hand-overs holds
no secret and stays in AsyncStorage. A value found only in the old place
moves over on its first read, so people already signed in, and hand-overs
already waiting, survive the upgrade. The Android backup rules keep the
Keystore-encrypted values out of backups. supabase-js reads its session at
every request, so values are kept in memory once read; an entry the Keystore
can no longer read counts as signed out. Test
`apps/mobile/test/secureStorage.test.ts`.

Amended (2026-10-26, Caleb Koster): with a lock on the phone (168), the
session a hand-over keeps is sealed for its owner too. When the courier has
sent everything it no longer ends that session: it seals the newest copy and
drops the key, so the person can still come back to this phone offline.
Coming back from the lock takes the session back from the courier without
ending it, after any delivery under way stops (`takeBackHandOver`).

Amended (2026-11-07, Carl Sauder): a teammate's events that came from their
phone (`nearby`, 212) never go through the courier. They are not `pending`,
so `pendingStreamsBy` and a hand-over's `deliverQueued` never see them, and
`requeue` and Try again never turn a row with a `via` into `pending`: naming
this person proves nothing, so the courier would otherwise push a forged
event as its author. Until delivery (`docs/nearby-sync-plan.md` phase 4) only
an author's own session sends their work. A nearby file evicted before the
server has it, and teammates' files left out of a hand-over's uploads, come
with phase 3.

Amended (2026-11-07, Carl Sauder): "recordings evicted only once the server
has them" no longer holds for a teammate's recording that came from their
phone. Such a file is marked in the file ledger when it lands, and can go
before the server has it when space runs short and nothing the server holds
can free enough, when the server confirms it (a backup goes at once), or
with "Hold teammates' recordings" off once another person is known to hold it
(`docs/nearby-sync-plan.md` 5.6, PLAN.md section 14). This person's own
unsent recordings, and another person's on a shared phone, carry no mark and
are still never deleted. Teammates' files are left out of a hand-over's
uploads (`LanguageSession.unsent`) and of the sign-out count (`pendingUp`),
so they neither hold a session on the phone nor go up as its person; they
wait for the next session here. Tests `packages/sync/test/nearbyFiles.test.ts`,
`apps/mobile/test/blobsModel.test.ts`.
