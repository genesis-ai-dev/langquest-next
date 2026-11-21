# Every tap on the ops dashboard shows its state, and each card that talks with Claude keeps a record of who did what

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-11-21, thread "Make dashboard Send to Claude show its
state") typed an instruction on a held film's card on the Tutorial videos
page and pressed Send to Claude. For about 5 seconds nothing changed; then
his words went, and he could not tell whether the page took them or dropped
them. The database had kept them: the card had moved from Waits on you to
Automatic, and the card below took its place. A few minutes later he tapped
Accept on a suggestion and OK, and the card did not change; the database had
kept that too, and his second tap was refused as already decided. Two causes:
a button only went grey while its tap went, and after the answer the page
read the video lists again from the copy the dashboard's Worker keeps for a
minute (`memo` in `apps/admin/src/index.ts`), so the card showed the old
state; or the new state moved the card off the list with nothing in its
place. He asked for this to be right across the whole dashboard, and for a
record on every card that talks with Claude, "to keep track of what's
happened and whose turn it is, but also so when multiple devs are looking at
the dashboard, they can see what's already happened by other devs". Decided
(`apps/admin/src/pageSends.ts`, `perform` in `pageOps.ts`):
- **A tap says it works, then says what happened.** The button says
  "Sending…" (or Saving, Starting, Publishing) with a turning mark and takes
  no second tap until the answer. The answer shows next to the button and at
  the top of the page, which stays in view while the page scrolls until the
  next answer or its Close. A refusal says why, next to the button.
- **A message to Claude shows on its card at once.** Its words show in the
  talk as sending, then sent with the time, in the viewer's own clock, of the
  run that reads it (the fix run at :20 and :50, the watch each 15 minutes),
  with the card at Claude's step; or not sent with the reason, and the words
  back in the box. The page keeps each message until the server's answer
  holds it, so a refresh never takes it away.
- **A card a tap takes off its list leaves a short card in its place**: what
  happened, the words sent, and where the card is now, with a button to that
  tab (Show Automatic). It stays until the admin picks another tab. An item
  on the Research page that an answer moves to another tab stays in view the
  same way.
- **After each tap, the page reads again from the source** the parts the tap
  changed (`reread` in `page.ts`, with `?fresh=1`), not the minute's copy. A
  load asked for while one runs goes after it, not never.
- **Each card that talks with Claude has a record**: the last entry and whose
  turn it is now at a glance, and every entry behind one tap, newest first.
  It holds who did what and when (the admin's display name, or Claude), taps
  that were refused and why, Claude's suggestions, changes and answers, and
  how the card began. `diag.ops_card_record` (migration
  `20261121213000_ops_card_record.sql`) reads it from what is kept already:
  `ops.actions` with `public.profiles.display_name`, `ops.tutorial_suggestions`
  and `ops.user_issue_notes`, 30 days. The talk names who sent each
  instruction too, not "You" for every one. Only Global Viewers see the
  dashboard, so an admin's name shows only to the other admins; it is never
  written to GitHub or Linear.

Considered: a toast that goes after some seconds (a person who looks away
misses it, and the app's own rule is no timed toasts); keeping a moved card
on its old tab as it was (it would say Waits on you while Claude has it, which
is not so); turning off the Worker's minute's copy for every read (it is
there so a few reloads do not spend the providers' rate limits); a new table
for the record (everything it says is kept already).

Reverse if: the record shows names that admins do not want the other admins
to see, or reading it slows the dashboard's parts (then read it only when a
card's record is opened).
