# 202. A watch every 15 minutes hands new kinds of user problems to Claude, which files each real one in Linear, assigned to a developer

Date: 2026-11-03 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-11-03, thread "Auto-detect and fix user issues") found
problems people had hit for up to a week (reference audio that never
downloaded in browsers, 201; no password reset, 200) that nobody had seen,
because seeing them meant someone remembering to open the ops dashboard or
`npm run diag`. He asked for developers to be told of each problem as it
happens, by the problem coming to them. He chose to build it in two steps:
first the watch and the alerts, to see a few days of what it files; fix
pull requests come after, in a change of their own. Decided:
- **Kinds, not records.** `ops_user_issue_watch()` (migration
  `20261103180000_user_issues.sql`) groups 7 days of `diag.records` into
  kinds named by the records' code-like tags (`error:<name>@<where>:<code>`,
  `transfer:down:source:failOther`, `device:lostRecordings`; the families
  are in `server/userIssues.ts`), adds server jobs failing or stopped and
  the Worker's 5xx (`diag.job_runs`), and each problem sent from help mode
  (`diag.feedback`, bugs only, never who sent it). Development builds and
  the accounts in `ops.watch_ignored` (the store review account and
  Claude's production test account) are left out. A kind is handed over when someone hit it in the last day and it was
  never looked at, at most 20 at a time, help mode first.
- **Looked at once.** `ops.user_issues` keeps what was decided about each
  kind: filed (a new Linear issue), known (an issue the team had) or noise.
  A kind comes back only when at least twice as many people hit it (and two
  more): noise to be judged again, a filed one as a comment on its issue.
  Server kinds come back after a week. Noise is forgotten after 90 days.
- **GitHub Actions, every 15 minutes, holding no production key**
  (`.github/workflows/user-issues.yml`): it reads the watch and says what it
  did through the app Worker's `/api/user-issues`, which lets in only that
  workflow on main by its OIDC token, as 186's door does
  (`apps/web/worker/userIssues.ts`). Each read is a `user_issue_watch` job
  run, so a watch that stops shows on the ops dashboard. Like 186, this is
  an exception to 141's "no production job runs in GitHub Actions" that
  keeps 141's reasons: GitHub holds no production key, a late or dropped
  run only tells the team later, and a schedule GitHub switches off shows
  as a stale `user_issue_watch` within the hour. Considered: the Worker's
  own cron (it would need the Linear key, and Claude, in the Worker); a
  `diag_reader` login in GitHub (141 keeps production logins out of it).
  The workflow runs every 15 minutes, so the ops dashboard reads its runs
  apart from the others' (`FREQUENT_WORKFLOWS`).
- **Claude judges; the script files.** Only when something is new, Claude
  (the plan token of 186) reads the kinds and the team's Linear issues and
  follows the `user-issues` skill: group what is one problem, find it in the
  code, and decide. What people wrote is untrusted, so Claude has no
  network, no key and no shell beyond reading git; its one output is a file
  that `scripts/user-issues.mjs` checks (a kind it was not handed, or names
  twice, is dropped). The script alone holds `LINEAR_API_KEY`.
- **Linear is the alert.** Each new issue is in the LangQuest Next team
  with the label User issue, assigned to the Linear user named in the
  workflow (Caleb), whose Linear app tells him on his phone. GitHub stays
  code only, since the repository and its Actions logs are public: the logs
  carry counts, keys and issue ids, never what a person wrote, and no
  address goes into Linear. When in doubt, the skill files: a missed problem
  is what this exists to stop.
Anthropic (Claude) and Linear now handle what people send from help mode;
the privacy page names them as service providers.
Reverse if: what it files is mostly noise after a week (then tighten what
is handed over), or problems still go unseen for a day (then look at the
assignment and the phone alerts first).

Amended (2026-11-03, Caleb Koster): closed stays closed. The first run
filed LAN-220 for a problem a pull request merged after the reports had
already fixed (Play all, PR 295), and Caleb asked that issues the team has
dealt with not come back, and that the ops dashboard say which pull request
dealt with each. Decided (migration `20261103204500_user_issues_fixed.sql`):
- **Already fixed** is a fourth verdict. Claude reads main's merges (the
  checkout is 600 commits deep, `git log` and `git merge-base` only) and,
  when one merged after every report fixes the kind, says `fixed` with the
  pull request's number: nothing is filed.
