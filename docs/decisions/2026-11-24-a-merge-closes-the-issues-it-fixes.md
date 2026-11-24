# A merge closes the Linear issues it fixes, and the dashboard's cards follow Linear

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-11-24) that the list of issues on the ops dashboard
tell the truth, with one central path: when a pull request merges, an agent
checks the open issues it affects and closes or updates them in Linear, and
the dashboard follows Linear. Before this, an issue moved only when a commit
or the pull request named it (decisions.md 53, and Linear's own GitHub
integration). A change that fixed another issue left it open in Linear and on
the dashboard, and nothing looked again. The dashboard also put an issue under
Merged when any merged pull request named it in its description, also as
"Part of", while Linear still had it open.

- **After each push to main, Claude checks the merge against every open
  issue.** `.github/workflows/linear-sync.yml` first moves the issues the
  commits name, as before. Then its job `affected` gives Claude (the agent
  team's token, `AGENT_TEAM_CLAUDE_TOKEN`; no key, no network, no shell but
  git) the pull request with its description and changed files, and every
  open issue of the team not already merged (Deploying, Verifying), with
  its words cut. Claude follows the `merge-issues` skill and writes
  `.merge-issues/decisions.json`: for each issue the merge fixes, `fixed`;
  for each it does a part of, `part`; a reason that names what in the change
  does it.
- **The script applies it, as a named issue moves.** `scripts/merge-issues.mjs`
  checks each decision against the copy of the lists made before Claude (an
  open issue, a merge of the run, a reason, at most 8 fixes from one pull
  request, else none). A fixed issue gets the pull request as a link and a
  comment with the reason, and moves as linear-sync moves a named one:
  Deploying with the lanes the merge reaches, or Live. A part gets a comment
  only: Linear's GitHub integration may close an issue that a merged pull
  request is linked to. Each comment carries a mark, and an issue never hears
  twice about one pull request: a developer who moves it back keeps it there.
- **A sweep each Monday**, and when a developer starts the workflow by hand
  (with the days, and issues to leave out), checks every merge of the last
  days (8 by default; not the last 2 hours) against every open issue, on the
  larger model. It catches a merge whose own run failed. Its fixed issues go
  Live: those merges shipped before it ran.
- **The dashboard follows Linear.** The watch for user issues already reads
  each of its issues' state in Linear every 15 minutes (decisions.md 202). A
  user issue's card is Merged only when Linear says Deploying or Verifying,
  or when the pull request merged in the last 30 minutes (before the watch
  read Linear again). A merged pull request that names an issue Linear still
  has open shows on the card as a part of the work, and the issue stays under
  its open tab.

- **Two leaks that kept merged work open are closed.** A copy onto a
  release branch (decisions.md 155) named the issue in its title, so Linear's
  GitHub integration moved an issue the merge had sent to Deploying or Live
  back to In Progress, where nothing moved it again (LAN-232 since
  2026-11-20). A copy now names only its merge on main, and the dashboard
  reads only pull requests into main as fixes. And an issue whose push's own
  iPhone build failed waited in Deploying for ever (ten nightly issues since
  2026-11-20): a lane that ships a later push now also counts for every push
  that push holds (`git merge-base --is-ancestor`; a checkout without the
  history counts only the exact push, as before).

The check runs on every merge, about 20 a day, on the smaller model at
medium effort. A merge that touches nothing an issue names costs one short
look. No database or Worker change: Linear holds the state, and the watch
already carries it to the dashboard.

Reverse if: Claude closes issues that are not fixed more than once a week
(then `fixed` waits for a developer as a Linear comment only), or the plan's
use for the check grows past what the team accepts (then only the Monday
sweep runs).
