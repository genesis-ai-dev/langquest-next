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

Amended (2026-11-23, Carl Sauder): sharing while LangQuest is open
(2026-11-23-share-while-langquest-is-open) records its rooms with `mode`
`open` and their minutes running and scanning (`openMin`, `scanMin`), not
capped at ten. Only a phone with no cover runs that mode, so such a record
shows the phone wears none, which this decision kept out of the records. The
security review of 2026-11-23 raised it, and Carl accepted it with the
review's other changes: without it the field cannot show what the mode costs
or whether it meets anyone, which that decision's reversal rests on. It says
no more of a person than that they left the mode on, and a phone with no
such record may as well have the switch or the flag off, or never be offline
with LangQuest open. What would date a disguise stays out: a quiet room
stopped because a cover went on writes no record.

Amended (2026-11-24, Carl Sauder): enough to improve sharing while LangQuest
is open for real teams, still naming nobody. A session record says its room's
`mode`, and when this phone turned a phone away as `identity`, a reason from
a fixed list (`window`, `revoked`, `org`, `expired`, `other`), so how often
the quiet mode's two weeks turn a teammate away can be told from a lost phone.
A room says how many sessions Share nearby began only to note a teammate's
day again, the longest wait from first hearing a teammate to meeting them
(capped at ten minutes, as other durations), a stop to rest, and while open
the minutes its radios paused. While open a session that finished writes no
record of its own: its room sums what moved, so a phone offline for weeks,
syncing quietly all day, does not drop the start of its trip from a queue of
3,000 records; a session that ended any other way still has its own. The
server's install summary keeps the two modes apart and shows delivery to the
server, and `diag.nearby_summary` reads a language's phones together
(`npm run diag -- nearby <org>`), for improving the feature rather than one
report; no record holds who met whom, so it is counts per language.
