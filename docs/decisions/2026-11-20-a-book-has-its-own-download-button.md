# A book, and a section of an outline, has its own download button, which keeps each of its passages

Date: 2026-11-20 · By: Carl Sauder · Status: accepted

Reason: a download for offline could be chosen only on the lowest unit, a
chapter or a passage (decision 61), so keeping Luke meant a tap on each of
its 97 passages. Carl (LAN-316): "Some users that will be offline for a
while may want all the work done on one or more books to be stored on their
device". Decision 166 named this as its reversal: if teams want a whole book
at once, a book gets its own button.

- **Where.** The line over a book's passages, which only counted them, is
  the button (`GroupOfflineBar`, sync/offline.tsx), on a book of chapter
  tiles, a book of passage rows and the "Other" list. A language with its
  own outline has the same button as a round mark at the end of each
  section's name (`GroupDownloadButton`).
- **What it keeps.** The book's passages, each added to the device's kept
  set in one write (`LanguageSession.keepOffline` takes a list). The choice
  stays each passage's own, as decision 61 has it: the book button makes
  that choice for all of them, and each passage's button still shows and
  changes its own. So nothing new is stored, no event is added, and every
  mark keeps counting from the passage's own files.
- **What it says** (`groupLook`, sync/offlineModel.ts), by decision 166's
  rule that a line says only what the device knows: before the tap, "Download
  all 97 passages for offline" and how much audio would come
  (`LanguageSession.offlineCost`: the files the server has that the device
  lacks, each counted once); with some kept already, "Download the other
  85"; then "Downloading for offline · 12 of 97" only while a file comes
  down, and "All 97 kept passages are on this device" only when each
  passage's own count says so. Offline it offers nothing. Until the size is
  worked out the line says "Checking this device…", so an offer never
  appears and then changes under a thumb; the size is asked again as the
  language changes, at most every few seconds. While a first download still
  fills the language in (decision 147) the device does not know every
  passage's files, so it could not say the size or whether it fits: the line
  says "Downloading this language" and offers no book until that ends. Each
  passage's own button still works then.
- **A tap once every passage is kept** lets go the ones the person chose,
  as a passage's button does; those asked of them or worked on stay, and the
  toast says how many.
- **No room, no offer.** Kept files are never deleted to make room
  (decision 226), and a download from the server is not held back when
  space is short, so a book that would take the device under the 500 MB
  kept free for recording is not offered: the line says its size and the
  room there is. Room is what is free above those 500 MB
  (`BlobStore.roomBytes`) and what the device would free for the book by
  itself (`offlineCost`'s `freeable`: files here that the server has and no
  kept passage would need), so a book is not refused for want of room the
  device would make. A tap asks again, since room changes, and keeps the
  book only if it fits by then. A browser, and a phone whose disk will not
  say, cannot tell how much room there is and are not held back.

Considered:

- **Keeping the book itself**, so passages that join it later come along.
  It needs a key for a book that is not a unit (passages added by hand are
  put in a book by their name) and a list of exceptions for a chapter let go
  from a kept book. A book's passages change only when it is divided
  differently (decision 80), which is rare; then the button offers the new
  passages and one tap keeps them.
- **A button on each book's row of the Map.** A row has no room to say the
  size before the tap.
- **A testament or the whole language.** A whole Bible's recordings can pass
  the 2 GB cache cap, kept files are never freed, and reference audio stops
  at its own 1 GB (sources/offline.ts). It needs a size budget first.

Amends decisions 61 and 166.

Reverse if: people keep a book and still miss audio in the field, because
reference audio reached its cap or is not counted in "on this device" (then
it is counted, or the cap is said); books are divided again often enough
that kept books lapse (then the book itself is kept); or teams ask for a
whole testament or language (then a size budget comes first).
