# A research team looks ahead each day

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: the agent team fixes what people already hit, and its research
looks only for the same mistake in other places. Nothing looked ahead at
known security holes, new versions, store deadlines or offline risks before
they hurt someone. Caleb: "We should add a research team to the langquest
dashboard. Look at how the research team is setup for prayer robin (team
structure, what they look for, how it's reported, etc.) and implement
something similar, suited for langquest." He chose the design with
pictures on 2026-11-21.
Reverse if: its reports bring no item a developer acts on in 30 days, or
its cost on the agent team's account is more than its use.

- **Same job, second lead.** The team runs in the `research` job of
  `user-issues.yml`, after the twins search, through the same door to the
  Worker (`/api/user-issues`, OIDC) and on the agent team's own token. The
  twins search does not change.
- **Facts by code, then agents.** Code reads `npm audit`, OSV.dev, the npm
  registry, the GitHub Actions in use and git before any agent starts. A
  lead (Opus) starts at most 3 scouts (Sonnet or Haiku) side by side, checks
  each claim, and writes one report. Code checks the report again.
- **Subjects by day.** Each day: security holes and new versions. Monday
  to Friday one more subject each; Saturday two that take turns by week
  (`docs/research-team.md`).
- **Web, no shell.** This lead and its scouts read public web pages
  (release notes, advisories, store rules). This changes the rule of the
  research that its agents have no network. In return they get no shell at
  all, because the job's environment holds the token that asks for the
  Worker's OIDC token. The twins lead keeps no network and its two git
  commands.
- **A report each day, on a page of its own.** The report goes to
  `ops.research_reports` (90 days) and the items to `ops.research_items`
  with new fields. A new **Research** page under Care shows the report, the
  team, the week, each scout's result and the items. The research cards
  move there from **User issues**, which links to it.
- **Choices as buttons.** An item a developer must decide carries 2 to 4
  choices. A tap sends the choice to Claude as an instruction on its Linear
  issue, the same way as the box on a user issue.
- **Package changes wait.** A package change is always a choice for a
  developer, never a fix that merges without a person
  (`docs/decisions/2026-11-19-an-agent-team-fixes-user-issues.md`).
