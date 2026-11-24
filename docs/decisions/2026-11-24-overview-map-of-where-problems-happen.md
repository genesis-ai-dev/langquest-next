# The Overview's map shows every part where a problem can happen, left to right as the work flows

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-11-24, thread "Draw where problems occur in
LangQuest") for a system diagram of everything the ops dashboard is concerned
with: "the nodes are thoughtfully laid out and the general flow of the
process is left to right". He saw three samples, then asked that it go on the
Overview, with zoom and pan. Partly supersedes
`docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md`: its map "How
it fits together" (three columns of 14 services) gives its place to this one.
Decided:
- **One box for each part where a problem can happen**
  (`apps/admin/src/pageSysMap.ts`, `SM_NODES`), in bands from left to right:
  Build and ship, In the field, Cloudflare, Supabase server, Watch and fix.
  Tutorial videos is a lane on top, Keys and access a lane at the bottom.
  Each kind of line in `alertKinds.ts` belongs to exactly one box, except
  `unreadable`, which every part can give; `apps/admin/test/sysmap.test.ts`
  holds this, so a new kind fails the test until it has a box.
- **The lines show how the work goes**: the main path (a person, a phone,
  the App Worker, the door, the database, the fold) is drawn heavier, and two
  dashed loops go back to the left: notifications to phones, and a fix merged
  into main. Two walk-throughs follow a recording and a fix along them.
- **A box's state comes only from its own kinds of line** in the page's
  results, after resolves: Fix soon, Watch, Could not read, Loading, Not
  connected or Working. A box with no check of its own says so. The store
  boxes no longer take their state from a store's builds: a failed build is a
  line of its own kind, on the box that has that kind.
- **The map keeps its place between refreshes**: it is drawn once; a refresh
  changes only the states, so the zoom, the scroll and an open panel stay.
- The boxes lose the one fact under each name (for example "build 45 is
  live"); the tiles and the section pages have those numbers.

Reverse if: the team stops opening the map, or a new part is hard to place in
the bands (then the layout needs another look, not a box squeezed in).
