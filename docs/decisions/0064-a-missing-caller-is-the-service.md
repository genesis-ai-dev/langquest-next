# 64. A missing caller is the service role only because nobody signed out can reach the function

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: the log's functions (`append_events`, `pull_events`, the snapshot
reads and `put_snapshot`, the blob and stream service paths) read a missing
JWT `sub` as the service role and skip their checks, which is how the
workers call them. A signed-out caller has no `sub` either, and these were
never revoked from `anon`, so the public key alone could pull any stream,
overwrite a snapshot, invalidate a blob, and append events as any member.
Postgres grants execute to `public`, and Supabase to `anon`, on every new
function, so the rule cannot rest on each function remembering: migration
`20261007000000_no_anonymous_rpcs.sql` revokes them, and `server/smoke.sql`
section 14 fails when any security definer function in `public` that `anon`
may run is missing from its short list (today only `preview_invite`). The
app no longer opens a placeholder organization before it knows the person's
(`App.tsx` `Shell`, `useOrg` with no organization): a guest, or an account
in none, syncs nothing, so it is never refused for an organization it is
not in.
Reverse if: signed-out people need to read a stream; then give that read
its own function that checks the stream is public, not a null caller.

Amended (2026-10-07, Carl Sauder): row-level policies run as the caller,
so a function made service-role only must not appear in one. The read
policies on `invites` and `join_requests` called `org_privileges`, and every
signed-in read of either table failed. They now call `my_privileges` (the
caller's own privileges) instead
(`20261007120000_policies_use_my_privileges.sql`). Granting `org_privileges`
back to `authenticated` was rejected: it answers for any profile in any
organization, so anyone signed in could learn who holds which role
elsewhere. `server/smoke.sql` section 15 reads both tables as a signed-in
caller.
