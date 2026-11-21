# Claude may run the tests on a release copy, which the release bot opens from merged code

Date: 2026-11-20 · By: Caleb Koster · Status: accepted

Reason: Claude's GitHub action, from v1.0.276 (Dependabot, 2026-11-16), refuses
`npm`, `npx`, `node` and other commands that run code from the checkout on a
pull request whose author it cannot confirm as a writer
(`restrict_untrusted_prs`, on by default). The release bot
(`langquest-release-branches`) opens every copy onto a release branch
(decision 155), and the action does not count the bot as a writer. So
Claude could not run `npm ci` or the guardrails on copies #549, #559 and #564,
its three tries checked nothing, and a person had to finish all three. The
setting protects the job's secrets from code that an outside person wrote. A
copy holds only commits that already merged into main, from a branch in this
repository that only the bot makes, so no outside person writes its code.
Caleb chose (2026-11-20) to turn the setting off in
`.github/workflows/release-copy-conflict.yml` only. Every other Claude job
keeps the default, and `scripts/releaseBranches.test.ts` holds both.
Reverse if: anyone other than the release bot can open a pull request onto a
`release/*` branch that starts this workflow, or a copy can hold code that did
not merge into main first.
