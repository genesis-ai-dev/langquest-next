# 82. A recorded part keeps how it relates to its neighbours, and its verse numbers are worked out down the list

Date: 2026-10-09 · By: Caleb Koster · Status: accepted

Reason: The recorder groups parts into cards by verse (demo ADR-036,
SIMPLE-7), which needs verse labels on parts. Caleb asked for labelling
simple enough to need no reading: an empty space on the left of each part
that, when tapped, infers the right verse from the parts above and below,
and a long press for a chosen verse or range. Rules: labels come from the
passage's verses (the template's range in its versification), go up the
list, never overlap, may be one verse or a range, several parts may share
one verse, and verses may be skipped for later. What was chosen:
- A part stores a mark, not a number: `next` (the verse after the label
  above), `join` (the same verses as the part right above), `set` (verses
  chosen, as `chapter:verse` from and to) or `none`. Core `verses.ts`
  derives the numbers down a take's cards, so labelling a part higher up
  renumbers the ones after it and the order cannot break; `tapPart`
  picks the first legal change (next, else join the verse above), and a
  chosen verse wins over the parts after it that no longer fit, which lose
  their mark (`settlePartMarks`).
- One new event, `v1.CardVerseSet { unitId, hash, mark, from?, to? }`, a
  register per (unit, card hash) in the language stream (privilege
  translate; migration `20261010010000_card_verse_set.sql`). Keyed by card,
  not take: every list change composes a new draft take, and a card keeps
  its mark through them and into the version it is published in.
- The workspace (`simple/verseParts.tsx`): tap a space to give the part a
  verse, tap a number to join the part above and again to split it out,
  hold for the verse grid with Auto, None and Delete (each tap applies at
  once), slide down the spaces to number many parts, and a gap left for
  later has Record here, which records into its place as the next verse.
  A unit with no verses keeps the one card of numbered parts.
Rejected: storing numbers on parts (moving or labelling one would leave
the rest out of order); labels on the take (each draft change makes a new
take, so marks would have to be copied forward); separate events for
joins and choices (one register per card is simpler to merge).
Reverse if: the same recording needs different verses in different
versions (then marks belong on the take), or teams want labels from the
audio itself (alignment) rather than taps.

Amended (2026-10-10, Caleb Koster): no grouping by verse for now. The
recorder keeps its one card of parts as before, and each part has its verse
space; a part with the same verse as the part above shows that verse hollow
and grey instead of joining a card; a part's own verse is a soft grey tile
with a dark number, so the labels stay quiet beside the parts. The marks, the event and the tap rules are
unchanged.

Amended (2026-10-14, Caleb Koster): a published version shows its verses
too. Caleb found a version's page listing "Play Version 1 (2 takes)", "Take
1", "Take 2" as three rows that looked the same, with no verses. A take
suggests another try at the same audio; these are pieces that together make
the recording. So a version's page (`passage/versionParts.tsx`) plays the
whole version in the clip player, then lists its parts read only, "Part 1",
"Part 2", each with its verse tile as the recorder draws it (`VerseTile`,
hollow for more of the verse above, read by `readPartVerses`). Nowhere on
screen are parts called takes any more; the words "take" and "takes" for a
part are gone from all 15 catalogs (the demo's REC-W2 says takes; this
departs from it on Caleb's word). A part whose stored verses equal the part
above's reads as more of that verse even when both were chosen, and the
v2 import (decision 94) now records such a part as a join, as the recorder
would.

Verses are shown where they exist and never asked for (Caleb, 2026-10-14:
many teams are not required to number verses, and published work needs no
labelling). A part with no verse shows nothing where its tile would be, a
version with none shows no tile column, and no screen counts or flags
verses still missing. Where a version is shown, its verses show too when it
has them: the reviewer's Listen lists the parts under the player (only when
a part has a verse), each part of a back translation names its verse, and
the passage page and Versions page add "Verses 1–4" (first to last) to the
version's line.
