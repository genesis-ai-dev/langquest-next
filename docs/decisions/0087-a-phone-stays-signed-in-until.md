# 87. A phone stays signed in until someone signs out on it or the server ends the sign-in

Date: 2026-10-12 · By: Caleb Koster · Status: accepted

Reason: translators are offline for months and may get a signal for a
second before going offline again. Caleb asked (2026-10-12) that nothing
then signs them out or keeps them from their work. An audit found that
supabase-js reports no one whenever an expired access token (an hour old)
cannot be renewed, and the app took its word: a phone restarted offline
showed a blank screen for 25 seconds and then Sign In. Production's session
settings were already safe (no time-box, no inactivity timeout, no single
session per user; `server/README.md`). Chosen:
- The app starts from the sign-in saved on the phone (`authState.ts`,
  `App.tsx`): supabase-js deletes it only when the server has said no, or
  the person signed out, and says so with `SIGNED_OUT`, the only event that
  makes the person a guest.
- Renewing the sign-in (`sessionSafeFetch.ts`, the fetch of every Supabase
  client): a 429, a 408, a 5xx, or anything that is not Supabase Auth's own
  JSON error reaches supabase-js as a network failure, so it keeps the
  sign-in and tries again. Many phones on one connection, or a page from a
  hotspot or a proxy, no longer end a sign-in.
- While a sign-in waits to renew, a request that would go out with only the
  public key fails as a network failure. It is offline, never a refusal
  (`supabaseTransport.ts` reads it as `OfflineError`).
- supabase-js retries a failed renewal for about 25 seconds and every call
  needing the token waits; offline, a screen waiting on one call stayed
  blank that long. Right after a renewal failed for want of a network,
  `getSession` answers at once from the saved sign-in
  (`answerAtOnceWhileOffline`); supabase-js's own timer keeps renewing in
  the background.
- Signing out ends this device's session only (`signOutCore.ts`): `global`
  ended the person's sign-in on every device, and the hand-overs kept for
  them on shared phones. With an expired token it asks the server nothing,
  so it works offline at once. A browser forgets itself even when the
  server cannot be told (11).
- A phone whose notifications cannot be disconnected offline hands the
  disconnect to the courier (60) instead of refusing sign-out, as 12
  (amended 2026-09-28) says offline alone must not. Offline, the sign-out
  screen says signing back in will need a connection.
Tests `apps/mobile/test/offlineSignIn.test.ts` run supabase-js itself.
Still true: setting a password ends the person's other sessions (Supabase
Auth has no setting for it), and nobody can sign in on a phone that has
never held their sign-in without the server.
Reverse if: a phone keeps acting for an account the server has ended
(then end it on the first refusal of its requests), or Supabase Auth
starts answering a lasting refusal with a status this treats as passing.

Amended (2026-10-26, Caleb Koster): app start read the saved sign-in from
AsyncStorage, where it no longer is once 60 (amended 2026-10-15) moved it to
the Keychain and Keystore; from then on a phone opened offline an hour after
its last connection showed Sign In. It now reads it where supabase-js keeps
it (`savedSignIn`, test `apps/mobile/test/savedSignIn.test.ts`). On a phone,
signing out no longer ends the session on the server and the sign-out screen
no longer says signing back in needs a connection: the session is locked on
the phone instead (168). A browser keeps both as before.
