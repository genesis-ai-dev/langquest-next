# 150. A pull request is merged into main only when the checks that its changed files need are green, and main takes no direct push

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: main had no branch protection and no ruleset, so a pull request
could be merged into main while a guardrails check was red, and every merge
into main deploys (decisions 42, 43, 45). The rule now lives in the repository
as `.github/rulesets/main.json`: a GitHub ruleset on `refs/heads/main` that
requires one check, the guardrails `gate` job, reported by the GitHub Actions
app. Nobody can bypass the ruleset, so a repository admin cannot merge past a
red check either. GitHub applies a required check to pushes as well, and a
pushed commit has no checks yet, so main takes no direct push: every change
reaches main through a pull request, and so does every commit that the
pipeline makes. Caleb chose this over letting admins bypass the ruleset,
because a bypass would also let an admin merge a red pull request.

Caleb also asked (2026-10-22) that a pull request run only the checks that its
changed files need: a pull request that changes only `docs/decisions.md`
does not need the UI tests. A new `scope` job (`scripts/ci-scope.mjs`) reads
the files that the pull request changes since it met main, and says which of
`server`, `web-smoke` and `ui-web` they need; the jobs that are not needed
are skipped. `checks` always runs (about 2.5 minutes), because it holds the
decision log's test and every other unit test. The shared code
(`packages/core`, `packages/sync`), `supabase` (migrations and functions),
`library`, `scripts`, `.github`, `.githooks`, any `package.json` or lockfile,
`vitest.config.ts`, the root `tsconfig` files and any file that no rule names
run every job. The docs, the skills and Markdown files run `checks` alone;
`apps/mobile`, `apps/web`, `e2e` and `app.json` run the two browser jobs; the
SQL smokes in `server` run the `server` job. When `scope` cannot tell, it runs
every job, and a push to main, the nightly run and a manual run run every job.
The jobs still test the pull request merged with main. A required check that
never starts leaves a pull request waiting forever, and GitHub counts a
skipped job as passed, so main requires the `gate` job instead of the jobs
themselves: `gate` runs whatever happened to the others (`if: always()`) and
passes only when `scope` and `checks` passed and every job that `scope` named
passed. `scripts/githubRules.test.ts` fails when a job that runs on a pull
request is missing from `gate`'s needs, so a new job cannot fail without
holding a merge. Of the last 60 pull requests merged into main, 27 would have
skipped `server` and none would have skipped the browser jobs; no `server`
job failed on main in the last 60 runs on main.

This builds on an earlier change that never reached main (branch
`caleb/light-decisions-ci`, 2026-10-20): a push that only merged main and
renumbered its decision, after a run that passed, would run only typecheck,
lint and the decision log's test. That design skipped the full tests of a
code change on top of the newest main, the last such run before a merge
that deploys to production, and that concern still holds, so this change
leaves it out. Choosing jobs by the pull request's whole change does not
have that cost: a pull request that changes code runs the code's jobs on
every push, and a pull request that changes only the docs changes nothing
that the other jobs test.

The ruleset does not require a branch to be up to date with main before the
merge, because guardrails already runs on the pull request merged with main,
and requiring it would rerun up to 12 minutes of checks on every open pull
request after each merge. `npm run github:rules` (`scripts/github-rules.mjs`)
compares each file in `.github/rulesets` with the ruleset of the same name on
GitHub and says what it would change; `npm run github:rules -- --apply` makes
the change and needs a repository admin. Amends 53: small changes still go to
main on their own, but through a pull request.
Reverse if: a fix that cannot wait for the checks is held up often enough to
matter (then add a bypass for a named team with `bypass_mode: pull_request`
and record who may use it); main's run fails in a job that `scope` skipped on
the pull request (then move the file that caused it to a rule that runs that
job); or merges pass checks that were green against an older main and break
it (then turn on `strict_required_status_checks_policy` or a merge queue).

Amended (2026-10-23, Caleb Koster): pull requests merge through GitHub's
merge queue. Two pull requests that were each green against main could still
break it together, for example by taking the same decision number, and the
run on main found that only after the merge. In the queue, `gate` runs again
on main as it will be with the pull requests ahead (the `merge_group`
trigger in guardrails.yml), and a pull request merges only when that run is
green. `scope` measures the files that the queued pull requests change on
main, so a change to the decision log still skips the browser jobs. The
queue tests and merges one pull request at a time, with a merge commit as
before (`.github/rulesets/main.json`): the release-branch job (decision 155)
copies the one merge that a push to main brings, and keeps only one run
waiting, so merges pushed together or seconds apart would leave a copy out.
A pull request waits for the ones ahead of it, about ten minutes each. The strict
up-to-date rule was the other way: it needs no code, but every merge would
make every open pull request update and run its checks again.

Amended (2026-10-23, Carl Sauder): a queue entry runs no job when the pull
request's own green run of the last hour tested the same tree, and a push
to main runs no tests for the commit that the queue passed; `checks` is
three jobs, `checks`, `unit` and `coverage` (decisions 163, 164).

Amended (2026-11-07, Carl Sauder): `gate` needs one more job,
`android-native` (234), which `scope` names when the nearby module's files
(`apps/mobile/modules/nearby-link/**`), `apps/mobile/package.json` or the
root `package-lock.json` change (Carl's answers 3 and 22). It prebuilds the
Android project and compiles, unit-tests and lints the module. Shared code,
other dependencies and unmatched files now run `SHARED` (the three jobs they
ran before), not every name in `JOBS`, so a change to core or a script
compiles no Kotlin; a nightly run, a manual run and a scope error still run
every job. AGENTS.md's Guardrails table has its row.

Amended (2026-11-16, Carl Sauder): a sixth scoped job, `ios-native`, for the
nearby module's Swift (256): on a Mac (`macos-26`, free for a public
repository), its Swift package's tests against the golden vectors, then the
iPhone app built for the simulator as the nightly iPhone job builds it. It
runs for the module's `ios/` and podspec, for what both halves share (the
contract, the vectors, the module's config), and for `apps/mobile/package.json`
and the root lockfile, as `android-native` does; a Kotlin-only change no
longer compiles Swift, nor a Swift-only one Kotlin. `SHARED` leaves out both.
AGENTS.md's Guardrails table has its row.

Amended (2026-11-19, Carl Sauder): the Guardrails table, and the steps
before a push, moved from AGENTS.md to `CONTRIBUTING.md`, since they bind
people and agents alike; a new job gets its row there. AGENTS.md keeps the
steps an agent takes before it pushes
(`docs/decisions/2026-11-19-each-doc-answers-one-question.md`).
