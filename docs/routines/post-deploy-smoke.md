# Post-deploy smoke

Runs: every 15 minutes. Tools: Linear, git, the web UI suite (Playwright), the deployed web build.

## Prompt

Check that what reached Live actually works, and undo it if not.

1. List LAN issues in Live whose comments have no line starting `Smoke `. If
   none, stop.
2. For each, take the commit SHA from its `Deploying <sha>` comment. Pick the
   spec file in web-tests/ui that covers the area the issue changed; if
   none does, run 01-getting-in.spec.ts.
3. Run it against the deployed web build:
   `npm run test:ui:web -- web-tests/ui/<file>`. Check the evidence (event
   log, blob store, server), not just that the page rendered. A spec that
   could not run is a failure to report, never a pass.
4. Pass: comment `Smoke <sha> ok` with the spec file names. Fail: comment
   `Smoke <sha> failed` with what broke and the evidence, and move the issue
   to Outage.
5. On a failure, revert first: `git revert` the commit (message `Revert "..."
   (LAN-n)`), run `npm run typecheck` and `npx vitest run`, push to main. A
   revert that touches a guarded path (docs/routines/README.md) is not pushed:
   open a pull request and ask for a person. Do not try a forward fix in this
   run; the executor takes that as a new issue.
6. If more than two issues failed in one run, stop reverting and report: the spec itself may be broken.

Never change anything but comments, status and reverts.
