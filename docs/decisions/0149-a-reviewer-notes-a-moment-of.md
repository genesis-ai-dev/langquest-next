# 149. A reviewer notes a moment of the recording, a help, a key word, a verse or a note, and every note goes with the review and its verdict

Date: 2026-10-20 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-10-20) whether reviewers can comment on a
segment of the recording, or on the resources a check makes available, and
said "if not, we really should". On main a reviewer could note a Bible
verse (Background, Passage), on the record at once, and a study step. The
player's Note recorded a voice clip at a time in the whole version, sent as
one of the review's recordings (`artifacts` with `atMs`), and the
translator heard all of them as one clip, with no time or part. Team notes,
key words and the check's helps were read only. A first build listed every
part with its own note button; Caleb found that too cluttered and chose
(2026-10-20):
- Comments stay at moments of the whole recording: the player's Note,
  said or typed. Underneath, each is tied to the part its moment falls in
  and how far into that part, so whoever fixes the passage records over
  that part. The parts are listed only when they have verses, as before.
- The check's helps and Background's key words get a note button (an
  amber bubble with a plus, 48 pt), team notes in Background get Reply,
  and a verse keeps its Note.
- Everything noted while reviewing is part of the one review: it waits in
  the review's draft (decision 127), listed together under the player in a
  dashed amber box "With your review", each with Remove, and the sheets say
  the note goes with the review. Decide and "What should change?" say how
  many notes go with it. Nothing is sent, and nobody sees a note, until the
  verdict is sent; then the notes go in the verdict's batch.
- A sent note is the passage note there already was (`v1.NoteAdded`),
  written at the check (`kindId`, decision 130), with the review it went
  with (`reviewId`). Taking the review back takes its notes back
  (`withdrawReviews` adds a `v1.NoteWithdrawn` for each); only their author
  may (decision 111). History lists them with their review, not as entries
  of their own.
- Where a note points is new optional fields on the anchors there already
  were, not a new kind or event: `{ kind: 'version', takeId, part, at }`
  (`part` is the part's audio hash, `at` how far into it, "0:04");
  `{ kind: 'passage', help }` for one of the check's helps (`item:<id>` or
  `material:<id>`, `checks.ts` `helpKey`); `replyTo` on any anchor for a
  reply, which keeps its note's anchor. The server checks only a note's
  kind, its required field and the fields it checked before, so it needs no
  migration, and an app from before this shows such a note on its version
  or the whole passage. Core reads the new fields only when they are
  strings (`notePart`, `noteHelp`, `replyOf`, `noteReview`) and finds notes
  with `partNotesFor`, `helpNotesFor`, `termNotesFor`, `repliesTo` and
  `reviewNotesFor`.
- A note on a part follows the part's audio: a later version that kept the
  part still has it, a part recorded again starts clean. Notes never force
  a review (decision 128).
- The translator: "Hear the feedback" lists "Notes from <check>", the
  review's notes, each saying what it is on ("Part 2 · 0:04", a verse, a
  help, a key word), with Reply. In the recorder a part a check noted has
  an amber count beside its length that opens its notes
  (`passage/PartNotes.tsx`). The recorder's Notes chip names them ("on Part
  2 · 0:04", "on “What to listen for”", "Reply to Rita").
- Help mode says what each new button does.
Cost: a reviewer's notes reach nobody until the verdict, so a review left
unsent keeps them on that phone only. The web app's cap on all its
JavaScript rose from 6.5 to 6.55 MB (`export-web.mjs`): with this it is
6.51 MB, of which the new lines in 15 languages are about 15 KB; the first
visit stays under its 5.7 MB. Notes on Earlier's versions and feedback are
not offered: Earlier is history, and the version being checked is the one
notes are for.
Reverse if: teams need a reviewer's notes before the verdict (a long
consultant session); then a note could be sent on its own, still carrying
its part and its check.
