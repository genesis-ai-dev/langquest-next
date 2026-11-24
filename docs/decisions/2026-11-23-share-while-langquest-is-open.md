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
granted, the radios on, no cover, the app active, the language offline,
nothing recording or playing, no nearby screen open and no rest. In it the
room never asks, taps, keeps the screen awake or touches a hotspot, an iPhone
joins no Wi-Fi (events over Bluetooth, audio waiting for Share nearby), and at
"Up to date" it keeps advertising and scans six seconds a minute with no idle
stop, because the screen going off is the limit. The bound in
docs/nearby-sync-plan.md 5.5 becomes "while LangQuest is in front, offline".
The security review (15.8) added a rest of ten minutes after a Hello the door
refused or a stop of the room's own; the narrower rule it weighed, sharing
only with teammates already met on Share nearby since last online, was left
out, since the organization's flag and the switch are the way to keep the
mode from where it should not run. Its room record says `mode`, and for
`open` the minutes it ran and scanned, so the field shows what it costs.
Supersedes in part 232; amends 220 with a third feature; keeps 171, 211 and
230.
Reverse if: the field's diagnostics show the mode rarely meets anyone, or its
battery cost is over the bar in docs/nearby-sync-plan.md 15.7; a lost or taken
phone is found collecting a team's work through it; or people report sharing
they did not expect (then the switch's default goes to off).
