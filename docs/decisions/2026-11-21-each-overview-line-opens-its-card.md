# Each Overview row opens its line's card on its section page

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: Caleb asked that a tap on a row of the ops dashboard's Overview go
straight to that item's card on its section's page, where he sees Claude's
summary and proposed solution, talks with Claude and tells Claude what to
do, and sees the progress of the fix, in the format of the User issues
cards (the prayer-robin layout). Before, a row went to the top of its
section, and a section showed its lines only as one line of words each.
Decided:
- **A line is a card.** Each line of a part shows at its part as a card
  (`apps/admin/src/pageCards.ts`), in the one card format that User issues
  and the tutorial video questions also use (`pageIssues.ts` `issueCard`),
  redrawn for Caleb's "beautiful, user-friendly, well-balanced" ask: at the
  top the title and who acts next, then the steps as a progress bar with
  their names (Found, In Linear, Fix written, Merged, Gone); at the left the
  diagram, "What happened" and "What goes wrong" in Claude's words; at the
  right a panel with "The fix", what Claude did (its reasons behind one tap)
  and the buttons; at the bottom "Talk with Claude" across the card with
  the box. The headings are plain words, not Context / Issue / Solution.
- **The talk belongs to the Linear issue.** A line's box sends the same
  `user-issue-note` as the issue's card on User issues, so one talk shows
  in both places. No new table and no change to the watch.
- **The address names the card.** `#g/<section>/<card id>` opens the
  section, opens the tab or the "Show the numbers" that holds the card,
  scrolls to it and rings it. A line's card id is `line:<kind>[:<subject>]`
  (as `alertId`); a user issue's is its Linear id; a store build's is
  `build:<platform>:<title>`. A line that is gone when its section has
  loaded says so.
- **No box where Claude cannot act or has no issue:** a line not in Linear
  yet (the watch files it within 15 minutes), a person's own queue, a line
  judged noise, "Could not read" and a build in store review. Each card says
  why it has no box.

Reverse if: the talk with Claude moves off the Linear issue (then a line's
box needs its own key), or the Overview stops being a list of lines.
