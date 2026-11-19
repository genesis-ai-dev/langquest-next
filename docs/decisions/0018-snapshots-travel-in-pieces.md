# 18. Snapshots travel in pieces

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: a Bible-scale snapshot is around 13 MB of JSON. One response on a
weak link fails and restarts. 256 KB pieces, each persisted before the next
is requested, make cold start resumable. The same helper feeds the worker
and the reconciler.

Amended (2026-10-14, Caleb Koster): a phone now asks for three pieces at a
time, not one, and saves each as it arrives; every piece is still saved
before the snapshot is put together, so a dropped link resumes from what
arrived (`fetchSnapshot`, `SNAPSHOT_PIECES_IN_FLIGHT` in `syncClient.ts`).
One at a time, a phone 300 ms from the server spends 48 s on round trips
for Koro Miyan's 152 pieces; three at a time, 16 s (measured from a Mac
through a delaying proxy). The pieces are written straight to the store,
not through the writer that tells screens a save is under way: on a 2 GB
test emulator that redrew the whole app twice per piece, and Koro's
download took 46 s instead of 5. The server's projection worker still
fetches one at a time. Reverse if: links drop so often that losing up to
three pieces at once costs more than the round trips it saves.
