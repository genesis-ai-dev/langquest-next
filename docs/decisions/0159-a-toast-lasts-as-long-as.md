# 159. A toast lasts as long as Android's "Time to take action" asks and runs no bar down under reduce motion; the phone tests set 10 seconds

Date: 2026-10-22 · By: Carl Sauder · Status: accepted

Reason: a toast showed a fixed 3.5 s (7 s with a screen reader) with a bar
that ran down across it, and the phone flows that check one (NAV-061's "Press
Back again to leave", PASS-068's offline acts) failed on the Android
emulator. Maestro reads the screen once it is idle, and the bar, animated on
the JavaScript side, changed the screen every frame, so a Back or a tap that
waits for the screen to settle waited out the whole toast and then found it
gone (frame captures and logs, 2026-10-21; the app behaved). Two changes, both
settings people already have:
- Reduce motion: the toast draws no bar when it is on (`ToastView` in
  `ui/kit.tsx`, A11Y-8), with the hook the recorder used, now
  `ui/useReduceMotion.ts`. The runner's zero animation scales read as reduce
  motion on Android, and it turns Reduce Motion on in the iOS simulator for
  the run (XCUITest also waits for the app to be idle), so a screen with a
  toast is still.
- "Time to take action" (Android Accessibility, WCAG 2.2.1): `ui/toastTime.ts`
  asks `AccessibilityInfo.getRecommendedTimeoutMillis(3500)` once when the
  toast host mounts, and ToastHost (App.tsx) shows each toast that long,
  still doubled for a screen reader. The second Back that leaves the app
  counts for the same time (`backModel.ts` `leavesNow`). iOS has no such
  setting and keeps 3.5 s. `npm run test:ui:phone` sets both of Android's UI
  timeouts to 10 s while it runs and puts them back afterwards, as it does
  with the animation scales, so a slow emulator still reads a toast in time.
Cost: a test run's toasts stay 10 s, so a flow can find one over what it taps
next; it closes the toast ("Close") or waits for it. A person who chose a long
"Time to take action" sees toasts that long too, and one with reduce motion
on sees no countdown, which is what those settings ask for.
Reverse if: toasts that stay longer get in people's way more than they help
(reports of toasts covering work), or people with reduce motion on miss the
countdown; then the runner's settings can go and the app's stay.

Amended (2026-10-28, Caleb Koster): a toast that says something went wrong
(a save refused, a fault with its code) is a problem toast
(`ctx.toast(message, 'problem')`, `ui/toastModel.ts`): an amber warning
instead of the green check, no bar, and it stays until closed, so its words
and the code a person reads out to support are never gone first; a screen
reader hears it as an alert. While a sheet is open, the sheet on top draws
the toast (`ui/toastLayer.ts`), as one drawn by the screen was hidden under
it. `test/toastModel.test.ts` fails on a failure toast that is not a
problem toast. From the UI audit Caleb asked to have fixed (finding 20).