- **Linear decides open or closed.** Each run reads the state of every
  issue the watch filed or commented on; closed there (Live, Canceled,
  Duplicate; not Outage) closes its kinds, with the pull request linked on
  the issue or the merge naming it, and marks what was sent from help mode
  about it done. Opened again there, it is open again.
- **Back only after the fix.** A fixed kind is handed over again only for
  people who hit it more than a day after the fix, at least twice as many
  as when last looked at (and two). Claude tells builds from before the fix
  (it stays closed) from a fix that did not hold (the script reopens the
  issue to Todo). Kinds now say the build (a browser's commit, a phone's
  update or store build), since phones never send an app version.
- **The ops dashboard's User issues section** (`diag.ops_user_issues()`)
  lists each issue with its state in Linear and the pull request that fixed
  it, and the kinds found already fixed.
Considered: a list of closed kinds kept by hand (it would go stale, and
Linear already says what is done); reopening on any new report (old phones
and tabs keep reporting a fixed problem for days).

Amended (2026-11-03, Caleb Koster): a draft fix with each new issue. Caleb
chose (2026-11-03, thread "Auto-detect and fix user issues") that Claude
opens a fix pull request right away with each new issue, not after a
developer has looked at it, so a developer reviews the issue and its fix
together. Decided (`.github/workflows/user-issues.yml`, the skill's "Writing
a draft fix"):
- **At most three a run**, each a draft pull request on
  `user-issue/<issue>`, titled with the issue's id and linked on it. Claude
  may answer that there is no fix, and the issue says why.
- **What people wrote shapes the code, so the jobs trust each other less as
  they go.** Claude edits with no key and no shell; the job that runs the
  patch's code (typecheck, the nearest tests) holds no key and only reads;
  the job that pushes and opens the pull request runs nothing of it. A
  patch that changes how the repository builds, tests or deploys
  (`.github/`, hooks, packages, `.env*`, agents' instructions, the watch) is
  refused. Steps that hold a key after Claude run the scripts as they were
  before Claude ran.
- **Its checks wait for a person.** The pull request is opened with the
  built-in token, which starts no checks, and guardrails run when a person
  marks it Ready for review (`ready_for_review`). Guardrails hold the Expo
  and Docker tokens, which code written from a stranger's words must not
  reach before someone has read it. Opening pull requests with the built-in
  token is a repository setting kept in `.github/actions-permissions.json`
  (`npm run github:rules`).
Considered: the Claude GitHub App's token, whose pull requests start checks
at once (the guardrails would run unread code with their tokens); one job
for all of it (Claude can write in the checkout, including `.git`, and a
later step would run what it wrote with the keys).

Amended (2026-11-04, Caleb Koster): Claude sees what came with each problem.
Caleb sent a problem from help mode with a screenshot (LAN-224, playback
slow on a low-end Android phone); the watch handed Claude only his words
and that a screenshot came with them, and his phone had no error, so the
issue and the draft fix were guesses. He asked that Claude see the pictures
people send and the phone's timings and diagnostics. Decided (migration
`*_user_issue_evidence.sql`, docs/diagnostics.md):
- **Two more reads at the Worker's door**, for the watch workflow only:
  `?media=<feedback id>`, a problem's screenshot and chosen picture (bugs
  sent in the last 30 days or already judged), and `?phone=<install>&at=`,
  that phone's build, model, OS and records from three days before to an
  hour after, without organization or stream ids. The steps before Claude,
  in the watch and the draft fix jobs, fetch them for each problem and up to
  two phones of every other kind (12 a run) and keep them on the runner.
- **The issue carries the phone's numbers**, written by the script from the
  records, not by Claude: the half hour before the report, with downloads'
  count, size and seconds per file, plays, opens and syncs, the disk. Claude
  says what the screenshot and the numbers show, and follows the tap into
  the code before it answers that there is no fix.
