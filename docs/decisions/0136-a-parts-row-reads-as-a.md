# 136. A part's row reads as a voice message: verse, play, its bars and length, and the grip; it slides aside to its bin, and the + hangs off the card's edge

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16), choosing from the "Recording row order" research
page: "I like replacing the name with a voice message waveform image", with
the verse label, a line, play, the bars and length, a hamburger grip, and
"half-hanging off the end of the card at the line intersections is the small
plus icon". Then: "Can we have the user swipe left/right to trash a
recording? Then we don't have to have a garbage icon on each row at all -
more space then", deletion with a confirmation, a one-time animation of a
part sliding to show the bin, and an opened place that looks "different -
like a pill with space around it". The research found most apps put the grip
at the right and keep delete behind a swipe or a menu, not on every row.
What was built:
- **The row.** The verse space, a line, play, the part's bars and its
  length (`partBars.tsx`; the name is gone from sight, and a screen reader
  still hears "Part 2"), the grip (three lines) at the right end. Tapping
  the bars chooses the part to record over, as tapping its name did.
- **The bars.** Each part's sound in 64 even slices, as tall as its
  loudest allows, a quiet part staying low (`audio/barsModel.ts`), kept on
  the phone by the audio's hash (AsyncStorage `bars:v1:…`, `barsStore.ts`):
  worked out from the WAV when a part is recorded, before a phone encodes it
  to AAC (`useRecorder`), and for a part recorded before, read once from its
  file (`barsOfFile.ts`: a WAV on a phone, anything the browser decodes on
  the web). A phone has no AAC decoder, so an AAC part it did not record
  shows a low even line until a native reader is added. Bars are not
  events: they are worked out again from the audio wherever they are needed.
  They fill from the left as the part plays.
- **Deleting.** A row slides either way, by finger or mouse, to show a red
  bin behind it, and stays open on it (`swipeRow.tsx`); tapping the bin is
  the confirmation, and the footer's Undo brings the part back (133). A tap
  on the open row closes it; one row is open at a time. A screen reader
  opens it from the part's "Delete Part 2" action, and the hold sheet keeps
  its delete. The first time a phone shows a list of parts, the top one
  slides right to show the bin, then back (`useSwipeHint`, once per phone,
  not with reduced motion).
- **The + marks.** On the card's right edge at each line, half off the card.
  Each 48 pt target is centred on the edge: the rows and the header leave
  the 24 points inside it with nothing to tap, the card sits 8 points
  further in from the screen's right edge so the target ends at the screen's
  edge, and the card's box reaches past its drawn edge so a phone delivers
  the taps (A11Y-009). The header keeps a band under its buttons for the
  first +. An opened place is a pill with the microphone and space all
  around it, dashed until chosen.
Considered: a bin on every row, or the no-entry icon at its left (the row
needs the room, and Caleb chose the swipe); deleting on a long swipe with no
bin (no confirmation); bars from the recording session's live levels (they
are gone once the session is left, and older parts never had them); a new
event carrying the bars (they come from the audio, so nothing needs to sync).
Reverse if: people delete by accident while scrolling, cannot find how to
delete without the hint, or the low even line on older phone parts reads as
silence.

Amended (2026-10-17, Caleb Koster): a session's parts take their bars from
the levels the recording screen showed for their boxes (`barsFromLevels`),
read as the session is left, so leaving no longer reads every part's WAV in
JavaScript before saving it. Caleb saw parts fill the list slowly, one by
one, after leaving a session; in Hermes on a Mac that read took about 390 ms
for ten 8 s parts, and the levels take under a millisecond. The live levels
were set aside above because they are gone once the session is left; they
are read just before it goes. A hold-to-record take, and a part found again
after a restart, still read their WAV. The bars are each slice's level from
the frames' loudest samples rather than every sample, so a row can look a
little fuller than one read from its file.

Amended (2026-10-20, Caleb Koster): help mode shows a part's bin. Caleb did
not see the slide on a first recording and asked whether the ? explains
swiping to delete; it did only in the second sentence of the sound bars'
bubble ("Record Part 1 again"), where someone looking for delete would not
tap. While help is on, the list's second part (its only one, when there is
one) stands open on its left-hand bin, so the first row keeps its own
numbers in sight (`helpBinRow`), and the bin has a number of its own: "Slide
any part aside to show its bin, then tap the bin. Undo brings it back." The
row closes when help goes off. The bars' bubble keeps only what a tap on them
does. The slide itself was checked, not changed: on a device that never saw
it, the first recording's parts slide once and it is kept as seen; builds 22
and 23 and every update since carry it, so a phone that recorded on any of
them has had its one showing.

Amended (2026-11-02, Caleb Koster): the grip is six dots, not three lines
(LAN-132, decision 199). Carl found people read three lines as a menu and
tapped them; a tap on the grip now bounces its arrows to show it drags up
and down, and nothing moves.
