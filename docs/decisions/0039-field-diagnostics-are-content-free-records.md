# 39. Field diagnostics are content-free records in our own database, not events and not a third-party tracker

Date: 2026-09-29 · By: Caleb Koster · Status: accepted

Reason: people using LangQuest far from reliable signal report problems we
cannot see ("downloading is really slow"), and support, increasingly Claude
on support's behalf, needs to find what happened on that phone and on the
server from an org and a language alone, without collecting data about
people we do not need (Caleb Koster, 2026-09-29). So phones keep small
records of how sync, snapshots, blob transfers and faults behaved, limited
to an allowlist of measurements and code-written tags (`DIAG_SCHEMA` in
`packages/client/src/diagnostics.ts`, applied again by `diag.clean` on the
server; `scripts/diagSchema.test.ts` holds them equal), and deliver them,
after their own work, to schema `diag` in our Supabase database through
`diag_ingest`. Records are keyed by the install id (the envelope's
`deviceId`) and the delivering profile id; nothing about content, names or
contact details is kept, 90 days is the retention, and the person can turn
it off. Support reads it as a separate `diag_reader` role through report
functions that join diagnostics to partitions and membership
(`npm run diag`, docs/diagnostics.md). Not events: the log is append-only
and pulled by every member's phone, and diagnostics must be deletable and
must not grow a partition. Not a third-party tracker: it would send device
data to another processor, keep only a few dozen reports offline, and could
not be joined to partitions and memberships, which is what answering the
question needs. Recording is on by default with a switch; the switch and the
privacy notice text are still to be built. Reverse if: a partner
organization or a privacy review requires consent before any collection
(then default off and ask at first sign-in); native crashes turn out to be a
large share of field problems (then add a native crash reporter with the
same allowlist, as its own entry); or the volume outgrows Postgres.

Amended (2026-09-29, Caleb Koster): the switch is built, a "Send diagnostics"
row in Settings, on by default as decided; only the privacy notice text is
still to be written.

Amended (2026-09-30, Caleb Koster): the privacy notice is written, as part of
the privacy policy (decision 46).
