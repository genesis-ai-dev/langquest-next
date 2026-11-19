# Routines land their changes through a pull request and the merge queue, since main takes no direct push

Date: 2026-11-19 · By: Carl Sauder · Status: accepted

Reason: the routines in `docs/routines/` were written when a routine could
push to `main`: the agent executor's last step was "Push to main", at most 8
a day, and the post-deploy smoke reverted a failed change and pushed the
revert. Decision 150 then made `main` take no direct push, and
`.github/rulesets/main.json` has no bypass actors, so both steps would be
refused as written. Two ways were weighed: a pull request that waits for a
person, or a pull request that the merge queue lands once its checks pass.
Carl chose the merge queue (2026-11-19). It keeps what the routines were
written for, work moving with no person in the loop outside the guarded
paths, and it adds the `gate` check that every other change passes. Other
automation already lands its own changes this way: the tutorial fixes and
the release copies open a pull request and turn on auto-merge (decision 155,
`.github/workflows/tutorial-review.yml`). So:

- The executor commits with the issue ID, pushes a branch of its own, opens a
  pull request with the issue ID in its title and turns on auto-merge
  (`gh pr merge --auto --merge`). Its limit is 8 pull requests queued a day.
- The smoke routine's revert goes the same way, so an Outage is undone as
  soon as the queue has checked the revert.
- A change or a revert that touches a guarded path
  (`docs/routines/README.md`) gets no auto-merge and waits for a person, as
  before.

Reverse if: a routine's pull request merges a change a person would have
stopped, or the queue makes a revert too slow while an issue is in Outage.
Then guarded paths grow, or reverts wait for a person.
