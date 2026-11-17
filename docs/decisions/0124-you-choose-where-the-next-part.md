# 124. You choose where the next part is recorded, a whole thing asks before it is deleted, and a deleted version is a tombstone

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Spoken's tester could not find how to delete a version or a part,
or how to say one part again (LAN-83). On a phone at half split the parts
were hidden behind "drag up to see them", and with verse numbers a part's
delete was only in the menu a hold on its number opens. Caleb's rules: no
sentences explaining the screen, the layout carries it; recordings are
parts. What was built:
- **Parts and where the next goes.** The parts card shows at every size
  (closed when the pane is small; opening it gives the recorder the room),
  named "Version N" while its parts are still that version's. Every part has
  a bin. The person taps where the next recording goes: a gap (verses left
  out, decision 82, or a deleted part's place), a part (what is said next
  replaces it, with Undo), or the end, which is lit by default and dashed
  otherwise. The chosen place is tinted with a purple microphone and the
  footer names its number; the red button records there. A deleted part's
  place stays open and chosen, numbered and with its verses; the first part
  said in a place takes its verses and the rest join them
  (`workspaceModel` `slotRows`, `targetNumber`; `screens/translate.tsx`
  `aim` and `hole`; `recording/slots.tsx`). The amber "left for later" row
  and "Record here" are gone, as are the lines "These are Version N's
  parts…", "drag up to see them", "Tap the red button and speak…" and "No
  drafts. Edit a version below…".
- **Asking first.** Deleting a whole version, a draft or every part opens a
  sheet ("Delete Version 2?", what it holds, Delete or Cancel;
  `ui/ConfirmDelete.tsx`) instead of a toast whose Undo runs out. One part is
  still deleted at once, with Undo.
- **A deleted version is a tombstone.** Whoever published a version can
  delete it (`canDeleteVersion`, `deleteVersion`). No new event:
  `v1.TakeArchived` on the submitted take, add-wins, with the first archive's
  clock and actor kept (`Take.archivedAt`, reducer version 18). A reviewer
  may have the version offline and check it a month later, so the version
  keeps its number (`nextVersionN` never reuses one), and checks of it, before
  or after the delete arrived, are kept in `reviewsOfDeleted`: shown in the
  history and on their own page, marked "Version N deleted", and counted for
  nothing (status reads only `reviews` of versions not deleted). Its page
  still opens, as what it was.
- **Recording view.** While recording, the pane below the divider is the
  red recording view, in the workspace and in back translation alike
  (`recording/RecordingView.tsx`, which replaces the back translation's
  `VadTakeover`): the part being said with its verses, the time, a check
  (Done; a cross read as throwing it away) and the live waveform, which the
  "Recordings getting cut off" work (LAN-82) owns (`LiveParts.tsx`). Its
  sensitivity line and pause chips went with it.
Rejected: a new `v1.VersionDeleted` event (an archive is already the
tombstone, and the server accepts it from translators); letting anyone with
a role delete someone else's version.
Reverse if: teams lose work by deleting versions others were relying on
(then deleting would need the checks to be withdrawn first, or a role), or
people miss the end of the list as the default place to record.

Amended (2026-10-16, Caleb Koster): one part is deleted at once with no toast; the recording screen's Undo arrow brings it back, and also a whole set of parts deleted after asking (decision 133).

Amended (2026-10-16, Caleb Koster): one part is deleted by sliding its row
aside and tapping the bin it shows; the rows have no bin of their own
(decision 136).

Amended (2026-11-01, Caleb Koster): the recording view's top row names no
part. It showed the number of the part to be recorded next, so after Stop it
read "Part 2" over the one box numbered 1, and "Part 3" while Part 2 was said
again; the tutorial frame check held three videos for it. Caleb chose to drop
the title rather than make it name the parts just said: the boxes on the
waveform are numbered, and that is enough. The row keeps the status
(recording, listening, stopped), a deleted part's verses when one is filled,
the time and Done; screen readers hear the status with how many parts are
kept so far. In back translation the source part stays named above, on its
player.

Amended (2026-11-13, Caleb Koster): an admin of the language may delete any
version, not only their own. An admin is someone who holds `manage_roles`
there: an Organization Admin, or the Organization Admin role given for one
language (a Language Admin). Coordinators, translators and reviewers still
delete only what they published. Reason: Caleb asked that an admin can
remove work so that a passage looks as if nobody had worked on it yet, for
example work brought from LangQuest v2 that should not count (Every
Language's Berom team lost most of its v2 audio, 2026-11-13). Imported work
is published under the v2 person's name, and that person may never sign in
here, so only an admin can clear it. When a passage's last version is
deleted, the passage shows as not started (`recorded` is false). It is the
same tombstone as before: the version keeps its number, and the history
still shows it and who deleted it, so nothing is lost (hidden, never
deleted). Caleb chose this over a new "clear the whole passage" button,
because the Delete button and its ask-first sheet already exist, and each
of Berom's imported passages has one version. The server already accepted
`v1.TakeArchived` from anyone who may translate, so only core
(`canDeleteVersion`, `deleteVersion`'s `admin`) and the app change.
