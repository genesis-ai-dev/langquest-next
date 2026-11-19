# Documentation

Every doc here says its kind on the line under its title, and is listed
below under that kind (`scripts/docs.test.ts` holds both). A line here says
what a doc is about, never its status or a count: those live in the doc.
`CONTRIBUTING.md` (Docs) has the rules; `README.md` says which file answers
which question.

- **Reference**: how a part works now. Changed in the same pull request as
  the code it describes, and edited in place.
- **Plan**: what is next. Its `Status` line is `draft`, `accepted`,
  `in progress`, `built` or `dropped`; when a phase merges, how it works
  moves into a reference doc.
- **Report**: a dated audit or measure, not kept current.
- **History**: kept for its reasoning, not maintained.

Why each choice was made is in [decisions/](./decisions/README.md), the ADR
log, one file per decision.

## Reference

The design and the data

- [events.md](./events.md) — The event catalog: each event's shape and merge rule, and what a new event needs
- [sync-protocol.md](./sync-protocol.md) — How a phone and the server exchange events: push, pull, snapshots, the client's version, delivery for teammates
- [blobs.md](./blobs.md) — Recordings and other files: uploads, downloads, confirmation by the server, and what a phone may delete
- [library.md](./library.md) — The library: templates, flows and reference material as versioned documents
- [reference-material.md](./reference-material.md) — Reference material: Bible text and audio, study guides and notes, as library documents placed by where they apply (decision 62)
- [source-bible-audio.md](./source-bible-audio.md) — Source Bible audio beside the recorder, and the source Bibles an organization manager adds
- [languoids.md](./languoids.md) — Languages and regions: v2's reference tables filled from Glottolog, the explorer, search, and the interface-language proposal
- [licensing.md](./licensing.md) — An organization's license, why it only opens, and the plan for what outsiders can see

The app

- [ux/principles.md](./ux/principles.md) — The design principles every screen keeps: a record with advice, one place for what's next, field sizes, help mode
- [ux/demo-parity.md](./ux/demo-parity.md) — How the app follows the partner demo, the conventions each screen keeps, and the spec's domain in the event log
- [ux/screen-path.md](./ux/screen-path.md) — Each screen's main action, secondary actions and way back
- [localization.md](./localization.md) — The app's own words in each person's language: the catalogs, how a word reaches the screen, and what is shown as written (decision 81)
- [tutorial-videos.md](./tutorial-videos.md) — The how-to videos: scripts the app plays through on the web export, filmed and voiced in every app language (decision 177)

People, organizations and outside apps

- [global-viewers.md](./global-viewers.md) — Global Viewers: LangQuest support who read every organization, as its admins see it, on an authenticator-verified session; making one on a call, revoking, a lost authenticator, how it works
- [verified-organizations.md](./verified-organizations.md) — The blue check after an organization's name: an admin asks with a code emailed to its domain, staff grant it on the ops dashboard, and where it shows
- [publisher-imports.md](./publisher-imports.md) — Importers staff turn on for a publisher's organization: its admins bring in their own material (FIA from Bible Aquifer), the server builds it, they publish it
- [org-export.md](./org-export.md) — The organization export: one zip of every recording, its metadata, progress sheets and the raw log, and who may take it
- [agent-api.md](./agent-api.md) — The LangQuest API, review links and MCP: how partner apps, AI agents and people without an account take part in a review

Running it

- [environments.md](./environments.md) — Development, preview and production: branches, where public settings and secrets live, `npm run secrets`, setup
- [cloudflare.md](./cloudflare.md) — Workers Builds: what merging to develop and main deploys; builds hold no secrets
- [admin.md](./admin.md) — The ops dashboard: what it shows staff, where each part comes from, who may open it, and what is not built yet
- [diagnostics.md](./diagnostics.md) — Field diagnostics: the content-free records a phone keeps and sends, so support can answer a field report from records (decision 39)
- [agent-team.md](./agent-team.md) — The agent team: Claude agents that write a fix for each user issue, the rule that decides whether it merges without a person, and the research that looks for the same mistake in other places
- [routines/](./routines/README.md) — The routines that run the Linear board without a person: each one's prompt, when it runs and what it may change
- [play-store-declarations.md](./play-store-declarations.md) — Every answer given to Google Play (data safety, content rating, permissions, the listing), kept true in the same change as the app (decision 49)
- [app-store-declarations.md](./app-store-declarations.md) — Its counterpart for Apple: the App Store Connect answers that Share nearby on iPhones touches (decision 256)

