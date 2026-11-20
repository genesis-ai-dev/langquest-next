# The Key words chip shows the team's words as tiles; a tap opens a sheet in place, so a key word never ends a recording

Date: 2026-11-17 · By: Caleb Koster · Status: accepted

Reason: LAN-233: a translator recording a passage wants the team's word for
each key word in front of them, and a tap on a key word row must not stop the
recording. The old row opened the word's own page (`key_term_detail`), and
leaving the workspace ends the recording session on purpose (no microphone
behind another screen, `useListenLoop`'s `useScreenShowing`). Caleb saw four
mockups and chose: tiles on the Key words chip (the key word small and muted,
the team's word big and green, ▶ for a recorded voice, "no word yet" in amber),
not a band above the chips, which he found too busy.
- **Tiles.** One tile per key word on the Key words chip, wrapping onto more
  lines and never scrolling sideways (decision 139), 48 pt targets
  (`keyTerms/KeyTermTiles.tsx`; which word a tile shows is `ourWord` in
  `keyTerms/model.ts`: the newest written word, else "Recorded word", else none).
- **A tap opens a sheet over the workspace**, never `ctx.go`
  (`keyTerms/KeyTermSheet.tsx`): the meaning, the verses it is in here (a tap
  plays one), the team's words with their voice, the version each was said in
  and the versions that used it (`termWords`, from the change that shares a
  command id with the rendering and `KeyTermLinked.adjustmentId`), every
  passage it is in, and how the organization's other languages say it. What
  would leave the screen (a passage, the word's own page) is offered only when
  nothing is recording; while recording the sheet says it opens after Done.
  Say yours is offered only when not recording and the person may edit.
- **▶ pauses the microphone first and lets it carry on after, as the Bible
  does:** `useClip` takes the recorder's `ListenHooks` (`listen`), and the
  Key words chip, its sheet and the other languages' words pass them down.
- **Our words in the Bible text.** A switch on the Key words chip, shown only
  where the step shows the Bible's text and the team has a word, puts the
  team's word as a small green chip after each underlined key word (a word
  that was only said gets a chip that plays it). The choice is one for the
  whole device, kept as the chosen Bible is (`useOurWordsInBible`).
- A recorded example of a way of saying the word (decision 207) is a voice for
  it: the tile's ▶ plays the newest one when no change holds a voice, and the
  sheet lists a way with no written form as a recorded word.
- Amends nothing else: Add a key word, the key-word lists' sections and All
  key words are as they were (decision 172).
Reverse if: translators who record read the Bible's text with the chips and
find them noisy (the switch then stays off by default, as it is), or a tile's
sheet is too heavy to open while recording on a low-end phone (it reads the
word's passages; then it would load them only on asking).
