# Every PR and LAN number on the ops dashboard says what it is about

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: lines on the ops dashboard named changes only by number ("iPhone
build 77 does not have PR 596 yet: copy PR 597 is not checked"). Caleb:
"I don't remember off the top of my head the details of hundreds of
different PRs. Can we have a hover feature or something for PRs and linear
lan issues, or a plain English summary."

- **Lines start with the change.** A copy line (`copyLine`,
  `apps/admin/src/sources/pipeline.ts`) starts with the title of the change
  people with the store app do not have yet, then says what a copy is (the
  same change, sent to that build as an update), why it waits and what to
  do. The line's key and subject do not change, so its Linear issue stays.
- **A box over every number.** `apps/admin/src/pageRefs.ts` finds "PR n",
  "pull request n" and "LAN-n" in the page's text after each drawing, so no
  part needs code of its own, and shows the title, a few plain lines and the
  state on hover, tap or focus. A finger's first tap shows the box with an
  Open button; a click with a mouse still opens the link.
- **Where the words come from.** Pull requests: `GET /ops/api/prs`
  (`sources/prs.ts`), read by the Worker with its GitHub token, so the
  browser holds none. Linear issues: the watch for user issues already keeps
  each issue's title and words; the Worker gets no Linear key for this.
  An issue the watch does not know takes its title from the pull request
  that names it, else the box says to open it in Linear.
- **New pull requests carry plain words.** The box shows a `Plain words:`
  line, else the start of `## What people see`, else the first paragraph
  (`CONTRIBUTING.md`, Pull request titles and text). Pull requests without
  that section show their first paragraph, which may be technical.

What would change it: a Linear key on the dashboard's Worker, if issues the
watch does not know need their own titles.
