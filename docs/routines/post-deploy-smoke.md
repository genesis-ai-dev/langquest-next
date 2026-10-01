# Post-deploy smoke

Runs: every 15 minutes. Tools: Linear, git, Jev, the deployed web build.

## Prompt

Check that what reached Live actually works, and undo it if not.

1. List LAN issues in Live whose comments have no line starting `Smoke `. If
   none, stop.
2. For each, take the commit SHA from its `Deploying <sha>` comment. Pick the
   journey in smart-tests/journeys that covers the area the issue changed;
   if none does, run the sign-in and open-a-language journeys.
3. Walk it against the deployed web build with Jev. Check the outcome oracles
   (event log, blob store, server), not just that the page rendered. A journey
   that could not run is a failure to report, never a pass.
4. Pass: comment `Smoke <sha> ok` with the journey names. Fail: comment
   `Smoke <sha> failed` with what broke and the evidence, and move the issue
   to Outage.
5. On a failure, revert first: `git revert` the commit (message `Revert "..."
   (LAN-n)`), run `npm run typecheck` and `npx vitest run`, push to main. A
   revert that touches a guarded path (docs/routines/README.md) is not pushed:
   open a pull request and ask for a person. Do not try a forward fix in this
   run; the executor takes that as a new issue.
6. If more than two issues failed in one run, stop reverting and report: the
   journey itself may be broken.

Never change anything but comments, status and reverts.
