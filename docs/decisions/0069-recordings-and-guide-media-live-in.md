# 69. Recordings and guide media live in Cloudflare R2, behind the app's Worker

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: cost. Every recording a phone downloads for offline use, and every
guide picture or film, was Supabase Storage egress, billed per gigabyte
after the plan's quota; R2 charges nothing to read data out, and less to
store it. Files keep their keys (`<org>/<stream>/<sha256>.<ext>`), so the
`v1.BlobStored` events already in every log still name the right file.
The dashboard Worker (decisions 44, 58), which phones already reach as
`EXPO_PUBLIC_API_URL`, binds a private bucket (`BLOBS`:
`langquest-next-blobs`, `-preview`, location hint `enam` beside the
Supabase project in us-east-2) and serves `/api/blobs` (`apps/web/worker/blobs.ts`):
- An upload is a `PUT` with the person's access token. The database
  decides who may (`blob_access`, service role only, the same rule the
  bucket policies held: whoever may read a stream may read and upload its
  files, and a guide's media is also readable where a guide naming it is).
  R2 checks the bytes against the hash in the name (`sha256` on `put`) and
  refuses a mismatch, which the Worker answers 422 so the phone stops
  retrying it. The Worker then appends `v1.BlobStored` with `record_blob`
  before it answers 200, replacing the storage trigger (decisions 14, 17).
- A read is a ten-minute link from `/api/blob-urls`, signed with a key
  derived from the service-role key, so players that cannot send a token
  still stream (with Range) and nothing new is kept as a secret. The byte
  path asks the database nothing.
- Scripts and the reconciler present the service-role key to list, read,
  write and remove (`workerBlobs` in packages/client), so they need no R2
  credentials and work against `wrangler dev`'s local bucket the same way.
The old bucket was copied once (`server/copyBlobsToR2.ts`), then emptied
and deleted; migration `20261007220000_blobs_in_r2.sql` drops its policies,
its trigger and `_blob_readable`. Presigned R2 URLs with an R2 event
notification and a Queue to confirm uploads were rejected: more moving
parts, no hash check at the door, and R2 credentials on every script.
Cost: the Worker, until now only reports and Bible lookups, is on the path
of every file the app moves, so transfers need both Cloudflare and Supabase
(for sign-in and `blob_access`); offline-first sync turns an outage of
either into a delay. Each upload and each read link is one database call,
as the bucket policies were. Uploads are capped at 50 MiB, as before, under
the Worker's 100 MB request limit.
Reverse if: Worker CPU or request costs approach what the egress saved, or
films outgrow the request limit (then presigned multipart uploads for large
files only), or Cloudflare availability costs more field time than it saves.
