# 176. Clean up puts a part's cleaned sound in a new draft in the part's place; the part as recorded stays on the server, and phones do not download it

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-27 and 2026-10-28, thread "Choose voice protection and
audio cleanup tools") asked for Clean up: noise removal on one part, behind
the part's ⋯ menu, with a slider for how much, a pick between the cleaned
sound and the original (Use / Not used), and Undo. He chose to keep the
originals: "hold on to those in the background and just tie them together",
so they can be recovered later, while reviewers hear the translator's pick.
This entry is the record and the files; the screens come later.
- **One new event, `v1.CardCleanUpSet { unitId, hash, use, cleanedHash?,
  cleanedFormat?, tool?, limitDb? }`**, a register per (passage, part as
  recorded). `cleaned` names the cleaned file and its format; `original`
  says someone tried and kept the part as recorded, and saves nothing else;
  `none` is Undo. `tool` is what removed the noise (`dfn3`, DeepFilterNet
  3) and `limitDb` the most it may take out. Translate privilege, as for
  verse marks (`20261028030000_card_clean_up.sql`).
- **The audio is never changed (invariant 4).** Using the cleaned sound is
  a new draft that holds it in the part's place, with the part's verse mark
  copied onto it (core `cleanUpPart`); Undo is a draft with the part back
  (`undoCleanUp`). A version already handed on keeps playing the part it
  had, so nobody swaps the audio under a review (75).
- **The cleaned file is a card without a recording.** The note names it, so
  `recordedCard` gives it the part's length and the note's format, and
  players and the Worker's API play it like any card. It is not a
  `RecordingAdded`, so reports do not count it as a new upload.
- **A cleaned file stays named whichever note wins.** The register keeps
  every cleaned file any note on the part named (`keptCleanUp`), so if two
  phones choose for the same part, the sound the first one made still goes
  up and still plays in the draft that holds it.
- **Originals stay on the server and off phones.** The part as recorded
  still uploads like any part. While the note says to use the cleaned
  sound, the part as recorded is left out of what a passage needs offline
  and out of every download (`FilePlan.aside`), and a phone may free it once
  the server has it. A language kept on disk (143) says the same in the
  cleaned file's audio row (`r`), written again when the note changes. The
  server never deletes a file a record names, so the original can be
  recovered later. This keeps "masters stay raw" (135): the cleaned sound
  is a new file, not a change to the recording.
- `REDUCER_VERSION` goes to 20, so phones fetch each stream again once (110).
Reverse if: people listening to an older version offline miss the part as
recorded (a phone fetches it only when it plays online), originals are
never recovered and their storage matters, or teams want to clean a whole
book at once, which would need one note for many parts.
