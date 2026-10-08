# Simple redesign: what changes in the app

**Status: agreed with Caleb 2026-10-07; mostly built 2026-10-08 (below).** The specification is the partner demo's proposed ADR-032 to 040
and requirements SIMPLE-1 to 16 (`ng-langquest-ux`, branch
`caleb-simple-translator`, open the demo with `?simple=<screen>`). The
before/after page with every screen is
https://claude.ai/artifact/Mar91Zj5ndvptjyQqGfrva. It starts from Ryder's
"LangQuest simple views" canvas.

When this is built, record it here as decisions (it changes decision 56 and
parts of 29/30 in the demo), and move each line below from "to build" to the
decision that holds it.

## Status (2026-10-08)

Built on branch `caleb-simple-view` (decision 71; decision 56 amended):
items 1, 2, 3, 4 (tab names), 7 (reference chips and the five snaps), 9
(help mode, words on the device, spoken on the web), 10, 11, and the
smaller changes for Keep it, the map, and Settings ("How LangQuest works").
Also built: the review group first in Ask someone, Choose books in New
Language, and a new role while inviting or admitting someone (Caleb,
2026-10-08).

Not built yet: 5 (which Bible was playing per take), 6's term notes, 7's
verse-group cards and side-by-side wide panes, 8 (microphone setup), and
spoken help lines on devices.

## Product requirements that change

These change what the app does, not only how it looks.

1. **One view for everyone, nothing removed** (ADR-032). No Simple/Full
   setting. Less likely choices move one labelled tap deeper.
2. **The passage path is built from what is attached** (ADR-033): Study
   only with a study guide that has steps, then Record and Publish; review
   steps under "Then the team". Listen and Key words are not steps; they are
   reference beside the recorder.
   Today `passage.tsx` shows the method's steps; the person's steps become
   the path and the method's steps the tail.
3. **Publish, then ask** (ADR-034). After publishing, a screen asks the team
   usually doing the next kind (`usualTarget`), preselected. Replaces the
   "Send to ‹team›" button on the record (decision 56).
4. **Study is a generic reader** (ADR-035). Parts appear by what the
   material contains (steps, audio, text, fields), never by pattern. A guide
   placed by template node with no Bible gets no Bible chip and no dock.
5. **The Bible used is recorded.** `v1.ReferencesUsed` lists what was
   offered and opened; it should also say which source was playing while
   each take was recorded, for the review audit.
6. **Key words are a reference chip and grow during the work.** Translators
   already hold `fill_reference`; the chip lists the passage's terms (hear,
   say yours), with "Add a key word" and "Note on a word", which writes a
   `term` note anchor (the anchor exists, no screen creates one).
7. **The recording workspace** (ADR-036):
   - The top pane takes any reference: sources, the passage's study guide,
     key words, notes, and everything recorded for this passage so far (its
     versions, feedback, notes). Earlier recordings are new as reference.
     Back translation offers only the version being back-translated.
   - `recording/splitModel.ts` snaps go from 35/50/65 to four: peek (top is
     one line), about 35, about 65, reference (bottom is one line with the
     record button). Each pane renders more as it gets room. Both open at
     half and then stay where the person left them (`rememberSplit`).
   - Wide windows put the panes side by side.
   - The recorder groups parts into cards by verse label. **Needs verse
     labels on parts**: the verse-labelling work (template levels plus the
     language's versification), not built yet.
8. **Microphone setup by ear** (ADR-037): measure the room's noise for the
   sensitivity, three tries of one sentence varying the pause, pick the best.
   The VAD settings leave the recording screen.
9. **Help mode** (ADR-038): a ? on every screen; while on, a tap explains a
   part (spoken and written) instead of acting. Every screen needs a spoken
   line per part. Replaces Getting started tours for translators.
10. **Getting a language ready** (ADR-039): Language Home becomes a
    four-question checklist (what they record, what helps them, who checks,
    invite) with suggestions picked, then a summary, and a coordinator's My
    Work leads with it until done. One invite screen. Roles read as three
    groups.
11. **Joining** follows decisions 65 to 67 as they are; the simple screens
    only restyle them (ADR-040). Say "device", not "phone" (#56).

## Smaller changes

- "Keep it, say why": voice first, no preset reasons.
- Review: Background is one tap from Listen; decide before giving feedback.
- Back translation: the same workspace, part by part, with Back 10 s and a draggable timeline.
- Map: books with a bar and a count, search and "Next" first; chapters in
  three states, marked as well as coloured.
- Settings (Me): five rows; the rest under More settings.
