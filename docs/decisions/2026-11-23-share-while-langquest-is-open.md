# Share nearby also runs quietly while LangQuest is open, in front and offline, where staff turned on `nearby_open` and the person has not turned it off; never in the background, never on a disguised phone, and never with a prompt, a tap or a hotspot

Date: 2026-11-23 · By: Carl Sauder · Status: accepted

Reason: teams forget to open Share nearby, so review and the protection
against a lost phone waited on someone remembering (decision 232 ran the
radios only while that screen was open, opened by both people). The fleet's
`villageDay` (docs/nearby-sync-plan.md 15.10) found the mode does not clearly
beat a team that meets every evening, and recovers much of what a team that
forgets loses. Carl chose to build it anyway, because it can be turned off
wherever battery life, security or anything else argues against it
(2026-11-23): staff grant it one organization at a time as a third feature,
`nearby_open`, only with `nearby` on, and each person has a switch, "Share
while LangQuest is open", on by default, beside Hold teammates' recordings.
The phone keeps which organizations have it (`nearbyOpenOrgs:<profile>`),
since the mode runs only offline, where `get_user_state` is not heard; a
turn-off reaches it the next time it is online. Sharing in the background was
looked at again and turned down: iPhones cannot find or be found in the
background with an advert that has nothing fixed in it, nor join Wi-Fi
without a prompt; Android needs a foreground service whose notification names
the app, which gives a disguise away; and the phones decision 224 chose the
link for stop background work. While LangQuest is in front none of that
applies. So one owner holds the phone's one radio (`nearbyOwner`): a screen
that runs the radios claims it, which stops the quiet room first, and every
room's start and stop takes its turn, so two never run at once. `openMayRun`
opens the quiet room only with the feature, the switch, permissions already
granted, the radios on, no cover, no app lock showing (decision 253 keeps
every screen running behind it), the app active, the language offline,
nothing recording or playing, no nearby screen open and no rest. In it the
room never asks, taps, keeps the screen awake or touches a hotspot, an iPhone
joins no Wi-Fi (events over Bluetooth, audio waiting for Share nearby), and at
"Up to date" it keeps advertising and scans six seconds a minute with no idle
stop, because the screen going off is the limit. The bound in
docs/nearby-sync-plan.md 5.5 becomes "while LangQuest is in front, offline".
The security review (15.8, 2026-11-23) set its bounds: Hello in the quiet
mode takes only a teammate whose certificate was signed within 14 days, by
the clock Hello reads, so a lost or taken phone still signed in collects
nothing quietly once that long has passed since it last reached the server
(certificates renew daily online), though the revocation list has not
reached anyone; a team offline longer shares on Share nearby, as before. The
draft's narrower rule, only teammates met on Share nearby since last online,
was not taken, since it sent the first meeting of every trip back to Share
nearby. Each run stops at 30 minutes, and the mode rests ten minutes after
that, after a Hello the door refused or a radio error, per language. The
server refuses `nearby_open` while `nearby` is off. Its room record says
`mode`, and for `open` the minutes it ran and scanned, so the field shows
what it costs (decision 235, amended); a room stopped because a cover went
on records nothing.
Supersedes in part 232; amends 220 with a third feature and 235; keeps 171,
211, 230 and 253.
Reverse if: the field's diagnostics show the mode rarely meets anyone, or its
battery cost is over the bar in docs/nearby-sync-plan.md 15.7; a lost or taken
phone is found collecting a team's work through it; or people report sharing
they did not expect (then the switch's default goes to off).
