# 253. A person can lock the app with their own sign-in pattern, which it asks for each time the app opens or is come back to

Date: 2026-11-16 · By: Caleb Koster · Status: accepted

Reason: amends 168. Someone who leaves a phone with LangQuest open, or hands
it over, shows their work to whoever picks it up; people asked for the app to
lock (LAN-255). Of the options put to him, Caleb chose (2026-11-13 and
2026-11-16):
- **Their own sign-in pattern, not a PIN.** The lock is the picture and the
  nine dots of 168, the same ones that sign the person back in after
  signing out: one secret to remember, no reading, no numbers. The pattern
  is checked by opening the person's own pattern wrap of 168 and finding the
  key they hold now (`checkPattern`, `src/server/lock.ts`), so nothing new
  is kept and a pattern made under an older key opens nothing. Wrong tries
  count with Sign In's, since it is the same pattern: four are free, then
  each waits twice as long, up to an hour.
- **Each person's own.** It is a switch in Me → More settings, Lock the app
  (`src/appLock/AppLockRow.tsx`), off until they turn it on; turning it on
  or off asks for their pattern first. Someone with no pattern yet chooses a
  picture and draws one twice there, as at their first sign-out, and that
  is also the pattern they sign back in with. On a shared phone the lock
  stands only for the person signed in who turned it on. Who has it on is a
  list of account ids in the app's key-value store, read at once as the app
  starts (`src/appLock/appLock.ts`), so the lock stands before a frame of
  their work shows. If their pattern went (they came back by a helper's
  code, and the key it wrapped went with it), the lock turns itself off.
- **Each time the app is left.** It stands on every fresh start and the
  moment the app goes to the background, however short the time away: a
  share sheet, a permission prompt on Android, or a call locks it too, as
  171's disguise does. Caleb chose this over a minute's grace, the safest
  and the most drawing. The phone's list of open apps shows the lock, not
  the work.
- **Over everything, with the app going on under it.** `AppLockGate`
  (`src/shell/AppLockGate.tsx`, around everything in App.tsx inside 171's
  disguise) keeps the app running under the lock, so sync goes on and the
  app comes back as it was left; every modal draws the lock too, through
  `ModalCoverContext`, with a disguise's cover still on top of it. A
  disguised Android phone asks for the code, then the pattern. A sign-in or
  sign-out that just happened, by any way, does not ask again. Android's
  Back on the lock leaves the app.
- **Forgot? signs out.** It leaves as Sign Out does
  (`leaveThisDevice`, `src/account/accountAuth.ts`): unsent work is handed
  over and sent as them later (60), and the sign-in stays locked for their
  return (168). They sign in again with their password, or a helper's code
  online; the work on the phone stays.
- **Phones only.** The web has no lock: `AppLockGate.web.tsx`,
  `AppLockRow.web.tsx` and `useAppLockSignOut.web.ts` import none of it, as
  `lock.web.ts` keeps 168's cryptography out of the web bundle. Nothing is
  sent, so no store answer changes (`docs/play-store-declarations.md`).
Tests `apps/mobile/test/appLock.test.ts`, `lockFlow.test.ts`.
Reverse if: people turn it off because they draw too often after a share
sheet or a permission prompt (then a short time away does not lock), or
people who forget the pattern lose access more often than the lock keeps
someone out (then a helper's code opens it too).
