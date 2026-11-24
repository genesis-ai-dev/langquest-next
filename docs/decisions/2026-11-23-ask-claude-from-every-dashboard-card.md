# An admin asks Claude a question from any card or page of the ops dashboard

Date: 2026-11-23 · By: Caleb Koster · Status: accepted

Reason: a user issue's card and a tutorial video's card had a box to tell
Claude what to do
(`docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md`,
decisions.md 186). Every other card had none. On 2026-11-23 the card "R2
class A operations this month (5,524,967) are past what the plan includes"
said only "You do this one yourself", and Caleb could not ask Claude what R2's
prices and plans are, or whether the app downloads or handles files twice.
He asked for that on this card and across the dashboard. Now each line's card
with no Linear issue, each page and the Overview have a box, "Ask Claude"
(`apps/admin/src/pageAsk.ts`). A card with one Linear issue keeps its own
box, which answers too.

- **The question goes with the card.** The page sends `card-question` to the
  app Worker's `OpsActions` (`apps/web/worker/opsActions.ts`, decisions.md
  162): a Global Viewer on an `aal2` session, the card (`line:<key>` or
  `page:<section>`), its title, its words and numbers as the page shows them
  (6000 characters at most) and the question (2000). `ops.card_questions`
  keeps them (migration `20261123233000_ops_card_questions.sql`); at most
  three wait on one card and twenty on the dashboard, since each answer is a
  run of Claude. `ops.actions` logs the card and the question's id, never the
  words.
- **A workflow of its own answers, every 5 minutes.** `card-questions.yml`
  takes the questions through the Worker's door `/api/card-questions`
  (`apps/web/worker/cardQuestions.ts`), which lets in only that workflow on
  main by its OIDC token, as the watch's door does. A question needs no
  Linear issue and changes no code, so it does not go through the watch's
  fix jobs, and it does not wait 15 minutes behind them.
- **Claude reads what the agent team reads, in two steps.** The first Claude
  reads the code and checks facts in production and the logs through the
  read gate as agent_reader (`READ_WORKFLOWS` in `apps/admin/src/read.ts`,
  docs/production-reads.md), with no network and no other shell. When the
  answer needs public facts (a price, a plan's limits), it says what to look
  up, and a second Claude with the web and no shell finishes the answer. The
  second Claude gets the question, its title and the first answer, never the
  card's words, where what people wrote can be. This is the split the
  research team has (docs/research-team.md). Both sign in with the agent
  team's token (`AGENT_TEAM_CLAUDE_TOKEN`), billed to the organization.
- **The answer comes back to the card.** The page reads
  `diag.ops_card_questions()` (`/ops/api/questions`) when it loads, after a
  question, and each minute while Claude owes an answer. The talk names the
  admin who asked each question and when, so it is the card's record of who
  did what (`docs/decisions/2026-11-21-every-dashboard-tap-shows-its-state.md`).
  Answers hold no address; the public log of the workflow says only how many.

Not chosen: sending these questions through the watch for user issues (a
question is not an issue, and the watch's run already takes up to 45
minutes); a Linear issue for each question (most questions need an answer, not
a fix); one Claude with both the read gate and the web (what people wrote
could steer it to send production facts to a web page); starting the workflow
from the Worker at once (the Worker would hold a GitHub token, and 5 minutes
is soon enough).

Reverse if: the questions use too much of the Frontier plan, or answers from
the card's words mislead more than they help. Then keep the box on pages only,
or answer once a day.

Amended (2026-11-24, Caleb Koster): "starting the workflow from the Worker
at once" is now chosen. Caleb asked that Claude answer right away, and GitHub
started the 5-minute schedule each 8 to 15 minutes. The app Worker holds a
token that can only start runs (`OPS_RUN_GITHUB_TOKEN`):
`docs/decisions/2026-11-24-a-message-to-claude-starts-its-run-at-once.md`.
