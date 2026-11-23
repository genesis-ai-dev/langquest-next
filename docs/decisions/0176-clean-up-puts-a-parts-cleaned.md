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

Amended (2026-11-23, Carl Sauder): a part as recorded that a version or draft not deleted still plays comes to phones like that take's other parts. LAN-317 (`docs/decisions/2026-11-20-unheard-recordings-are-not-judged-or-changed.md`) holds a review, a back translation and a draft offline when a part they play is not on the phone. A version handed on before one of its parts was cleaned keeps playing the part as recorded, which no phone downloaded, so a reviewer's passage read "On this device" while the review stayed held at Listen (found reviewing LAN-317 against LAN-316's change). Carl chose: a part as recorded is set aside only when no take that is not deleted plays it (`playedParts`, `FilePlan.aside`, core blobs.ts). A version handed on before the clean-up, or a draft still open, keeps it on the phones that keep its passage, counted in the passage's "on this device" and never freed for room. Once every take that plays it is deleted, it goes off phones again, as before. A part cleaned before it was handed on still stays off phones, since the clean-up retires the draft that held it. A language kept on disk (decision 143) reads the takes of a passage with a cleaned part from its table to tell. Considered: only while the passage's latest version plays it, which misses a review named to an older version and listening to one offline; and only while an open review request plays it, which keeps the least but misses a review started without a request and needs requests and their withdrawals in the file plan. This answers the first "Reverse if" above. Reverse if: the originals of parts cleaned after they were handed on take up enough room on phones to matter (then they come only while the latest version or an open review plays them).
