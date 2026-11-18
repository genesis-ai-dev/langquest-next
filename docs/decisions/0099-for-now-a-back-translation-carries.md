# 99. For now a back translation carries one spoken note

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: a back translation's notes at moments each keep their words, but
the event has one voice note (`noteBlobHash`). Every spoken note after the
first was silently replaced by the last one said. The UI test suite found it
(REV-035). Until a versioned event can carry a voice note per moment, the
first note said aloud keeps the voice note, and later notes, including the
publish sheet's, are typed. The sheet says so ("One spoken note per back
translation for now: type this one.", `simple/btWorkspace.tsx`).

Reverse if: the event that carries a voice note per moment ships; this
entry is then superseded by it.
