# 155. While a new build is in store review, the public build keeps getting every merge as an OTA update from a release branch

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: once a merge into main changes a platform's native fingerprint, a
new store build of that platform goes to review, and OTA updates from main
reach only that new build. Until Google or Apple approves it, which can take
days, the public build would get no fixes. Caleb chose (2026-10-22) that the
pipeline, not a person, decides when this happens and copies the merges,
and Carl asked how the branches are made and filled. So
(`scripts/release-branches.mjs`, `.github/workflows/release-branches.yml`):
- After each merge into main, a GitHub Action compares each platform's
  fingerprint before and after the merge, the same fingerprint that the EAS
  workflow uses to choose between an OTA update and a new build. When it
  changed and no release branch exists, the Action starts
  `release/<platform>` from the commit before the merge, which is the code
  of the last OTA update that the public build got, and tags the merge
  `rebuild/<platform>/<commit>`.
- Every later merge into main that does not change that fingerprint is
  copied onto the release branch. The pipeline cannot tell a fix from a
  feature, so it copies every one. Each copy is a pull request that merges
  itself (GitHub auto-merge) once its checks pass; no person merges it. A
  copy with a conflict is labelled `copy-conflict`, and Anthropic's Claude
  GitHub Action (`.github/workflows/release-copy-conflict.yml`) copies it,
  keeping the release branch's code where main's change needs code that the
  public build does not have.
- Every merge into a release branch publishes an OTA update on the
  production channel for that platform
  (`apps/mobile/.eas/workflows/deploy-release-branch.yml`). Its runtime comes
  from the branch's own code, so it reaches the public build and never the
  build in review.
- Every hour the Action deletes a release branch whose new build is public:
  the store's live version, from Apple's public lookup for iPhone and from
  Google Play's public app page for Android (the signals that the app's own
  store check uses), is that build's version or a newer one (each store
  build's version is the time of its merge). A store that cannot be read
  keeps the branch, which only sends the public build fixes that it would
  get anyway. When a later new
  build is already in review, the newly public build gets its own branch,
  started from the commit before that later build, with the merges since
  copied onto it.
- `.github/rulesets/release.json` requires the guardrails `gate` on
  `release/*`, so a copy merges only when green.
A change that needs a new build is never copied, because the public build
cannot run it. It all stays off until the repository variable
`RELEASE_BRANCHES` is `on`, which needs a GitHub App installed on this
repository with Contents and Pull requests write (secrets `RELEASE_APP_ID`
and `RELEASE_APP_PRIVATE_KEY`; a pull request that the built-in token opens
starts no checks), "Allow auto-merge" turned on, and the secret
`ANTHROPIC_API_KEY` for the conflict step.
Reverse if: copies go wrong on the public build often enough that a person
should approve each one (then turn off auto-merge), or a store page stops
showing its live version (then read it from the store's API where one can
say so).

Amended (2026-10-22, Caleb Koster): the conflict step runs without an
Anthropic key too. This repository has none yet, and a key in another
repository cannot be shared. Without `ANTHROPIC_API_KEY`, the step tries the
copy again, comments once on the copy pull request naming the files in
conflict and the steps to finish it, and leaves it open for a person or a
Claude session; nothing fails. With the key, Claude finishes it as before.

Amended (2026-10-23, Caleb Koster): the hourly cleanup now finds the newest
new build that is live. When it is the newest of all, the branch goes and no
other starts; only when an older one went live while a newer one is still in
review does a new branch start, from just before the newer one. Before, it
would have started a branch for a build that was never public. The
repository variable `RELEASE_BRANCH_PLATFORMS` ("android" for now) names
the platforms that keep a branch: no public iPhone build takes OTA updates
from main yet (build 36, 1.0, runs code of 2026-10-16), so an iPhone branch
would only feed TestFlight.

Amended (2026-11-05, Caleb Koster): Caleb asked that every older build that
can run a merge gets it, iPhone included, that Claude finishes copies with
his Claude plan's token, and that the ops dashboard shows the same pull
request in each build that has it. So:
- iPhone keeps a branch again. App Store build 45 (2026.1026.1817) is public
  and takes OTA updates, and has had none since PR 259 changed the iPhone
  fingerprint on 2026-10-28. The workflow no longer sets
  `RELEASE_BRANCH_PLATFORMS`, so both platforms keep branches. The new
  iPhone builds made while iPhone kept none are listed in
  `scripts/release-rebuilds.json`, and each run tags any that lacks its tag.
  Every hour, a platform with no branch whose store shows a build older than
  a newer one gets a branch, from the commit before the first new build that
  is not public, and one copy pull request catches it up on every merge
  since ("catch the public iPhone build up on N merges from main").
