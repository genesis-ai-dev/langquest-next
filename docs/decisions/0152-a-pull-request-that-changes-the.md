# 152. A pull request that changes the database runs the sync test from every supported store build's commit against it

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: a migration can keep every server call's name and still break how an
older build syncs, by refusing an event that the build sends or a file that
it uploads, and people keep store builds for a long time. So the guardrails
`server` job, after this checkout's own integration test, runs
`npm run test:old-sync` (`scripts/old-sync-tests.mjs`) when the pull request
changes `supabase/migrations`. For each commit of a supported store build
(the builds and their commits from `storeBuilds()` in
`scripts/server-calls.mjs`, from EAS with `EXPO_TOKEN`, otherwise
`apps/mobile/store-builds.json`), it takes that commit's packages, its
`server` and its Worker code out of git into `.old-sync/<commit>`, and runs
that commit's sync integration test (`packages/sync`, or `packages/client`
before 2026-10-14) with this checkout's dependencies against the database
that the job built from the pull request's migrations. A test that the old
file skips counts as a failure, so a test that did not reach the database
never passes quietly. A failure names the builds, for example "Build 25
(Android) (commit 683289d9): its sync test 1 of 7 tests failed against this
database". The 12 commits took under two minutes locally, in the job that
already holds the stack, so a pull request is no slower than its slowest job
was. It runs only on pull requests, not on main's own run.
The first run, against main on 2026-10-22, found that today's server already
refuses the `v1.MemberAdded` events and the recording uploads to Supabase
Storage of Android builds 9 to 12 and iPhone builds 30 to 32, so the
supported builds start at Android 13 and iPhone 33.
The old test also drives the server code of its own commit (the projection
worker, the Worker's blob routes), which main replaced since; a failure
there is still a finding about that build's test, and is fixed by raising
the supported builds or by keeping the old behaviour.
Reverse if: the old tests fail often for reasons that phones never meet
(then run only the parts of each test that phones run), or the run grows
past the `server` job's other steps (then run the commits in parallel jobs).

Amended (2026-11-07, Carl Sauder): `append_events` is restated once, for
the `by:` rule (215): a caller's event whose id, or the id a create makes,
names someone else is refused with a reason that reads as `INVALID`. Any
other id behaves as today, so old builds keep their results, which this
entry's old-sync run checks in CI on the nearby branch's pull request
(`supabase/migrations/20261112010000_nearby_identity.sql`,
`docs/nearby-sync-plan.md` section 12). `may_emit` is restated once too, in
phase 4.

Amended (2026-11-08, Carl Sauder): `may_emit` is restated once for delivery
(docs/nearby-sync-plan.md section 6, decision 97 as amended), which changes
one result for an old build: an undo of a departure the server does not
hold, sent by someone without Override checkpoints, is refused, where it
was accepted. No store build's integration test sends one. Everything else
in `20261112030000_nearby_relay.sql` is new names (`relay_append_events`,
`revoke_install_keys`, `install_key_limit_raise`, `blob_named_by` and
helpers, a `server_config` column), `take_sign_in_code_v2` keeps its
signature and answers, and `append_events` is not touched, so old builds
keep their results.
