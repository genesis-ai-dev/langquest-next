# 133. The recording screen has its own Undo and Redo, parts move by a grip, a place opens on the line between parts, and no Undo there runs out

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16): "I don't like the undo toast at all": with 7
seconds to read it, and the next toast replacing it, it "induces panic and
frustration"; an Undo toast on a verse label is "silly", as a verse is plain
to see and easy to change. He asked for the recording screen's own undo and
redo (users' earlier feedback), a six-dot grip to drag parts up and down that
takes the moved part's verse off so it can be labelled again, a clean mark on
the line between parts that opens a place to record into, and a subtle shade
on the parts just recorded. Research on Mobbin (the "Undo and redo in
recording" page) found editors keep undo as two arrows that stay on screen,
greyed when empty, and voice recorders (TikTok, Shopee) put them by the
record button. Narrows 111's "Where Undo is" for this screen and 124's "one
part is still deleted at once, with Undo". What was built:
- **Undo and Redo.** Two arrows in the footer left of the red button (where
  the next part's number was; its row says it), and beside the small red
  button when the recorder is one line, grey when there is nothing to take
  back or put back, out of the way while the red recording view is open. One
  step is one thing done: a whole recording session however many parts it
  split into, recording over a part or into a place, one delete, deleting
  every part (which still asks first), one drag, one verse tap, slide or
  choice. Every undo and redo is new events putting the parts as they stood
  (`workspaceModel` `restoreSpecs`: a new take continuing the draft, or the
  draft set aside when it is back to what it started from, and the verse
  marks), never removing any; a verse mark changed since the step (here, or
  in another draft sharing the part) is left as it is. No depth limit. The
  history is kept with the draft on this phone (`useUndoHistory`,
  AsyncStorage `parts-history:v1:…`) through leaving the screen and the app
  being closed, ends when the draft is published, does not sync, and is not
  offered when the draft has moved on elsewhere (`historyFits`). What an undo
  or redo changed is shaded, and a screen reader hears what it was. No toast
  on this screen offers Undo, and the part, verse and move changes say
  nothing on screen (a screen reader is told). Back translation has the same
  arrows for its pieces (a session, or clearing a part; `bt-history:v1:…`).
- **Moving a part.** A grip at the left of each part (`slots.tsx`
  `PartGrip`; `useDragRows`, `dragModel`): the row lifts and the rows it
  passes move out of its way, the pane scrolls near its edges, and a screen
  reader has Move up and Move down. The moved part's verse is taken off;
  every other part keeps the verses it showed, a mark that read them from the
  part above naming them instead (`marksKeepingLabels`), so nothing is
  renumbered by a move.
- **Recording between parts.** A small + on each line between two parts and
  above the first (`InsertMark`) opens a place there, numbered as the part
  will be (`slotRows` `open`); the red button records into it. The + marks
  sit in a rail at the left of the rows, before the grips, so each one's
  48 pt target overlaps nothing a row has to tap (A11Y-009). What is said
  there has no verse, unless it sits inside one verse said in pieces, when it
  is more of that verse; the parts around it keep theirs.
- **Just recorded.** The parts a session added are shaded faintly red (the
  recording view's colour) until the next session starts. The card of parts
  is open at every size of the pane unless closed, and back from the red
  view the first part just said is brought into view (Caleb: "have the list
  of audio segments expanded by default so that when the user leaves the
  waveform recording view, they see the newly added/toned segments"); it
  used to open by itself only when the pane was 360 pt tall.
Considered: an undo history in memory only (phones close apps in the
background; a history that vanishes is the toast's problem again); undo on
the record by walking the draft's takes (verse marks are not in takes, and
redo needs a way forward); a long-press to move parts (nothing shows it can
be done).
Reverse if: people undo by accident (the arrows sit beside the red button),
a history kept on the phone undoes work they expected kept, or the grip is
dragged by mistake while scrolling a long list.

Amended (2026-10-16, Caleb Koster): the grip is now at a part's right end
and the + marks sit on the card's right edge, half off it, not in a rail at
the left; a part is deleted by sliding its row to its bin (decision 136).
