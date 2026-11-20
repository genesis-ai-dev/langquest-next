# Recordings and other files: uploads, downloads and what a phone keeps

Kind: reference

How a phone moves files (recorded parts, voice notes, guide media) to and
from the server, and what it may delete when space runs short. Moved here
from PLAN.md section 14 on 2026-11-19
(`docs/decisions/2026-11-19-each-doc-answers-one-question.md`); the rules
keep their numbers, since code cites them ("PLAN.md section 14 rule 2"). The
code is `TransferWorker` and the file ledger in `packages/sync`, and core's
`blobs.ts`.

Carried over from the LangQuest v2 attachment rewrite (August 2026, PRs 921,
928, 930), which replaced a persisted attachment queue with derived work
lists after the queue kept disagreeing with disk and database. Every rule
below was earned in production there.

1. **No persisted queue.** The upload list is derived on every pass from the
   fold: card hashes referenced by `RecordingAdded` events that the server has
   not confirmed, intersected with files present on this device. Recording a
   card *is* the enqueue. Only disposable in-memory retry state exists, and
   losing it costs one idempotent attempt.
2. **The server confirms, never the client, and the bytes are checked.** A
   blob is uploaded when the server says so. The confirmation carries the
   stored size; a device whose file differs in size uploads again. Every
   download is hashed before the file is trusted; a mismatch is deleted and
   retried. `server/blobReconciler.ts` (`npm run reconcile`, `--verify` to
   hash every object) lists R2 through the Worker independently of the
   confirmation each upload gets, confirms anything unconfirmed, and appends
   `v1.BlobInvalidated` for objects whose bytes hash wrong, removing them.
   `PUT /api/blobs/<org>/<stream>/<hash>.<ext>` on the app's Worker is
   idempotent (content-addressed, so a re-upload is a byte-identical
   overwrite), and R2 refuses bytes that do not hash to their name
   (decisions.md 69). Confirmation arrives as a
   `BlobStored {hash, size, storedAt}` event appended by the server into the
   language's stream, so it reaches every device through the normal pull. Clients
   have no way to write it: `append_events` refuses `BlobStored` from any
   non-service caller.
3. **Grace, not flags.** After a successful PUT the uploader leaves the hash
   alone for a grace window (10 min in v2) and then re-derives; if the
   confirmation never arrived, it re-uploads. Lost confirmations self-heal.
4. **Two wake-up verbs.** `trigger()` clears backoff waits (reconnect, app
   foreground, after recording); `nudge()` asks for a pass without touching
   backoff or grace. Confusing the two caused retry storms in v2.
5. **Backoff ladder, never terminal.** Upload 30 s, 1 m, 5 m, 30 m cap;
   download 30 s, 2 m, 10 m cap. Failure counts survive a trigger; only the
   wait is cleared.
6. **Pacing.** Upload concurrency 1, download 2, plus a shared bytes-in-flight
   budget (`TransferBudget`, 24 MB) across every worker on the device; v2 ran
   4 and 25 with whole files in memory, which is the peak-memory risk on a
   weak phone. Tune upward only from measurements on a representative
   device. Debounce 2 s up, 0.5 s down. A 60 s periodic tick as the
   catch-all. Re-entrancy via a draining/dirty flag so a signal mid-pass
   schedules exactly one more pass. Transfers also pause while the
   microphone is open or a recording is being saved (`isDeferred`).
7. **Stop while pulling.** No transfers while a pull is in progress, and the
   check repeats before each file inside a batch: a batch of thousands of
   stale entries after an upgrade must end early, not run to completion on a
   metered link. This was the "runaway train" incident.
8. **Offline is honest and quiet.** Report the pending count, attempt
   nothing, leave backoff untouched. Online means HTTPS reachability, not the
   sync channel being connected.
9. **Local file index.** One directory listing at startup, additive after.
   The on-disk path is a pure function of the hash; no table maps names to
   paths. A missing local file is simply absent from the upload list and
   surfaces as a visible pending count, never an error state.
10. **Download by scope, not by demand.** Confirmed blobs for the units the
    user is assigned to or has worked in (`defaultOfflineScope`) plus units
    they chose to keep offline (`keepOffline`); playback resolves the local
    path or streams. Nothing marks a download done except the file being on
    disk. A recording that can do neither on a device (offline and not kept
    there, or a part not uploaded yet) is not checked, said back or changed
    from it: `clipReach` in `apps/mobile/src/audio/clipReachModel.ts` says
    which, and the review, back translation and recording screens hold back
    and say why
    (`docs/decisions/2026-11-20-unheard-recordings-are-not-judged-or-changed.md`).
11. **Audio is immutable.** Already PLAN.md invariant 4. It is what makes the
    confirmation monotonic and the upsert safe; v2 had to document the
    re-record-in-place case as unhandled.
12. **Measure from server truth.** Load tests count confirmed blobs on the
    server and files on disk, never client counters, so the same harness
    works across rewrites.

Cache eviction (closing a v2 gap): the device keeps 500 MB free for
recording and caps the blob cache at 2 GB. Only files core `evictableBlobs`
names may go: referenced by this language, confirmed intact on the server,
outside the offline scope, and not upload work. Unsynced recordings, kept
units, and other languages' files are never touched. Downloads land in a
`.part` staging name and are renamed only after their hash matches;
startup deletes leftover staging files.

Files from a teammate's phone (since 2026-11-07): files that came from a
teammate's phone over a nearby link (`docs/nearby-sync-plan.md` 5.6) are
marked in the file ledger, and when space runs short they go in three
levels: first the files `evictableBlobs` names, as above; then, only once
those cannot free enough, marked files outside the offline scope (a marked
file no reference names first, then backups, then files open for review,
the most known copies first); never this person's own unsynced recordings,
another person's on a shared phone, kept units, or a needed nearby file. So
a backup can go before the server has it, possibly its last copy, because
the person's own recording has to win. The 2 GB cap leaves marked files out
of its total and frees from the first level only. A marked backup the server
confirms at the size held here goes at once, on every phone, and with "Hold
teammates' recordings" off a phone also sheds marked files outside what it
needs and a small window of review once the server or another person keeps
them (Carl's answer 14). Another language's marked level 2 files can go from
the mark alone. Nearby files land in `<hash>.<format>.nearby.part`.

Known v2 gap still open: no server-side garbage collection of blobs nothing
references (a redacted recording's blobs stay in the bucket until that
exists).

Load harness: `npx tsx scripts/loadtest.ts 100000` folds a synthetic Bible-scale log.
On a laptop, 100k events replay in 0.2 to 1.3 s with a 13 MB snapshot
(1.1 MB gzipped, which is what HTTP compression sends) and a 250 MB heap.
The gate is the same run on the slowest partner Android.