- **None of it reaches the public repository.** Nothing that came with a
  problem goes into a log or an artifact; the patch step drops a draft fix
  that carries six words in a row of what the person wrote or one of the
  problem's or phones' ids, and a draft fix may add no picture or recording.
  The privacy page says Claude looks at the pictures and reads the phone's
  diagnostics (Play's data safety answers stand: Anthropic is a processor).
Considered: a link to the ops dashboard in the issue (what it did; a
developer had to look, and Claude never did); the whole timeline in the
issue (too long to read on a phone, and Claude still could not see the
screenshot); the voice note (Claude cannot hear it).

Amended (2026-11-12, Carl Sauder): the ops dashboard no longer reads the
watch's runs apart (`FREQUENT_WORKFLOWS`). Reading main's latest 40 runs and
then leaving the watch's out still let it, with release-branches, fill the
40 within about 8 hours, so it now reads the latest run of each workflow on
its own (decision 209).

Amended (2026-11-16, Caleb Koster): a tutorial video's fix (186, amended
2026-11-16) is opened with LangQuest's own GitHub App, so its checks start
at once and it merges itself, which this decision refused for a user
issue's fix. A video fix may change only the video's own file and lines; a
fixed rule refuses an added line there that could reach a key (a file, the
environment, the network, another program, code from text); and a second
Claude reads the patch first. A user issue's fix may change any of the
app's code, so it stays a draft opened with the built-in token, and its
checks still wait for a person.

Amended (2026-11-17, Caleb Koster): the watch also takes the ops
dashboard's own lines, as server kinds in a new family `ops`
(`ops:<kind>[:<subject>]`), so Claude files or links one Linear issue for
each line, and the page shows that issue, its fix and when the line should
clear (`docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md`).

Amended (2026-11-18, Caleb Koster): with each new issue Claude also writes
it in three lines, `context`, `problem` and `solution`, and the database
keeps them (`20261118070000_user_issue_words.sql`). The ops dashboard shows
each issue as a card an admin reads without the code
(`docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md`, amended),
and the database held only the title, so the card could show only counts
and the kind's keys. The lines are Claude's own words, at most 300
characters each, never what a person wrote, an id or an address: the script
cuts an address out and the Worker refuses one. Linear keeps the long
summary and the cause, as before.

Amended (2026-11-18, Caleb Koster): the three jobs that write a draft fix
also take an admin's instruction on an issue, sent from its card on the ops
dashboard. Claude starts from the draft fix the issue has, answers, and may
change it; `open` pushes the change to the draft fix's branch and gets
`id-token: write` to send the answer back through the Worker
(`docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md`).

Amended (2026-11-19, Caleb Koster): the draft fix is now the work of an agent team, and a rule in code lets some fixes merge without a person (`docs/decisions/2026-11-19-an-agent-team-fixes-user-issues.md`, `docs/agent-team.md`).

Amended (2026-11-21, Caleb Koster): the watch read failures and not
slowness, and it never read four kinds of record (`open`, `load`,
`snapshot`, `checkpoint`). Caleb asked whether an agent team reads the
incoming diagnostics, saw the gaps, and chose to close all of them
(migration `20261121031500_user_issue_watch_gaps.sql`):
- **Slowness is a family of its own, `slow`**, by the limits the field
  report already uses (`scripts/diagSignals.ts`) and the ops dashboard's
  line: a sync slow on the phone or on the network, a language open over
  5 s, a language folded again over 20 times a day, a checkpoint over 3 s,
  a first download over 15 minutes without the time offline, a fill over a
  day, one file over 2 minutes, a play that waited over 3 s for its first
  sound (182).
- **A snapshot older than the phone needs** is a family, `snapshot`.
- **Taps on a recording not yet on the phone** (over 10 in an hour) and
  **records a phone dropped** past its 3000 are kinds.
- **Sign-in kinds follow the dashboard's one rule** (`diag.sign_in_class`,
  `docs/decisions/2026-11-19-sign-in-trouble-is-one-rule.md`): a wrong
  password or an expired invite no longer goes to Claude to be called noise.
- **An error kind keeps its key** and carries the top line of each of its
  stacks (`tops`), so Claude sees two bugs under one name and place. A new
  key would have filed every error again and cut each dashboard line from
  its issue.
- **A kind never looked at is handed over from any of the 7 days**, not
  only the last one, so a kind that waited past the 20 a run, or through a
  day the watch did not run, is not lost; the watch says how many wait, and
  the ops dashboard shows it (`user-issues-waiting`).
New issues are filed with no one assigned: the team has more than one
developer, and any of them takes an issue.
