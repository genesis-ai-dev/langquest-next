# 238. The relay carries no redaction and no stamp more than a day ahead

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a redaction cannot itself be redacted, and `append_events` allows
one to anyone holding Manage structure, so someone holding a Coordinator's
copied key could sign batches of `v1.Redacted`, post them with any member's
token and take the team's work off every phone for good
(docs/nearby-sync-plan.md section 6). So the relay refuses `v1.Redacted` by
name, per event, with a reason that reads as `INVALID`; no honest batch
holds one, because the door, the sender and the claims refuse it, and
redactions still take effect from `remove_content` and an author's own
push. `CLOCK_AHEAD` alone would never settle an event stamped years ahead:
the sweep keeps it because it is signed, and every phone would stay on the
slow checkpoint path until that date. So the relay refuses a stamp more than
`relay_ahead_limit_ms` (a day, in `server_config` beside
`clock_ahead_tolerance_ms`, so it needs no app update) past server time,
with `stamped too far ahead: <date>`; the phone marks the row refused,
keeping its `via`, and puts it back to nearby once its date is within a day,
so a lost author's work is delivered when its date comes. Until then that
row's file is not wanted by other phones and is freed first under space
pressure, so a lost phone with a far-ahead date can lose that audio. An
author's own push still gets `CLOCK_AHEAD` and restamps.
Reverse if: honest work with far-ahead dates is refused often enough in the
field that a longer limit is worth the slow path it costs.
