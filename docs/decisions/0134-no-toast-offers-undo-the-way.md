# 134. No toast offers Undo: the way back stays with the thing, building screens get their own arrows, and what cannot come back asks first

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16): "I don't like the undo toast at all. It's
irritating because if I want to undo something, I have 5 seconds or so to
read the toast message and then my chance is gone forever - it induces panic
and frustration with users." He asked for each place to be decided from the
research ("Undo and redo in recording", which lists every place) and common
sense. A toast's Undo lasted 7 seconds and the next toast replaced it, so
after two quick changes the first could not be taken back; Material and
GitLab's design systems took actions out of toasts for the same reason, and
a disappearing button fails people using a screen reader or a magnifier.
Supersedes 111's toast Undo (its History, step-sheet and review-page Undo
stay) and extends 133 beyond the recording screen. What was built:
- **Toasts only say what happened.** `ToastSpec` has no `undo`, `ctx.toast`
  and `ctx.act` take a message and nothing to undo with, and a toast shows
  3.5 s (twice that with a screen reader).
- **The way back is where the thing is.** On a passage it is History's Undo
  and Withdraw (111), the step sheet and the review page; a study step has
  its own Undo, and your own note on a study step now has one on the note
  (`StudyNote`; those notes are not in History). Settings, helps, library
  items, templates, roles and My Bibles change back with the same control; a
  template you stopped following offers Follow again in its options, as the
  library's settings did.
- **Screens where you build something get Undo and Redo** in the header, as
  the recording screen has them by the red button (`ui/undoRedo.tsx`,
  `ui/undoModel.ts`): the guide editor (every change, typing in one field
  joined into one step, kept with the draft on the phone until it is
  published, the newest hundred), Divide your own way (each section start,
  join or outline used, for the visit; it replaces its one Undo link) and a
  language's list of checks (each save of the list or a ready-made set
  used, for the visit, written back with `restoreChecks`; a save made on a
  check's own page opened from the list is a step there too,
  `checks/checksHistory.ts`).
- **What cannot come back asks first.** Removing a member (they come back
  only by joining again) and using a ready-made set of checks over a
  language's own (its own checks cannot be chosen again): a sheet names it
  and waits (`ConfirmDelete`, with `replaces` for the second). Removing one
  of a language's checks asks first too, as a whole thing does (124): its
  way back is the list's Undo, not on the check's page where it was tapped
  (agreed with "Combining check settings", PR 155).
Considered: a toast whose Undo does not go by itself (it still covers the
screen and is still replaced by the next one); asking first everywhere (it
slows down every reversible change to guard a few).
Reverse if: people take back things by accident with the header arrows, or
miss a change made by mistake that the same control would have reversed
because nothing points at it.
