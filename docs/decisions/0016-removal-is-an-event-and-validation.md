# 16. Removal is an event, and validation is the door

Date: 2026-09-15 · By: Ryder Wishart · Status: partly superseded by 47

Reason: the log refuses UPDATE and DELETE, so a malformed or unwanted event
is permanent. `validate_payload` (SQL) and `validateEvent` (core) share one
rule set, the fold skips and counts anything invalid instead of throwing,
and `v1.Redacted` excludes a target from every fold. Reverse if: never; an
append-only log without these is a liability, not a guarantee.

Amended (2026-09-30, Caleb Koster): one edit is now allowed, erasing a
deleted person's name from the event that holds it (decision 47). Everything
else here stands.

Amended (2026-10-09, Carl Sauder): a redaction is never redacted. The fold
applies every redaction before anything else, in the order they arrived, so
one aimed at another made the outcome depend on that order: the first stood
if it came first and vanished if it came second. `append_events` refuses a
`v1.Redacted` whose target is a `v1.Redacted`, and the fold ignores any
already in the log (reducer version 12). A removal that was a mistake is put
right by recording the thing again, not by redacting the redaction.
