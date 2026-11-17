# 129. A recording session stays open after Stop: its parts are boxes to hear, move or drop, and leaving it cuts them from the room kept around them

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (LAN-82, 2026-10-16) to fix a part's start and end in
the session rather than after it: tap a box to hear it, drag its edges, drop
it with the × in its corner, and "once they leave the session, that's that",
so nothing about a part's edges is ever saved. It extends 125, which left
this for its own change, keeps 124's rule that a deleted part's place
stays for what is said next, and narrows 83 and 127 for a session's parts:
they reach the record when the session is left, not as each is said.
- **Stop is not leaving.** Stop turns the microphone off and the session's
  waveform stays, showing the whole session (as far as the farthest zoom,
  then one finger slides back over it): a tap on a box plays that part as it
  would be cut, its edges drag out into the room around it or in (never into
  another part, never shorter than a fifth of a second), its × drops it and
  the next part said takes its place and number. The big button carries on
  recording in the same session. Done (124's check), leaving the screen, or
  the app's journal on the next launch ends it, and only then are its parts
  cut and saved, in order, as their boxes stand. Uploads and the footer's
  Done (127's, which was Publish) wait until then; while the session is open
  the recording view's Done is the only one. Its ✕ (Caleb, 2026-10-16)
  stops recording and asks "Throw away this recording?" with what the
  session holds; throwing it away saves nothing said in it, and a session
  that kept no part just goes. The same holds in back translation.
- **The room near speech is kept, not the session.** A chunk file opens when
  a part starts, with up to 2 s of what was heard before its head, and closes
  2 s after the last part in it ended (`modules/microphone-energy/src/chunks.ts`,
  ported line for line to `Chunks.kt` and `Chunks.swift`; the three keep the
  same samples on the same frames). Parts close together share a chunk; a
  long silence is never written, so storage grows with speech (about 5 MB a
  minute of it, as a WAV) and memory holds only the ring (about 5 s). The
  module reports each part as where it lies in its chunk; nothing is cut
  until the session is left (`src/audio/wavCut.ts`), then the chunks go.
- **A crash loses nothing said on a phone.** Each part is in the recording
  journal as its chunk and its box (`range`) from the moment it ends, and
  again when an edge is let go; recovery cuts it as it last stood
  (`recordingJournalModel.ts`). The web keeps a session in the page until it
  is left, and the browser asks before the tab closes; a tab killed outright
  mid-session loses that session's parts (the phones were the concern).
Considered: saving each part as it ends and replacing it when its box
changes (it writes recordings nobody keeps, and the draft changes under the
person while they edit); one file for the whole session (an hour of room on
a low-end phone's storage); keeping box edges editable after the session
(Caleb: what is saved is where the boxes were when it was left).
Reverse if: people lose parts by leaving a stopped session open (the app
killed in the background on a phone without its journal entry), the 2 s of
room is too little to reach a cut-off word, or the web's in-page session
loses work people expected kept.

Amended (2026-10-30, Caleb Koster): with the silence switch on (194) a
chunk stays open through every pause until the microphone stops (a stop, or
the source playing), so the room between parts is written whole and kept
as parts of its own. Off, chunks open and close as above.

Amended (2026-10-30, Caleb Koster; LAN-199): Caleb asked that a box stretch
over a neighbour whose box was dropped, and that a box be added between
boxes or either side of them. Both need the room between parts, so with the
silence switch off a chunk now also stays open through a pause, up to 30 s
after the last part ended (`ROOM_KEPT_MS`, `keepRoomNow` in
`livePartsModel.ts`); past that the app turns the module's `keepRoom` off
and the chunk closes, so a phone left listening does not write the room for
ever. That is no native change. Storage grows with speech plus at most 30 s
of room a pause (about 2.6 MB as a WAV). A box's edge moves over a dropped
part's sound up to the next box, never into it. Stopped, with the switch
off, a + in room no box covers adds a box over that room (`liveGaps`,
`liveAdd`): a part like any said, journalled like one, placed in the
passage right after the part before it in time (or right before the part
after it), and filling a dropped part's free place there. The first time a
phone stops a session, two fingertips spread over the waveform to show the
pinch (`usePinchHint.ts`). A store build from before 194 ignores
`keepRoom`, so its boxes still reach only the 2 s of room.
