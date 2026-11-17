# 203. A study step shows the pictures and maps its text asks for, linked or not, and the rest after its text

Date: 2026-11-03 · By: Caleb Koster · Status: accepted

Reason: someone studying FIA on an iPhone wrote from help mode that the
guide told them to stop and look at a map or a boat and there was nowhere to
see it (LAN-222; Caleb asked for the fix). A step showed a picture or map
only under the part whose text links it (`[boat](#m4)`), as the partner
demo did. FIA's own text does not do that consistently: of the 1,524 English
guides on production, 742 ask people to look at a picture or map the text
never links though the passage has it (Luke 5:1–11 and Mark 4:35–41 among
them), 378 link pictures by ids the passage does not carry, and most other
languages link almost nothing (Portuguese 1 link in 352 guides, Swahili and
Tok Pisin none), with picture titles often left in English. Decided, in
`apps/mobile/src/study/picturesModel.ts` and `study/guide.tsx`, without
changing FIA's documents:
- A part that asks to look at something (it says map, picture, photo and the
  like, in each of FIA's languages) and names a picture's title gets its
  card, once per step; a map needs one of its places named when the part
  asks for a map. A link finds its picture by its ref, by the ref without
  leading zeros, or by the words of its label; a link that finds nothing
  reads as plain words.
- After the step's text come the pictures and maps no step links or names,
  and when a part asks for something the app cannot match, every picture
  and map the step does not show already. A step heard but not read shows
  its own there.
On English, parts that ask to look and have a card on the step went from
32% to 81%; the rest are pictures and maps FIA does not have for that
passage (385 of its English map links name maps it attaches to none).
Considered: links added by the FIA adapter at seed time (`scripts/fia-adapter.ts`),
which would reach phones only after the hosted library is seeded again and
would not cover guides an organization writes; one "Pictures and maps" list
per guide, which leaves the reader searching at the moment the guide says to
look. Reverse if: teams report cards that do not match what the text asks
for, or FIA's text comes to link every picture it mentions.