- Only a merge that changes what the phone app runs is copied: files in
  `apps/mobile` other than its tests, scripts, website files and EAS
  settings, the sources of `packages/core` and `packages/sync`, and the
  `package.json` files. A merge for the website, the ops dashboard, the
  server, tests or docs sent the public build its own code again, and its
  copy could only conflict (PRs 336, 338 and 340 on 2026-11-05).
- A conflict in a file outside the phone app and its tests (docs and this
  log, scripts, the server, the website, tutorial filming) keeps the release
  branch's version, so Claude gets only conflicts in the app. A trial of the
  iPhone catch-up on 2026-11-05 copied 15 of its 22 merges on its own; 7 need
  Claude.
- Each copy first takes main's release workflows, this script and its test
  (`MACHINERY`): a pull request runs its own branch's workflows, so a branch
  started from an older commit ran the older conflict step.
- Every hour, a branch that serves another build than the public one starts
  again (`servesAnother`): the first new build after its start must be the
  first one that is not public. `release/android` started on 2026-11-03
  from PR 322's merge (Android fingerprint e3bff02c), as PRs 322 and 319
  both needed a new build a minute apart, while Google Play showed build 48
  (80d370c0); none of its copies since reached build 48's phones.
- Claude signs in with `CLAUDE_CODE_OAUTH_TOKEN`, a Claude plan's token as
  the nightly jobs use, or with `ANTHROPIC_API_KEY`.
- The ops dashboard shows a copied pull request in each build that has it:
  from main in the new build, and in the public build as a copy named with
  its copy pull request, first as "PR open, not merged yet" while the copy
  is open. No person merges a copy, so nobody would hear of one that is
  stuck: a copy whose tests failed, or that has been open for 3 hours, is a
  problem under Needs attention, linked to the copy.

Amended (2026-11-05, Caleb Koster): the first iPhone catch-up (PR 344) did
not start Claude, and its checks failed, so the ops dashboard asked Caleb to
fix it. Caleb asked that a copy whose tests fail need no person, and that
Claude examine every copy before it merges: a copy that applies without a
conflict may still change a feature that only the newer build has. So:
- Every copy is labelled copy-claude (and copy-conflict when it stopped at a
  conflict), which starts Claude. Claude finishes the copy, examines each
  copied change against the release branch's code, takes out each part
  that does not fit the public build (it changes or needs a feature that
  only the newer build has), comments one line for each commit (copied,
  copied in part, or left out, and why), and closes a copy of which no part
  fits. Only Claude turns on auto-merge; the script no longer does. Without
  a Claude token, a copy without a conflict merges itself as before.
- Claude's action turns away any bot it is not told to allow, and the
  release App labels the copies, so `allowed_bots` names the App.
- A copy runs its own branch's workflows and scripts. Every hour, each open
  copy whose release workflows or scripts differ from main's takes main's
  (`freshenCopies`), so its checks run again with them, and one labelled
  copy-claude or copy-conflict is labelled copy-claude again so that Claude
  starts with them. The
  server-calls check is now part of `MACHINERY` (decision 151 amended).
