# 14. Confirmation is an event, not a column

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: v2 stamped `audio_uploaded_at` on rows and needed guard triggers to
stop clients echoing it back. Here the storage trigger appends
`v1.BlobStored` to the project log under the service actor, `append_events`
refuses the type from any client, and devices learn of it through the pull
they already do. Same guarantee, no extra column, no extra sync path.

Amended (2026-10-07, Carl Sauder): the confirmation is appended by the
app's Worker through `record_blob` after R2 has stored the bytes, not by a
storage trigger, which is gone with the bucket (decision 69). Same event
and id shape, so devices see no difference.
