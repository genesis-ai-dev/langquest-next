# 227. Every phone takes everything, unless its person turns off "Hold teammates' recordings"

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl chose (2026-11-06) that every event the server has not
confirmed goes to every phone, viewers too, so any one phone can carry the
whole team's work to town and a lost phone loses nothing (plan 5.11). Then
answer 14 (2026-11-07): a voice is hard to deny, the events beside it name
the speaker, and no file has protection at rest, so after a month offline
one taken phone, even a viewer's, would hold a month of all five people. So
Share nearby has a phone-wide switch row, "Hold teammates' recordings", in
`meta` as `nearbyHold`, written only when someone presses it: on with
nothing written, off on a phone that wears a disguise (`holdByDefault(worn)`,
`apps/mobile/src/nearby/nearbyModel.ts`), and a pressed choice stays whatever
the disguise does later. It covers files only; events still go to every
phone. Role does not decide it, because role is not risk, and open for
review alone would not do, because Translators hold `review`. With it off a
phone asks for needed files and a small window of open-for-review passages
in `upNextOf` order (five as a starting guess, from JavaScript), no backups,
and sheds marked files outside that set once the server has the file or
another person is known to hold it, keeping the last known copy
(`nearbyShedOf`); Ready to carry says the phone can carry the team's work but
not all of their recordings. `wantedFilesOf` takes the choice with no
default, so a test says which it means. Building found that a choice not
known yet should ask as the row off would, five passages of review, and shed
nothing, and that a phone that cannot read holdings counts no copies and
sheds only what the server has. What is accepted: a team where everyone
wears a disguise has no backups unless someone turns the row on, and a
speaker's voice stays on any phone with the row on until the server
confirms it. Five people recording an hour a day with the row on is 8.7 GB a
phone a month, which is arithmetic, not a measurement.
Reverse if: teams in the field run out of room carrying everything, or ask
for the row to be per language or per role.
