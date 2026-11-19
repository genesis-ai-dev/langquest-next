# 17. Bytes are verified on both ends, and the bucket is reconciled

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: content addressing only helps if someone checks the content. The
downloader hashes before trusting a file. The confirmation carries the size
so a device can detect a short upload. The reconciler is the server's own
independent pass over the bucket: it confirms what the storage trigger
missed and invalidates what hashes wrong, so blob truth never depends on a
trigger on Supabase's managed storage schema. A fetch failure never
invalidates anything; only bytes that were read and hash wrong do.

Amended (2026-10-07, Carl Sauder): the bucket is Cloudflare R2 (decision
69), and R2 now refuses an upload whose bytes do not hash to its name, so a
wrong hash is caught at the door as well as by the downloader. The
reconciler lists and reads R2 through the Worker's service routes
(`workerBlobs`) and still confirms what was never confirmed; `--verify`
remains the check against bytes that change after they were stored.