- Every hour, a copy whose `gate` check failed, and that neither Claude nor
  a person works on, gets Claude: the run comments ("The checks of this copy
  failed …, try N of 3") and labels it copy-claude. Claude reads the failed
  checks, fixes them and never skips, disables or weakens a test; a change
  that needs code the public build does not have is left out. After 3
  tries, the copy is labelled copy-needs-person.
- The ops dashboard says "waits for Claude to examine it", or "failed its
  tests, and Claude is fixing them" (or "starts fixing them within the
  hour"), and asks for a person under Needs
  attention only after Claude's 3 tries, or when the copy has been open for
  3 hours.

Amended (2026-11-05, Caleb Koster): Claude's two runs on PR 347 said
"copied", and no push of theirs reached the branch (the action hides why;
its run on PR 344 did push). The first also turned on auto-merge for PR
347, which then held only main's workflows. Caleb asked that the copies go
green with no person. So Claude no longer writes to GitHub:
- Claude commits its work on the copy's branch, and writes what it did
  with each listed commit in `.release-copy.json` (git ignores it):
  copied, copied in part, or left out, and why, or that it could not
  finish. Its tools read the pull request and its checks, and cannot push,
  comment, label, close or merge.
- The workflow's next step, its own copy of `release-branches.mjs
  finish-copy` (kept from before Claude's run), pushes Claude's commits with
  the App's token (only while the branch is where Claude started, and with
  no git hook: the checks run what the hooks would). The copy is finished
  when every listed commit has a result, and each one copied is on the
  branch. Then it comments a line for each commit, takes off the labels and
  turns on auto-merge, or closes a copy of which nothing fits.
- A copy that Claude did not finish (no result, a commit neither on the
  branch nor left out, changes not committed, or a push that failed) gets a
  comment, and is labelled copy-conflict alone. The hourly run starts
  Claude on it again, as on a copy whose checks failed; the 3 tries count
  both. The ops dashboard says "is not finished, and Claude tries again
  within the hour".
- One run at a time for each copy (`concurrency`).
- The unit jobs check out one commit, without main, so the server-calls
  check fetches main's newest commit when it is missing (decision 151).

Amended (2026-11-05, Caleb Koster): the first hourly run after that gave
PR 344 a try for the failed checks of its commit before the one it had
just pushed. Also, three copies were open on release/ios at once (PR 344,
PR 347, PR 351), each changing the end of the decision log: PR 344 merged
at 22:32 UTC, and PR 347 then had a conflict. So the hourly run counts no
check of a copy that it just freshened (its checks run again), and starts
Claude on a copy that has a conflict with its release branch, as on one
whose checks failed (the same 3 tries). Claude first merges the release
branch into the copy, never rebasing or forcing a push.

Amended (2026-11-06, Caleb Koster): at 00:42 UTC the hourly run labelled
PR 347 for its conflict, and no Claude run started: GitHub runs no
`pull_request` workflow on a pull request with a conflict. So for a copy
with a conflict the hourly run also sends a `repository_dispatch`
(event type `release-copy`, with the copy's number), which runs main's
`release-copy-conflict.yml` for that copy. The workflow finds the copy
from the number and stops unless it is an open copy onto a release
branch. A `copy-claude` label on a copy with a conflict no longer means
that Claude is on it, so the hourly run starts Claude again (the same 3
tries).

Amended (2026-11-06, Carl Sauder): the copy of PR 357 onto `release/ios` kept
the branch's `apps/admin/src/sources/ops.ts` in a conflict and took main's
`apps/admin/test/ops.test.ts`, so the pre-push hook failed in the workflow's
first push. That left no pull request and stopped the job before Android. The
hourly run only looks at open copies and a merge is copied once, so nothing
tried it again, and Carl asked how such a copy is ever corrected. So:
- The first push of a copy runs no hook, as the push of Claude's commits
  already did. The copy's pull request then always opens, its checks run what
  the hook would, and a copy they fail goes to Claude and then a person. A
  first push that fails for another reason, such as the network, is still not
  tried again. The hourly push that gives an open copy main's machinery runs
  no hook either, or a copy with failing tests could never take it.
- `packages/sync/src/testing/` no longer counts as what the phone app runs.
  It is Node-only test helpers that the app never imports, and PR 357 was
  copied only because it changed two of them.


Amended (2026-11-08, Carl Sauder): a phone with no Play Store gets a carried
file after a native change (246), because this entry deletes
`release/android` once the new build is public, and over-the-air updates
after a native change reach the old runtime only through that branch, so
such a phone would otherwise get nothing for good until a newer file exists
(docs/nearby-sync-plan.md 14.4). While the new store build is in review, a
merge touching the files nearby sync added is copied to `release/android`,
where they do not exist, and conflicts, so such merges wait until it is
public (section 7). Caleb should see this, since 155 is his entry.

Amended (2026-11-13, Carl Sauder): the copies onto `release/ios` in PRs 437
and 441 failed `unit`. Nearby sync had made `scripts/serverCalls.test.ts`
import `FIELD_PROFILES` from `apps/mobile/scripts/store-build-guard.mjs`. A
copy takes that test from main as machinery, but keeps the release branch's
guard, which on a branch from before carried builds has no such export. So
the machinery may import only machinery: `scripts/releaseBranches.test.ts`
fails when a file in `MACHINERY` imports a local file that is not in it. The
check that the guard holds the same two profiles as the server-calls check
moved to `scripts/storeBuildGuard.test.ts`, which a release branch keeps at
its own version, and is skipped on a release branch, where the guard is the
public build's and the server-calls check is main's. Taking the guard from
main instead was rejected: it is the phone app's build code, which a copy
leaves as the public build has it.

Amended (2026-11-13, Carl Sauder): from the merge of nearby sync on, every
copy in which Claude made commits (PRs 434, 437, 439, 440, 441 and 444) ended
with "its commits could not be pushed ... error: 400". The dependency upgrades
in that merge moved `actions/checkout` from v4.4.0 to v7.0.1. That version
keeps its token in a file that an `includeIf` entry pulls into the repository's
git config. Claude's action removes the checkout's token from the local config
and from plain `include.path` files, but not from that one. So the push of
Claude's commits (`pushCopy`, which brings its own header) sent two
Authorization headers, and GitHub refused it. The copy workflow's checkout now
keeps no credential (`persist-credentials: false`, as `user-issues.yml`
already did), and `scripts/releaseBranches.test.ts` holds it there. The
repository is public, so the workflow's fetches need none.
