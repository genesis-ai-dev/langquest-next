# A recording that cannot be heard on a device is not checked, said back or changed from that device

Date: 2026-11-20 · By: Carl Sauder · Status: accepted

Reason: LAN-317 (Carl): "Both translate and review screens allow actions
that don't make sense when the audio content of existing recordings is not
available." A phone downloads audio by scope, not by demand, and plays the
rest from the server while connected (`docs/blobs.md` rule 10), so a
recording's events can be on a phone that cannot play it: offline with the
files not kept there, or online while a part is still on the phone that
recorded it. Until now only the play buttons went grey, and a review's Next
on Listen waited (UI audit finding 9, 2026-10-28). A reviewer could still
note a moment in a recording that would not play, a review's draft could
open on Decide with both verdicts live, a back translation could be recorded
for a part nobody there could hear, and the recorder let parts be recorded
over, deleted, moved, labelled with verses and published without being
heard. Chosen:
- **One answer to "can it be heard here".** `clipReach`
  (`apps/mobile/src/audio/clipReachModel.ts`) says where a recording's parts
  are for this device: here, on the server, or out of reach, and then why:
  `offline`, or `notSent` (connected, but the server does not have a part
  yet). Offline is said first, since a device that is not connected cannot
  know what the server has. Screens ask through `useClipsReach`, which
  draws again when a file arrives, and every player asks `clipsAvailable`,
  so a button and the screen around it agree. Each screen says which reason
  it is and what will end it.
- **Review** (`src/screens/review.tsx`, `reviewUnheard` and `stageShown` in
  `src/reviewing/capture.ts`): Next on Listen and the player's Note wait,
  and a draft left at a question or at Decide opens on Listen. A version
  already played in that review was heard, so the review can be finished
  without the audio; one logged afterwards ("Already happened") was heard
  elsewhere and is not held, as before.
- **Back translation** (`src/recording/btWorkspace.tsx`): Record and Note
  wait for the part that cannot be heard. What was already said stays, and
  Done still sends it, as Done with parts not said always could.
- **Recording** (`src/screens/translate.tsx`, `src/recording/recorder.tsx`):
  when any part of the draft cannot be heard, the whole draft is locked.
  Nothing records into it, deletes, moves, labels or cleans up a part, undoes
  or redoes, and Done is off; a banner says why. Parts that are here still
  play, the reference half is untouched, and a new version started empty
  from the passage's Versions page is not held, having no part to hear.
  Asked whether to lock the whole draft or only the parts that cannot be
  heard, Carl chose the whole draft (2026-11-20); the trade-off put to him
  was that locking only those parts leaves Done open, which publishes a
  version holding parts nobody heard on that device, while the whole-draft
  lock stops a translator whose own parts were recorded on another phone
  from adding to them until the audio arrives.

Nothing is lost by any of it: drafts stay as they were kept (decisions 83
and 127), no event is added or changed, and everything opens again by
itself when the audio is on the device or can be played from the server.

Reverse if: translators in the field are often stopped by the whole-draft
lock on work they recorded themselves on another phone, which would argue
for locking only the parts that cannot be heard; or reviewers turn out to
need to finish, offline, reviews of versions they never played in the app.

Amended (2026-11-25, Carl Sauder): a check of every case found the line in
the right place, with a few gaps, now closed. Starting over with an empty
version is the way to record without what cannot be heard, since it builds
on none of it: the lock banner has its own **New version** button, which
starts an empty draft in the workspace itself, instead of sending the person
to Versions and history. A draft not uploaded from a device of the person's
own says to open LangQuest on that device while it is online, before
offering to start over, since starting over repeats work that already
exists. A Done screen open when the device goes offline stays open and can
send: the draft could be heard while it was open, and those parts are on the
server already (`doneShows` in `recording/workspaceModel.ts`); a Done asked
for while the draft is locked still waits. The Versions page dims a draft's
Done while part of it cannot be heard, and a tap says so. In a back
translation, the bin on a part that cannot be heard waits with Record, since
what was said for it could not be said again. On feedback, "Keep it, say
why" waits while feedback said only aloud (its voice note, or what the review
captured) cannot be heard on this device, and says why; typed words can be
read, so feedback with them is not held, and "Record a fix" is never held
(`keepWaits` in `passage/reviewModel.ts`). Done's line for the feedback a new
version answers says when that feedback was said aloud and is not on this
device, without holding Done: holding it would also stop a translator
starting over offline. Carl chose each of these (2026-11-25); the UI tests
are REC-064, REV-057 and REV-058.
