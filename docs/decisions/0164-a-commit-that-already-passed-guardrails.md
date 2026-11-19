# 164. A commit that already passed guardrails is not tested again: the merge queue takes the pull request's run of the same tree, and the push takes the queue's

Date: 2026-10-23 · By: Carl Sauder · Status: accepted

Reason: a merge took about 12 minutes after its pull request was green, and
none of it tested anything new. The queue merges one pull request at a time
with a merge commit (decision 150), so when main has not moved since the
pull request's last run, the queue's entry has the same files as the commit
that run tested (refs/pull/N/merge). Then the queue pushes that same commit
to main, and the push run tested it a third time, on 9 runners. Carl asked
(2026-10-23) to skip both, with a time limit on the first. Amends 150.
- **The queue.** A green pull request run's `gate` uploads an artifact named
  for the tree it tested, `tested-tree-<tree>`, kept a day. In the queue,
  `scope` (`scripts/ci-tested.mjs`) looks for one named for the entry's
  tree, from a guardrails `pull_request` run whose head is the entry's
  second parent (the pull request's head), made in the last 60 minutes.
  Found, `scope` says `tested` and every job, `checks`, `unit` and
  `coverage` too, is skipped; `gate` passes and names that run. The head
  must match, not only the tree: any branch could hold the same files and
  a workflow that skips its tests. The limit is there because some checks
  read things outside the tree: `server-calls` and `test:old-sync` read the
  store builds from EAS, which change without a commit.
- **The push.** A push whose commit has a green `gate` from a guardrails
  `merge_group` or `push` run of that same commit runs no tests. A pull
  request run's `gate` does not count: GitHub puts it on the pull request's
  head, but it tested the head merged with main, so a branch fast-forwarded
  to that head (develop) is tested. Any other push runs every job, as before.
- **Caches.** A pull request can read only its own caches and main's; the
  queue's are its own. The push run was what saved main's Docker images,
  Playwright browsers and npm cache after a key changed. `warm-caches` does
  that on a push that runs no tests: it looks each cache up, and only when
  one is missing pulls and saves it (`.github/actions/docker-images` phase
  `warm`, `.github/actions/playwright` `warm`). The Docker cache key moved
  to `v2`: the v1 job images' cache held only `node:24-slim`, so every
  `ui-web` shard pulled the stack from a registry. When ECR turns the CLI
  away, it pulls the same images from `ghcr.io` (or Docker Hub), and `save`
  looked only for ECR's names (seen in run 39994259704, this change's first).
  `ci-docker-images.sh save` now gives each such copy ECR's name, the one the
  CLI looks for first, and keeps nothing without the database image.
- **No image cache in the browser jobs.** Measured on this change's pull
  request (run 39996890150): with the cache cold and the CLI pulling, the
  runs took 352 and 374 seconds; with it warm, 425. Fetching the 1.2 GB
  archive took 26 to 54 seconds in the foreground, and loading it left the
  `ui-web` shards waiting 76 to 98 seconds for the stack, against 22 to 68
  when they pulled. ECR rate-limited both cold runs, and the CLI took every
  image from `ghcr.io` without a failure. Carl chose (2026-10-23) to drop the
  cache from `web-smoke` and `ui-web`, which set a pull request's length,
  and rely on the CLI's pulls and `scripts/ci-retry-pull.sh`. `server` keeps
  it: it ends minutes before the browser jobs, so the load costs no wall
  time there. So do the nightly jobs, which nobody waits for and which would
  lose a night's results to a refused pull. `warm-caches` keeps both
  caches filled for them.
- **What else read the push run.** The flake tracker counts merge queue runs
  too (`scripts/ui-flake-report.mjs`). `gate` still tells Linear when
  `checks`, `unit` or `coverage` failed on a push that ran them.
Building several queue entries at once was weighed and left out: merges
seconds apart would lose release-branch copies (decision 150, amended
2026-10-23; decision 155), and `scripts/githubRules.test.ts` holds one.
Reverse if: a merge into main breaks main though its queue entry took a
pull request's run (then the tree is not the whole input, and the queue
runs every job again); pull requests miss main's caches after a key
change (then `warm-caches` is not filling them); or a browser job fails
because both ECR and `ghcr.io` refused its pulls (then the browser jobs
restore the image cache again, loading it in the background).

Amended (2026-11-19, Carl Sauder): the pre-push hook does not run its
checks again on files that `npm run guardrails` just passed. Carl asked
(2026-11-19) which of the runs in a fix's way to main could be skipped. An
agent ran `npm run guardrails` and then pushed, and the hook ran its
typecheck, lint, unit suite and bundle check on the same files again: 184
seconds measured here (the hook said "about 15 s"), on every push, and
guardrails' `checks` level holds all four. When those checks pass on a run
that began and ended with nothing uncommitted or untracked on the same tree,
`scripts/guardrails-passed.mjs` records the tree in the worktree's git
folder; the hook reads what git is pushing and skips when every commit
pushed has that tree, and runs as before otherwise, or on any error. The
tree, not the commit, because the same files give the same results (an
amended message changes nothing tested), and the unit suite reads nothing
else that a push changes. `scripts/guardrailsPassed.test.ts` holds that the
hook checks nothing guardrails does not. The other runs stay. The pull
request run is the one check main requires and the only test of the change
merged with main. Of the last 30 merge queue entries, 11 took the pull
request's run; about 12 ran because main had moved, which is what the queue
is for; about 4 ran only because that run was over an hour old, which the
limit above keeps for the store builds read from EAS. All of the last 30
pushes to main ran no tests.
Reverse if: a push the hook skipped fails `checks`, `unit` or `coverage` in
its pull request's run where the same commit's guardrails passed and main
had not moved (then something outside the tree decides a result, and the
hook runs every time again).
