# 209. Every nightly suite leaves one line on its run, and the ops dashboard shows last night's suites together in Releases, a failed test as a watch

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: reviewing PR #421 (208) on 2026-11-12, Carl asked whether a report
on CI belonged on the ops dashboard, a production-only page about running
LangQuest, and why the other nightly tests had none there. The team merged
#421 as it was and Carl chose these follow-ups. What the review found:
208's Phone tests section, second on the page, made each failed phone flow
a problem, the level of a failed deploy or a full disk, whatever Claude
said the cause was; it kept the nights in a public GitHub release that only
the phone tests wrote, so the report job held `contents: write` beside
Claude's step; and the web nightly, the larger suite, had nothing there. The
guardrails nightly failed every night from at least 2026-11-06 to 11-12 (the
web UI suite, two tests a night, each filed in Linear), and the dashboard
could not show it: it read main's latest 40 runs, and the watch for user
issues (every 15 minutes) and release-branches (hourly) filled those within
about 8 hours. The ops dashboard keeps what in CI needs a person (160, 190);
the detail of a failed test stays in Linear. Decided:
- **One line per suite, on its own run.** Each nightly reporter leaves a
  notice annotation titled "Nightly: <suite>": how many passed, or that the
  suite broke and why in a sentence, then the Linear issue of each failure
  with its address (`scripts/nightly-report.mjs` `nightNotice` for the web
  UI suite, the fleet simulation and the mutation tests;
  `scripts/phone-tests.mjs notices`, one for each phone). It is written
  whatever Linear answered. As in 190, the run already holds the words, so
  there is no second store to disagree with GitHub's.
- **A part of Releases, not a section.** Nightly tests sits after Code and
  deploys (`apps/admin/src/sources/nightly.ts`): for each nightly workflow
  (`NIGHTLIES`: `guardrails.yml`, `phone-tests.yml`), its latest completed
  scheduled run on main and each suite's counts and issues. A failed test
  is a watch: a developer acts on it from Linear, and nobody's work waits
  on it. A suite that broke, a reporting job that failed and left no line,
  or a nightly whose latest scheduled run is more than 36 hours old is a
  problem. Code and deploys raises nothing for a failed scheduled run of
  those workflows when every job that failed in it is one these lines say
  (`saidByNightly`), which would say it twice; any other job failing there,
  such as `checks` or the flake report, is still said.
- **No release and no picture route.** The Phone tests section,
  `/ops/api/phonetests/shot/<name>` and the `phone-tests` release's
  `summary.json` and `history.json` are gone; the report job only reads
  (`contents: read`), and so does the token Claude's step gets. Each failed
  screen is in its Linear issue and the run's artifacts.
- **Code and deploys reads each workflow on its own**: the repository's
  active workflows, then the latest run on main of each (`ownWorkflows`), so
  no workflow's schedule pushes another out. That is about ten calls to
  GitHub for each refresh instead of three; `ADMIN_GITHUB_TOKEN` keeps them
  under GitHub's limit.
Supersedes 208's bullet "The night is kept in a public release" and its
dashboard section; the rest of 208 stands. Amends 202 (how the dashboard
reads the watch's runs).
Reverse if: staff need a night's failures on the page without opening
Linear, when the part shows more of each line; or GitHub stops keeping
annotations (190).
