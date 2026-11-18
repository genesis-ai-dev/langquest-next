# 97. Taking back a checkpoint override needs Override checkpoints

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: only Override checkpoints may move a passage past a checkpoint (29),
but anyone with Translate, Review or Assign work could undo that override,
because `v1.DepartureUndone` names only the departure and its privilege came
from its own payload. The UI test suite found it (PASS-056). The server's
`may_emit` now looks the departure up in the same stream and asks for
Override checkpoints when it undoes an override
(`20261013140000_override_undo_privilege.sql`, `server/grantsSmoke.sql` 10).
Undoing a set-aside or a kept version keeps the wider list. The app shows
Undo on an override only to those who hold it (`screens/passage.tsx`).
Core `privilegeFor` stays payload-only, so it still names the wide list for
this event; the event's shape did not change.

Reverse if: a team wants translators to bring a checkpoint back themselves.
Then it is a role setting, not a code change.

Amended (2026-11-08, Carl Sauder): taking back a departure the server does
not have now needs Override checkpoints too, because "it changes nothing"
stopped being true with nearby sync (docs/nearby-sync-plan.md section 6): a
translator holding a coordinator's override from a teammate's batch could
push the undo before the override lands, and it would then read as undone
for good. `may_emit` is restated once (`20261112030000_nearby_relay.sql`):
an undo needs Override checkpoints unless the server holds a departure with
that id that is not an override, so holders keep today's result and an undo
of a set-aside the server holds is unchanged. So that an honest undo of a
teammate's unsent set-aside is not lost, `pushNow` in new builds holds back
a `v1.DepartureUndone` whose departure is on the phone only as a teammate's,
and pushes it once more after delivery in the same sync; the relay words a
refused undo of a departure the server lacks `departure not here yet`, and
the carrying phone sends it again once that departure is the server's. An
old build on a shared phone can send one person's undo before another's
set-aside, since push filters by actor: that is now refused, and Try again
recovers it. Caleb should see this.
