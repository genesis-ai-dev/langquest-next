# The ops dashboard has a menu of sections on the left and opens on an Overview of rows, numbers and a map

Date: 2026-11-18 · By: Caleb Koster · Status: accepted

Reason: Caleb asked that the ops dashboard take the layout of the owner
console in his prayer-robin repository (`web/admin` there), because that page
lays out what an admin needs to give feedback and direction. He saw three
samples (thread "Redesign ops dashboard like prayer-robin") and said yes on
2026-11-18. This keeps decisions.md 254 (the page opens on what needs a
person, every number stays reachable, a tapped mark opens its records) and
changes how the first page and the frame look. Decided:
- **A menu on the left, on every page** (`apps/admin/src/pageShell.ts`). One
  line for each section in three groups (The product, Care, Behind the
  scenes), then All sections. A line shows how many of its section's lines
  need a person (Act now and Fix soon, less those whose fix merged and waits
  for its check) and a dot for its most urgent level. On a phone the menu is
  one row that scrolls. The top line has the page's title, Look up and
  Refresh. The menu replaces the first page's OK lines: a section with no
  alert has no dot.
- **Nightly tests is a section of its own**, out of Releases, so the menu
  says how last night went.
- **The Overview** (`apps/admin/src/pageOverview.ts`) has, in order: Needs
  attention, one row for each part's alerts of one kind with its level, its
  Linear issue and fix (docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md),
  its "Next:" line and a link to its section, then rows for what Claude works
  on and what waits on a store; At a glance, eight numbers; How it fits
  together, a map of what people use, what it runs on and the services, each
  box with a dot for the state of its parts; two charts of errors over 14
  days; and the newest merged pull requests with their titles
  (`mergedPull` in `sources/releases.ts`).
- **Every number and dot says only what a part answered.** A box or a tile
  whose part has not answered, is not connected or could not be read says
  that. A store's box (Android app, iPhone app) takes its state from that
  store's own builds.
- **Not taken from prayer-robin**: its pages about money, the website, flows,
  research and setting combinations (LangQuest has no such data); its fonts
  from another host (this page loads nothing from another host); names and
  emails (people stay counted, never named); and its own issue list (Linear
  stays the list).

Reverse if: the menu's counts and the rows disagree often enough to confuse
(then one of them goes), or the team stops using the map (then it gives its
place to the sections' own pictures).
