# 88. A language's server snapshot is written after 200 new events or an hour, and the one before stays for 24 hours

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: the projection pass wrote a new snapshot of every language that had
any new event, every five minutes, and `put_snapshot` deleted the one
before at once. A phone part-way through downloading a snapshot then found
its pieces gone, threw the download away and pulled the whole log; on a
slow link the next try went the same way. The fleet simulator measured it
(`docs/fleet-baselines.md`, `slowLink`): every joiner on a 2 KB/s link went
stale and took 14 to 29 minutes at 1,200 passages, 42 to 51 at 3,000.
Carl chose (2026-10-12, LAN-47):
- The pass still folds every changed language for the Inbox, but writes a
  new snapshot only after 200 new events or once the newest is an hour old
  and the stream has moved (`SNAPSHOT_SCHEDULE`, `shouldWriteSnapshot` in
  `packages/client/src/snapshotWorker.ts`). It writes at once when there is
  none, and when the new events hold a redaction, since a phone whose own
  checkpoint holds the target waits for a snapshot past the redaction
  (whether or not the server's snapshot held it; waiting up to an hour sent
  such phones back to the whole log after 30 minutes). A language
  that went quiet a few events past its snapshot is visited again once the
  hour is up (`snapshotDue`, `server/projectionWorker.ts`).
- A snapshot stays downloadable until the one after it has been out for 24
  hours (`put_snapshot`, migration `20261012120000_snapshot_retention.sql`).
  That covers a 13 MB download at 2 KB/s, about two hours, with a wide
  margin, and a phone that loses its signal and resumes later that day.
A cold start now pulls up to 200 events, or an hour's, after the snapshot.
A busy language keeps up to about 25 snapshots, a quiet one one or two.
Reverse if: snapshot storage grows past what the database plan allows
(then shorten the retention, or keep pieces in object storage), or cold
starts spend more time on the tail than they saved.

Amended (2026-10-20, Carl Sauder): `put_snapshot` also moves in the
snapshot's rows cut by passage (147), which only the newest snapshot keeps,
and the pass writes every passage's line each time it folds a language,
whether or not a snapshot is due. Retention is unchanged; a snapshot's rows
go with it.

Amended (2026-11-04, Carl Sauder): the 24 hours and the schedule stand, but
`put_snapshot` no longer deletes anything; a job does, and that job also
covers what this entry left out, older reducer versions and languages that
went quiet (204). "About 25" had also never been a limit: a burst can write
one a pass, so the job caps a version at 30.
