# 115. An event is at most 64 KB, and an account creates at most 5 organizations a day and 20 in all

Date: 2026-10-15 · By: Carl Sauder · Status: partly superseded by 169

Reason: a security audit found that `append_events` limited a push to 500
events (invariant 12) but not their size, so one member could push notes
of many megabytes that every phone in the language must download and fold,
into a log that never sheds them, and that any account could create
organizations without end. Now, for signed-in callers, a payload as
Postgres prints it is at most 64 KB and each envelope field at most 256
characters (`eventSizeError` and `jsonbTextBytes` in
`packages/core/src/validate.ts`, SQL `_event_size_refusal`, migration
20261016040000). A recording's cards, the largest real payload, take about
120 bytes each. The app refuses to record a bigger event
(`EventTooLargeError` from `SyncClient.append`), since kept it could never be
sent; the fold does not check size, so nothing already in a log changes
meaning. The creation of an organization, the first event of one nobody has
written to, is refused once its author has created 5 in the last day or 20
in all (`org_bootstraps`, `_org_creation_refusal`); the service role's
imports and seeds are exempt. Turned down: a quota on events per day, which
would refuse a phone pushing weeks of offline work at once, and a size
measured differently on each side, which would refuse at the server what the
app had recorded; the parity script holds the two measures together on
either side of the limit.
Reverse if: real work needs a bigger event (then split it, as cards are), or
someone legitimately runs more than 20 organizations (then raise the
allowance for that account rather than for everyone).
