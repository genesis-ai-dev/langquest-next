# The Releases page opens with a line of every merge, to scale, from its report to the first phones

Date: 2026-11-26 · By: Caleb Koster · Status: accepted

Reason: Caleb asked for a side-scrolling line of every change merged into the
app at the top of the Releases page: each pull request with a short summary,
the issue that gave rise to it, who merged it (a developer, the agent team or
a Claude thread), dots by where the change is, and the way to everything
else about it. He tweaked a proof of concept twice (cards show their areas,
filters by area and part, to scale, failures each hour behind the line, each
change's own line from its report to the first iPhone and Android phone, zoom
until every card shows, nothing on hover, a tap lights one change and dims
the rest) and then asked for it to be built and merged. The choices:

1. **Its own element, its own read.** The line lives in `#rline` above the
   page's summary (`apps/admin/src/pageReleaseLine.ts`,
   `pageReleaseLineDraw.ts`), not in a part the page redraws, so a zoom, a
   scroll and a chosen change stay while the rest of the page reads again.
   The Worker answers it at `/ops/api/timeline`
   (`apps/admin/src/sources/timeline.ts`) only when the Releases page opens:
   it has no line for Needs attention, and its reads (GitHub, Expo, the
   database) are too many for every page load.
2. **Facts only, from the source that knows.** GitHub's search gives the
   merges of the last 30 days, their files, branch and first commit; who made
   a change comes from its branch and author, by first name, never a login.
   Expo gives the commit of each production update and store build. When a
   phone first ran a bundle comes from a new report function,
   `diag.ops_release_line`, which `diag_reader` may run but whose tables it
   cannot read: production phones only, times and counts only, never an
   install or profile id. Linear's titles and report times come through the
   app Worker's read-only `issue-info` action, so the ops Worker holds no
   Linear key. What cannot be read says so; nothing is guessed (no Expo job
   steps, no review state the Pipeline part does not have).
3. **A change reaches a phone when a bundle that holds it first runs there.**
   A bundle holds every merge up to the commit it was made from: an update's
   commit as Expo says it, else 15 minutes before its UUIDv7 id's time; a
   store build's version, which is its merge's time in UTC. Only runs at or
   after the merge count. This can be late (a phone that checks late), never
   early.
4. **Nothing shows on hover.** A tap chooses a change: its card, dot and line
   light up, the rest dims, and its detail (its line in steps, why it was
   made, what people see, failures around it, where it is now, who merged it,
   and Ask Claude) opens under the line. The page's boxes over PR and LAN
   numbers skip the line.

Reverse if: GitHub's search limit or the Worker's time stops the line from
answering in 25 seconds, or admins use the Releases page for something the
line pushes out of view.
