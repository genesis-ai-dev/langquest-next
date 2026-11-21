# The Overview shows how much of the Frontier Claude plan this week is used

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: the automatic jobs and the agent team run on one Frontier Claude
plan (Max 5x, `AGENT_TEAM_CLAUDE_TOKEN`). When its week is used up, they
stop until the week starts again, and nobody sees it coming. Caleb: "There
should also be a monitor on the dashboard (overview), small, indicating how
much of the week on the frontier 5x plan has been used up vs how far along
into the week we are."

- **Where the number comes from.** No usage page takes a token from
  `claude setup-token`, but Claude Code reports the plan's windows with each
  answer (`rate_limit_event`: the share of the week used, and when it starts
  again). `.github/workflows/claude-plan.yml` asks Claude Code one tiny
  question every hour (`scripts/claude-plan.mjs`: Haiku, no tools, a
  one-line system prompt) and keeps only that event. It costs a few dozen
  tokens of the plan an hour.
- **How it reaches the page.** The run leaves the numbers as an annotation
  titled "Claude plan"; the Worker reads the latest run's, as it reads the
  nightly suites' lines (decisions.md 209). The Worker gets no Claude token,
  and the workflow holds no production key and writes nothing.
- **A monitor, not a line.** Two bars (used, week gone) on the Overview,
  amber more than 10 points ahead of the week, red at 90%. It raises no
  alert, because every alert becomes a Linear issue through the watch, and
  a busy week is not a bug.

Reverse if: Anthropic gives the plan's usage to a setup token in another
way, Claude Code stops sending `rate_limit_event`, or a busy week should
become a Linear issue after all.
