# 111. Whoever gave a review or added a note can take it back, as a new event, and the record keeps the review crossed out

Date: 2026-10-15 · By: Caleb Koster · Status: accepted

Reason: Spoken's tester approved a peer check by accident and found no way
back (LAN-84). A review was grow-only with no inverse: its toast had no
Undo, the record stopped offering the check once it was approved, and only
a moderator's redaction (48) could remove it. Caleb asked for approval to be
undoable, and for the other actions people would want to take back. What
was built:
- **Two events, the shape `v1.RequestWithdrawn` already has.**
  `v1.ReviewWithdrawn { reviewId }` and `v1.NoteWithdrawn { noteId }`,
  add-wins (`withdrawnReviews`, `withdrawnNotes` in `RecordState`). Nothing is
  deleted: the log keeps the review, and `derivePassage` leaves it out of
  every status, so the check is open again, a request it answered is open
  again (back on the reviewer's My Work), feedback stops waiting on the
  translator, and a checkpoint it cleared holds the steps after it again.
  Inbox rows follow, since they are derived (`updatesFor`).
- **Only the author.** A withdrawal counts only when its actor is the
  review's or note's own author (`withdrawnBy`), so a refused or stray one
  changes nothing on a phone, whichever arrives first. The server's
  `may_emit` refuses anyone else's, and one for a review or note it has not
  seen (`20261015220000_withdraw_reviews_notes.sql`, `server/grantsSmoke.sql`
  10b). Removing someone else's words stays a moderator's redaction (48).
- **Where Undo is.** The toast after Looks good, Send feedback, a logged
  check, a back translation and every note. Later: on your own check in its
  step sheet, on your own review's page, and on your own review or note in
  the history. A review taken back stays in the history and on its page,
  crossed out, "undone just now"; a note taken back shows nowhere. No words
  were added to explain any of it (Caleb's rule for this work).
- **A study step marked done** already had a register (`v1.StudyStepMarked`),
  so its Undo after the toast is the same event with `done: false`.
Reducer version 17: the state has two new maps.
Not given an Undo: publishing a version (the "Delete a version" work,
LAN-83, takes that), withdrawing a request or bringing back a set-aside
check (both are two taps to do again), declining a join request (the person
can ask again), renames and library publishes (done again the same way), the
license (final by design, 38), and a key term tie (grow-only, its own topic).
Reverse if: teams need someone else (a coordinator) to take back a
reviewer's verdict, then add a privilege for it beside Override checkpoints;
or a verdict taken back must disappear from the history too, then show it
only to its author.

Amended (2026-10-16, Caleb Koster): on the recording screen and in back translation, Undo is two arrows by the red button, not a toast (decision 133).

Amended (2026-10-16, Caleb Koster): no toast offers Undo anywhere (decision 134); History, the step sheet and the review page keep theirs.
