# Each ops dashboard page leads with a summary and keeps every detail one tap away

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: Caleb asked for a redesign of every page of the ops dashboard from
his own complaints (titles that list parts, squares and dots whose meaning is
only on hover, numbers and ids without words, status that says more than was
checked, walls of text with no buttons, code words, the same problem shown
twice), with beauty and a satisfying design, and then "Build it all, and also
allow devs to click things to still uncover all gory details that were shown
originally". The proposal with before and after pictures of each page is in
the project files (`ops-dashboard-redesign/`). Decided:
- **A page is a summary above "All the details".** A section's own page
  (`#g/<section>`) shows, in order: one sentence under the title that says
  its state (`verdictOf` in `apps/admin/src/pageSummary.ts`); up to four
  numbers as tiles; its lines that need a person as their cards (the
  `pageCards.ts` format); what is on its way and what to watch, a row each
  that opens its card; each number of the last 14 days as a row; then the
  section's card as before, closed, titled All the details, with every
  table, chart, source line and range. Pages whose lists are where a person
  works (User issues, Research, Support, Tutorial videos, Nightly tests)
  keep All the details open until a summary of their own replaces them. A
  page remembers whether its details are open. `#all` keeps every section as
  before, cards in their parts.
- **Each line shows once on a page.** On a section's page its lines' cards
  are in the summary and not again in All the details.
- **A number says if it is usual.** A tile or row shows its last full day
  (a size or a time: its newest value) against its usual range: the lowest
  and highest of the days before it, less the one most far out at each end
  from ten days on (`usualOf`). It says Normal, Higher than usual or Lower
  than usual, amber when the change is for the worse (more failures, less
  work). A size says how much it grows a day. Numbers that stayed at zero
  for 14 days are one line of chips, "Checked, all at zero". A tap on a tile,
  row or chip opens All the details at its chart.
- **Status says only what was checked.** With no line, a page says "Nothing
  needs you", never "all works"; a page that still loads, or with parts not
  connected or not read, says so. A line's steps (Found, In Linear, Fix
  written, Merged, Gone) say "Next:" at the step it waits for, and "Still
  here" when its fix did not clear it.
- **The Overview groups lines by who acts**: four numbers of today against
  their usual range; Needs you (Act now and Fix soon); This week, you decide
  (a choice at Watch, such as a blue check or a key that expires); On its
  way (a merged fix that waits for its check, Claude's work, a store's
  review); Watching (a chip for each line); then the Frontier Claude plan,
  the map, the two charts, Merged lately, and the eight numbers it had,
  behind "More numbers".
- **Plain menu names**: Work safety, Web traffic, Storage and cost, Keys and
  access.

Reverse if: the usual range calls a normal day unusual often enough that
people stop reading it (then the range needs more days or a wider rule), or
developers open All the details on most visits (then the summary misses
what they look for).
