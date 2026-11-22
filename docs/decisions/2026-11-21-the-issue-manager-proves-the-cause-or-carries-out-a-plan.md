# The issue manager proves the cause, or carries out a plan that proves it

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: many issue cards ended with "The cause is not proven. The manager
did not prove the cause, so it changed nothing." Caleb: "what do you think
my answer is going to be? Obviously, something like, 'then prove it' or
'tell me what you need to do in order to prove it.' It should prove it on
its own, or propose a plan so it can definitively prove the problem and
thus apply a reliable fix." On 2026-11-21, 9 open issues stopped there.

- **Prove it first.** The manager reads production itself, read only as
  `agent_reader` (`docs/production-reads.md`), and follows the code from
  where the numbers point.
- **Else a plan that the team carries out.** The verdict `unconfirmed` now
  needs `next` in `fix.json`: what Claude does next, the whole plan, and in
  how many hours (0.25 to 168). The steps are a probe (the manager's own
  vitest test, run on main in the job `check`, which holds no key), a new
  read of production when more records come, or a timing in the app. The
  watch hands the issue back at that time with the probe's output
  (`ops.user_issue_plans`, `ops_user_issue_plans_due()`), so nothing waits
  for a person to ask. A manager with no `next` tries again at the next run.
- **The rule does not change.** A timing is a change to diagnostics, so it
  waits for a developer's yes before it merges, as before. The card says
  what Claude does after that merge. The probe never merges.
- **A limit.** After 10 tries, each one hand-back of the issue to the
  manager (`PLAN_TRIES`), the watch stops handing the issue back, so one
  issue cannot use the Frontier plan's week. A try waits at least 2 hours
  after the last one, also when the job failed and wrote no plan.
- **No verdict is not "not proven".** A manager run that ended before it
  wrote `fix.json` says so on the card, and the watch runs it again.
- **The card** says what Claude does next and when, never only "not
  proven".

Reverse if: plans repeat without new facts (the same probe or query try
after try), or the tries use a large part of the Frontier plan's week with
few causes proven.
