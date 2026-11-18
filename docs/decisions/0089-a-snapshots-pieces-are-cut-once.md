# 89. A snapshot's pieces are cut once, when it is written, and kept in their own table

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: `get_snapshot_chunk` serialized the whole snapshot (`state::text`)
to return each 256 KB piece (18), and `get_snapshot_meta` did it twice to
say how big it was. `npm run bench:server` measured 60 to 80 ms of database
time per piece for a 14 MB snapshot of 55 pieces: about 4 s for each cold
start and each worker read (performance-audit.md item 4). Carl chose
(2026-10-12, LAN-47) to keep the pieces in Postgres rather than R2: the
same RPCs, the same authorization, nothing new to run. `put_snapshot`
serializes the state once, cuts it by bytes into pieces of at most 256 KB
that never split a character, and stores them in `snapshot_chunks`, with
the snapshot's size and piece count on its row (migration
`20261012130000_snapshot_chunks.sql`). Pieces go with their snapshot (a
cascading key), so 88's retention holds for them. A snapshot written
before has no pieces and is read as before until it ages out. Reads now
take under a millisecond; a write takes about 0.3 s instead of 0.1 s, and
88 writes at most one an hour per language. The pieces double a
snapshot's storage beside its `state`, which `get_snapshot` and the
diagnostics (`diag.language_health`) still read.
Reverse if: snapshot storage outgrows the database plan (then the pieces
move to object storage behind the Worker, or `state` stops being kept), or
a snapshot write has to be faster than that.

Amended (2026-10-20, Carl Sauder): `state` is no longer written (147):
the pieces serve builds from before the cut and the Worker, and a cut by
passage (`snapshot_units`) serves phones; `get_snapshot` puts the state
together from the pieces, and the diagnostics read the size from the row.
