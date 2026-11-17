# 194. A switch beside the red button boxes the silence between parts too, and leaving the session keeps each silence as a part of its own

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-10-30, thread "Show silence as segments while
recording") for a switch in the red recording view that also captures the
silence between speech as parts of its own, boxed while it is on and not
while it is off, and plain to tell apart from speech once the parts are in
the list. He chose the design from five mockups ("Go").
- **The switch** sits in the footer right of the big red button while a
  session is open, where Done is once it is left (`silenceSwitch.tsx`): a
  picture of speech bars either side of a flat line in a dashed box, and a
  switch, with no words (help mode explains it). The phone keeps it
  (`silenceSetting.ts`, `recording:silence-parts:v1`), and it can be
  flipped at any time in a session, recording or stopped.
- **A silence's box** is dashed, its number in an outlined pill, and it takes
  a part's number in passage order, so the speech after it is numbered on
  (`livePartsModel.ts` `liveSilences`, `liveNumbered`). While recording,
  the silence after the last part grows until the next is said. Stopped, a
  tap plays it; it has no edges or × of its own, since it always fills the
  room between the two parts beside it: it follows their edges, and goes
  when either is dropped. Leaving the session cuts it from the chunk like a
  part (`liveKept`) and it goes into the list as an ordinary part, its bars
  read from its file, so they lie flat.
- **Only silence kept whole is boxed**: two parts said one after the other
  in one chunk, with no stop between them, side by side in the passage, and
  half a second apart at least (`MIN_SILENCE_MS`, the least the room is
  read in). Not the room before the first part or after the last. While the
  switch is on the microphone module keeps the chunk open through every
  pause (`chunks.ts` `keepRoom`, amending 129), so every pause in a stretch
  is on storage; a gap from before the switch was turned on, spread over two
  chunks, is not boxed rather than boxed with its middle missing.
- **A silence plays as recorded**, never turned up to −16 LUFS (182,
  amended): a part that is only room is not given its loudness. So it shows
  no noise warning (181) unless the room itself is loud.
- Storage and memory: with the switch on, a phone writes the whole stretch
  (about 5 MB a minute as a WAV, as 129 says of speech) until the session is
  left, and the web holds it in the page, about 11 MB a minute, until a stop.
- A silence has no journal entry while the session is open, so a phone
  that crashes mid-session gets its speech parts back (129) but not the
  silences between them.
- The chunk change and the loudness line are native, so this ships in a
  store build, not an OTA update.
Rejected: a silence with handles of its own (two edges to drag where one
part's end and the next's start already are); boxing the room before the
first part and after the last (it is not between anything); keeping only
the 2 s of room on each side of speech that chunks already kept (a pause
over 4 s would lose its middle).
Reverse if: people turn it on and lose track of which parts are speech, the
whole stretch fills a low-end phone's storage or the web's memory in long
sessions, or a recording with a voice in it is played unboosted as room.

Amended (2026-10-30, Caleb Koster; LAN-199): Caleb asked to remove silence
boxes one at a time. Stopped, a silence's box has a × (where it is wide
enough on screen; a screen reader has it as an action): it drops that
silence alone, the parts either side stay, and the numbers after it close
up (`liveDropSilence`). Turning the switch on again boxes every silence
again. A box added with a + (129, amended) is kept as a voice whatever is
in it, so the silence between it and the parts beside it is boxed too.
The + shows only with the switch off. Since the room is now kept with the
switch off as well (up to 30 s after a part), turning the switch on after a
stop boxes that stretch's pauses.
