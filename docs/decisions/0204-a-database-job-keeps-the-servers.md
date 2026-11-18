# 204. A database job keeps the server's snapshots bounded, and keeps what a slow phone part-way through a download still needs

Date: 2026-11-04 · By: Carl Sauder · Status: accepted

Reason: 88's clean-up ran only inside `put_snapshot`, and only on the reducer
version being written. Each deploy that bumps `REDUCER_VERSION` gives every
language a new snapshot, and froze the old version's snapshots, pieces and
whole cut for good (11 bumps from 2026-10-06 to 2026-10-30). A language that
went quiet kept its last day's snapshots until it next changed. Hosted on
2026-11-04, the snapshot tables held 17.7 GB beside 2.2 GB of events, and
`ops_sizes` left out `snapshot_chunks`, over a third of that. All of it can be
rebuilt from the log, so no rule here can lose work; what one can cost is a
phone on a slow link its download.

Carl chose a job in the database, `ops.purge_snapshots`
(`langquest-purge-snapshots`, every 10 minutes, migration
`20261104120000_snapshot_purge.sql`), not the projection pass, which skips
quiet languages by design (68) and runs against a time budget. Each run takes
at most 20 snapshots and stops once 200,000 pieces and rows are gone, so a
backlog goes a little at a time, and records a `snapshot_purge` job run even
with nothing to do, so a job that stops shows as stale. A snapshot goes when:
- a newer one of its version has been out 24 hours (88), or it is beyond the
  newest 30 of its version, unless it holds that version's only cut;
- it is the newest of a version a later one replaced, that replacement came 7
  days ago or more (`snapshots.superseded_at`), and no phone on that version
  was seen in the last 14 days (`diag.installs`, updated by each delivery of
  diagnostics).
The only version a language has always stays. Rows a dead pass staged go after
a day. `snapshot_units`, `snapshot_chunks` and `snapshots` are vacuumed at 2%
dead rather than 20%, so a phone paging through a cut does not read past dead
rows while a backlog goes, and plain vacuum gives back what is empty at the
end of a table (the `state` of snapshots from before 147 goes this way, 190 MB
to 2 MB in a test; no `VACUUM FULL`, which would block every read of the table).

What each rule costs a slow phone, measured before building
(`packages/sync/test/keptFill.test.ts`, the fleet's `slowLink` at 3,000
passages and 2 KB/s, which reads pieces, not the cut):
- A phone filling from the cut loses nothing when the cut is replaced under
  it: a replaced cut after every step made no request more and no restart,
  because what it filled stays and it reads the newest cut at or past where it
  started. So the same version needs no window for it, only its newest cut.
- A phone on an old version that loses that version's cut drops everything it
  filled and pulls the whole log (`cutGone`). That turned down the first
  proposal, deleting an old version after a flat 7 days: a native change can
  leave a store build on an old reducer for weeks (151). The rule above holds
  the version while such a phone is around, which costs one copy per language
  per version in use.
- Writing at most one snapshot an hour, the first proposal for a limit, was
  turned down: joiners on a busy language went from 24 to 26 minutes and 3.8 MB
  to 31 to 38 minutes and 4.5 to 5.5 MB, a longer tail after an older snapshot.
  88's schedule stands and the cap of 30 sets the limit instead. With 2.5 hours
  retained, what a cap leaves at one snapshot a pass, joiners at 2 KB/s took
  the same 24 to 26 minutes. A 40 MB language's whole snapshot takes longer
  than that at 2 KB/s, so such a download in a burst can go stale and start
  over; a phone reading the cut does not.

A redaction no longer waits for any of this: once a snapshot past it is
stored, the pass calls `drop_snapshots_before`, which deletes every snapshot
older than the redaction on every version, since those may hold what it
removed and any member can read them through `get_snapshot_chunk`. A phone on
an older version then has no snapshot, as it would have no snapshot past the
redaction anyway. Snapshots folded past an old redaction stay: a new reducer's
first tail is the whole log, and counting it would have dropped the old
version on every deploy in a language with any redaction.

Reverse if: `fill` records with `restart` and `cut_gone`, or `snapshot` records
with `none`, rise after this among phones on an older reducer (then hold the
version longer); or the tables grow past the database plan regardless (then a
short key in `snapshot_units`' indexes, which hold 4.5 of its 7.7 GB, or 89's
pieces in object storage).

Amended (2026-11-06, Carl Sauder): an older snapshot now goes 6 hours after a
newer one comes out, not 24 (migration
`20261106120000_snapshot_window_and_copies.sql`), which amends 88 as well. The
window serves only a whole-snapshot download that has not stopped: a phone
filling from the cut reads the newest, and a phone that tries again asks for
the newest and drops pieces of any other, so 88's phone that resumes later that
day was never helped by it. 40 MB at 2 KB/s is about 5.5 hours, so 6 hours is
the floor. A language writing one an hour keeps about 7 copies, not 25. Carl
chose this now rather than once builds from before the cut are below the
minimum version: until then those phones always read pieces, so a slower one
on a big language can see its download go stale and start over.
Reverse if: `snapshot` records with `stale` rise on `cold` first downloads.

Amended (2026-11-06, Carl Sauder): an old version's last copy now goes 45 days
after it was replaced, whoever still reports it, and a development build no
longer holds a version. As first built, one install seen every 14 days held its
version's copies for every language with no end, even a phone below the minimum
version, whose diagnostics pass the gate (154) though it may not download. 45
days allows for the three-week minimum-version cycle in 151 with a margin; it is
a judgment, not a measurement. Past it, a phone still on that version pulls the
log on a first download or a restarted fill, and its own work is safe.

Amended (2026-11-06, Carl Sauder): an old version's last copy now waits 14 days
after it was replaced, not 7, so one timer runs from the later of the replacement
and the last phone seen on it. Carl pointed out that a store build in review can
carry a version no phone has reported yet; 7 days could take its copy before
approval. Shortening to 1 day was turned down for that reason, and so was having
the release pipeline record each build's reducer, since one number covers it. A
review over 14 days past the replacement, or a build cut from an older commit,
still finds no copy: a new install on a slow link then pulls the log and its work
is safe. At about one bump a week this keeps one or two versions nobody reports;
at early October's three a week, five or six, each a copy per language.