Testing and agents

- [testing.md](./testing.md) — The testing strategy: five layers, which one a test belongs in, the end-to-end rules, and what runs on a PR, nightly and before a release
- [ui-test-suite/](./ui-test-suite/README.md) — The Expo app's UI test suite: its areas, covering every role, with the fixture world, global preconditions and the known issues found while writing it
- [fleet-simulation.md](./fleet-simulation.md) — Many phones on simulated time against the in-memory server: `npm run fleet`, the scenarios, and how to read them
- [agent-skills.md](./agent-skills.md) — Which skills coding agents get here, where they come from, and what was considered and left out

LangQuest v2

- [v2-import.md](./v2-import.md) — Bringing LangQuest v2 into this app, one way, and keeping it coming while v2 runs (decision 94)
- [v2-project-languages.md](./v2-project-languages.md) — The language each v2 project should get here (many picked English), and the records that follow it

## Plans

- [nearby-sync-plan.md](./nearby-sync-plan.md) — Nearby sync: phones near each other swap events and audio with no internet, and a new person joins offline
- [ops-dashboard-plan.md](./ops-dashboard-plan.md) — The ops dashboard, phase by phase (how it works now: admin.md)
- [streams-and-languages.md](./streams-and-languages.md) — Below an organization only languages, each its own stream (decision 63)
- [big-languages-plan.md](./big-languages-plan.md) — Big languages on a 2 GB phone (decisions 143 and 147)
- [server-jobs.md](./server-jobs.md) — The server's jobs, and where the heavy ones run (decisions 141, 142 and 147)
- [breaking-up-the-bible.md](./breaking-up-the-bible.md) — How a language's Bible is set up: its numbering, then how each book is divided into sections (decisions 74 and 80)
- [invites-and-accounts.md](./invites-and-accounts.md) — Invites, accounts and getting back in (decisions 54 and 59)
- [ux/simple-redesign.md](./ux/simple-redesign.md) — The simple redesign: one set of simpler screens for everyone (decision 71)
- [ux/spoken-worldwide-workflow.md](./ux/spoken-worldwide-workflow.md) — Spoken Worldwide's six-stage workflow mapped onto the app's people and passage views

## Reports

- [performance-audit.md](./performance-audit.md) — Event system performance, 2026-10-12: the baseline, how to measure it, and ranked improvements
- [performance-audit-app.md](./performance-audit-app.md) — App and server performance, 2026-10-15: rendering, startup, web bundle, Worker, SQL
- [performance-audit-2026-10-26.md](./performance-audit-2026-10-26.md) — Re-measure after big languages and Global Viewers, 2026-10-26
- [fleet-baselines.md](./fleet-baselines.md) — Baseline numbers for every fleet scenario, 2026-10-12, to compare before and after a performance change
- [flow-coverage-audit.md](./flow-coverage-audit.md) — Flow coverage against the spec, 2026-09-14, and the gap architecture
- [invitation-rollout.md](./invitation-rollout.md) — The hosted rollout of invitations and accounts as of 2026-09-17
- [ux/follow-ups.md](./ux/follow-ups.md) — UX-vision follow-ups after PR 4, 2026-09-17
- [ux/pr-4-gap-review.md](./ux/pr-4-gap-review.md) — PR 4's gap review, 2026-09-17

## History

- [ux/](./ux/README.md) — Earlier interactive mocks (slideshow workflow, one yellow action, VAD takeover)
- [ux/implementation.md](./ux/implementation.md) — The one-next-action journey the app built before it followed the partner demo
- [journey-tests/](./journey-tests/README.md) — UX journey findings of 2026-09-15 against the ng-langquest-ux blueprint, before the UI test suite
