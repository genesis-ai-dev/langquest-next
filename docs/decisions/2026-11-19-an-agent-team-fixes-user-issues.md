# An agent team fixes user issues, and a rule in code says which fixes merge without a person

Date: 2026-11-19 · By: Caleb Koster · Status: accepted

Reason: more than 30 pull requests were open because every one waited for a
developer to merge it by hand, and many were left behind. Decision 202's
watch already wrote a draft fix for each new user issue; a developer had to
read every one. Now a team does the work (`docs/agent-team.md`): the watch's
look is the coordinator and chooses the model and effort of each issue's
manager; the manager finds the root cause, starts workers of different
models for search, the change and the same mistake in other places, and
gives a verdict; a reviewer reads only the change; then `gate()` in
`scripts/agent-team.mjs` decides, in code. A fix merges without a person
only when its cause is proven by a test in the change, it stays in the
app's screens and logic, the ops dashboard and the core, its checks pass,
the reviewer agrees and guardrails pass in the merge queue. Migrations,
sync, servers, sign-in, permissions, event shapes, packages, native code,
build and store settings, workflows, scripts, secrets, privacy and product
choices always wait for a developer. There is no limit on the size of a
change or on merges in a day: Caleb judged such numbers arbitrary. A
display bug (words cut off on a small button) may merge with two pictures
of the screen, before the fix and after it, as its proof in place of a
test, which the job `picture` makes in the UI suite's fixture world; a
change to the appearance, the user experience or the navigation waits for
a developer. The
ops dashboard keeps a record of each fix with Claude's reasons
(`ops.user_issue_fixes`), so a developer can read afterwards what merged
and why. The mode is a file on main (`.github/agent-team.json`), which
starts at `ask` (every fix waits) and which only a person's merge changes.
The pull request that merges is opened by LangQuest's GitHub App, as the
tutorial videos' fixes are. This changes the practice that a developer
merges every pull request, and extends decision 202 and
`docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md`
(an admin's "merge it" now merges the draft fix).
Reverse if: a fix that merged without a person breaks the app for people
and the rule would have let the same kind through again (then narrow the
rule or set the mode to `ask`); or developers do not read the record and
want each fix before it merges.

Amended (2026-11-19, Caleb Koster): the team has a research team. One time
each day a lead (Claude) reads what the team fixed, in the team's own words,
and starts scouts that look in the code for the same mistake in other
places. Code checks each place it names, files a Linear issue for each thing
it recommends, and keeps the items in `ops.research_items` for the ops
dashboard. The watch hands a recommended issue that needs only a fix to the
fix team, and the same rule decides whether that fix merges without a
person. Reason: a fix repairs one place, and the developers asked for a
team "who looks at similar issues and presents them to us". The research
reads nothing a person wrote, so nothing of a person's can reach a public
log or a pull request through it. Mode `off` stops it.

Amended (2026-11-19, Caleb Koster): each issue's card has an image. A
problem that a person can see gets a picture of its screen, made by the
`picture` job on main in the test data, also when there is no fix. Every
other issue gets a small diagram: Claude writes 2 to 6 steps and the
dashboard draws them as text, the step that goes wrong in red. Reason: a
developer must understand an issue from its card without the code. The
diagram is steps and not a drawing by Claude, so nothing Claude writes
runs or is shown as markup on the admin page. A recommended research item
has the same box to tell Claude what to do as a user issue.

Amended (2026-11-20, Caleb Koster): the agent team signs in with a token of
its own, `AGENT_TEAM_CLAUDE_TOKEN`, from a Claude account billed to Frontier,
and not with a developer's plan token. Until that secret exists, the team
does nothing: no fix, no research, and an admin's instruction waits. Reason:
the agent runs must be billed to the organization. The watch's own look
keeps `CLAUDE_CODE_OAUTH_TOKEN`, as before the team.
