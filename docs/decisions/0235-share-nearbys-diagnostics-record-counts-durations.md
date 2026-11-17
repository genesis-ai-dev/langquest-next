# 235. Share nearby's diagnostics record counts, durations and the module's codes, and nothing that names a teammate or a disguise

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a field report about Share nearby ("it never finds anyone", "it
stops") has to be answerable with `npm run diag`, as the rest of the app's
are (39), before anyone has measured the link in the field (plan section
11), and diagnostics are how a report shows whether a phone has used it
(plan 5.10). A phone silent to its peer must not be silent to diagnostics
(plan 5.12). So one `nearby` kind (`packages/sync/src/nearbyDiag.ts`): a
record when a room stops (why, how long, to "Up to date", teammates' phones
heard and echoed, taps offered and taken, salts no key matched, pipes that
failed with the module's code, strangers' openings, busy refusals,
sessions, and whether the radio can advertise, use Wi-Fi Direct and host),
one when a session of this phone's ends (how, the bye reason, the module's
code or a store fault's class, the link after its fallbacks, counts of what
moved, and flags), one when Find fails natively, and one when the screen
cannot run. The module's codes are an enumerated list, because the
allowlist holds them, and a test holds sync's copy equal to the module's.
Neither side records the other phone's tag, salt, key, install key, profile
or device id, as `docs/diagnostics.md` already rules for a shared phone's
other person; building added that the record leaves out whether the phone
wears a disguise and its "Hold teammates' recordings" row, which defaults
off under one (227), since either would mark the person in records that
support and Claude read. The schema lives in the nearby entry and a
recorder takes it with `Diagnostics.allow`, because the web bundle had no
room (233); the server's allowlist (`diag.schema()`, migration
`20261112020000_diag_nearby.sql`) holds it beside the rest, and
`diag.install_summary` reports it as `nearby`. Only transfers go to the
user-issue watch: these records are for reading a field report, and a
dropped radio link is not a bug to file (plan section 9).
Reverse if: a field report about Share nearby cannot be told apart from these
records (then a field is added, never an identifier), or the watch should
file a kind of nearby failure.

Amended (2026-11-07, Carl Sauder): leaving the disguise out was not enough,
because only a disguised phone has a run limit or stops at "Up to date"
(231), so a room record with `stop` `run` or `level`, or a run that ended at
exactly ten minutes, marked the person. A room record now reads those stops
as `asked`, and says it ran, and took to "Up to date", at most ten minutes
(`NEARBY_ROOM_MS_CAP`, held equal to the app's run limit by a test), so a
worn phone's record is one a plain phone stopped by its person also makes.
A plain phone's run past ten minutes is the cost; `stop` still says idle or
wait. The server's allowlist keeps `run` and `level`, which no build now
sends.
