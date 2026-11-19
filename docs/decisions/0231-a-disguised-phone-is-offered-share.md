# 231. A disguised phone is offered Share nearby, but its radios run only after a press, stop sooner, and never behind the cover

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl's answer 15. Hiding Share nearby on a disguised phone would be
safest, and would send the most exposed people to town and out of offline
review while teammates' phones still broadcast beside them; staff not
granting `nearby` is the lever for a team where any broadcast is too much
(plan 5.8). A disguised phone stays mounted under its calculator and fires
no `blur` (171), so without limits someone coming back would get a
calculator that broadcasts, exchanges and holds the screen awake. So: one
gate, `radiosMayRun({ focused, onScreen, covered, worn, pressed, stopped })`
(`apps/mobile/src/nearby/nearbyModel.ts`), asked by every start path and
again after each await. On a phone that wears a cover, opening the screen
does nothing, with no radios and no prompts, and a 56 pt "Start sharing"
press starts it. Ten minutes from the press (`runLimitMs`, from JavaScript)
or "Up to date" stops it, with no listening bursts, and both latch. Going to
the background stops it for good: 171 locks the app then, a lock clears the
press, and typing the code does not set it again, because a code typed
under pressure would light the radios and show teammates' names in front of
whoever asked. One warning comes before any permission prompt, because
Android's prompts name the application whatever icon the phone shows.
`radios.joinHotspot` is false there, since the hotspot's join dialog names
it too (`radiosFor`). "Hold teammates' recordings" is off by default (227).
The code goes through a `.android` seam (`src/shell/useAppCovered`,
`NearbyCoverNotes`), and every word only a disguised phone shows stays in
`src/disguise/i18n`, so iPhone and web builds carry none of it (171 as
amended 2026-11-05).
Reverse if: the real-phone test finds the prompts name the launcher alias
(then the warning changes), or people under a disguise are found broadcasting
behind the cover.

Amended (2026-11-16, Carl Sauder): Share nearby now shows on iPhones (256),
with no disguise, since an iPhone build carries none (171 as amended); the
disguise's files stay `.android`, so `disguiseIphone.test.ts` still holds.
The web is still without it, through the plain stubs; the exchange's files
are now `.native` beside them.
