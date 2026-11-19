# 121. The Worker trusts a verified token, and a file-access answer, for up to a minute per isolate

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: the hosted project still signs with the legacy shared secret, so
`getClaims` (44) asks Supabase Auth about every request, and every audio
file also asked Postgres `blob_access`: two serial round trips per file, for
a phone downloading tens of thousands (performance-audit-app.md V1). Each
isolate now remembers a verified token's claims, keyed by the token's
SHA-256, until the token expires or 60 s pass, and still asks whether its
session is live on every request (118's check and its 30 s cache are
unchanged, so a signed-out phone loses access as 118 says), and each `blob_access`
answer per person, organization, stream and mode for 60 s (a refusal for
10 s); library media in an organization's own stream is per file, as
`_library_media_readable` decides it (`apps/web/worker/isolateCache.ts`).
Both are bounded to 5,000 entries. A member who is removed may keep
opening files from an isolate that already answered for them for up to a
minute; Carl accepted that. Moving the hosted project to
asymmetric signing keys, so tokens are checked without Auth, is a separate
step to take through the repo's Supabase config (`docs/cloudflare.md`).
Reverse if: a removal must cut access at once (a takedown, say); then drop
the access cache, or clear it from the event that removes the member.

Amended (2026-10-26, Carl Sauder): three more answers are kept per isolate,
on the same terms (performance-audit-2026-10-26.md item 10). The agent API's
token records, keyed by the token's hash, for 15 s, so a revoked token can
still be used for up to 15 s from an isolate that already read it, and the
last-used write no longer holds up the response (`ctx.waitUntil`). A
person's organizations, for the reports route only, for 30 s, so someone
removed from an organization may read its reports for up to 30 s; /connect
and links still ask each time. Agent reads trust the organization's stream
heads for up to 3 s and pull only when a head moved past what the object
holds; writes and the read after a write still pull. Reverse if: as above,
or an agent must see another writer's work within a second.
