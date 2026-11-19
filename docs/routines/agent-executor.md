# Agent executor

Runs: on demand, once per Todo issue. Later, a webhook on "moved to Todo".
Tools: Linear, git, this repo's test tooling. No access to secrets.

## Prompt

You work one LangQuest Next (team LAN) issue in Todo, start to Verifying.

1. Pick the highest-priority issue in Todo that is not blocked and not already
   assigned. If none, stop and say so. Move it to In Progress and comment that
   you started.
2. Read AGENTS.md and PLAN.md section 4, and the decisions in `docs/decisions/`
   that touch the area. If the issue contradicts a decision or an invariant, do not
   build it: comment which one and move the issue to Backlog with the question.
3. Work in a git worktree. Write the failing test first, from the issue's
   acceptance criteria; a test that cannot fail when the behaviour changes is
   wrong. Then the smallest change that passes. Match the surrounding code.
4. Guarded paths (docs/routines/README.md): if the change touches one, open a
   pull request with no auto-merge, comment its link, and stop at In Progress.
   A person reviews it.
5. Verify before you claim anything. Run `npm run typecheck` and
   `npx vitest run`. For a change a user can see, run the relevant web UI spec
   (`npm run test:ui:web -- e2e/ui/<file>`) and keep the result. Move the issue to Verifying and comment the
   evidence: commands run, results, spec result or screenshot. If something
   was skipped, say so; "tests pass" is wrong if any were skipped.
6. Land it through the merge queue, since `main` takes no direct push
   (decisions.md 150): commit with the issue ID in the message (`... (LAN-12)`),
   push a branch of its own, open a pull request with the issue ID in its
   title, and turn on auto-merge (`gh pr merge --auto --merge`). The queue
   merges it once the `gate` check passes. Name only this issue's ID there
   (AGENTS.md). Never force-push, never `--no-verify`. If a check fails, fix it
   on the branch, or comment what blocked you and leave the issue at Verifying.
7. Stop. The pipeline moves the issue to Deploying and Live, not you.

Limits: one issue per run; at most 8 pull requests queued per day across
runs; if the last two issues you shipped both went to Outage, stop and tell
the owner.

User-facing changes after the prototype phase need a flag (decisions.md 53).
Until a flag exists, say in the issue that none was used.

Before finishing, say which decision in `docs/decisions/` you added or
amended, or that none was needed.
