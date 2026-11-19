# Design principles for screens

Kind: reference

What every screen keeps. Moved here from PLAN.md section 12 on 2026-11-19
(`docs/decisions/2026-11-19-each-doc-answers-one-question.md`). How the app
follows the partner demo, and the conventions each screen file keeps, are in
`docs/ux/demo-parity.md`.

The app follows the partner demo in `ng-langquest-ux` (its flow, look and
capabilities; `docs/ux/demo-parity.md` maps it onto this repository). The
demo's `docs/design-principles.md`, `docs/requirements.md` (REC-3 and so on)
and `docs/decisions.md` (ADR-nnn) are the specification for screens. In
short:

- **A record with advice, not a pipeline with gates.** Each passage builds
  up a record; the language's review flow advises what should be in it.
  People may skip a step, work out of order, or keep a version despite
  feedback, and each departure is recorded with a reason ("comply or
  explain"). Checkpoints are the only hard stops, and someone with Override
  Checkpoints can move past one, with the reason logged.
- **Permissions and method are separate.** Permissions (edge gates, the
  server's `may_emit`) say who may act; the flow never does.
- **One place for what's next.** Everyone who does or asks for work lands
  on My Work; the Map finds any passage at whole-Bible scale; the passage
  record is where every loop closes, with a toast after every action and
  its way back in the record's History.
- **No Undo that runs out** (decisions 133, 134): a toast says what
  happened and nothing more. The way back stays with the thing: History's
  Undo or Withdraw, the same control, or Undo and Redo arrows on screens
  where people build something. What cannot come back asks first.
- **Simple on the surface, deep in the record.** One next step and one main
  button; background and history behind one-line summaries.
- **Built for the field.** 48pt targets, 56pt primary actions, 13pt minimum
  text, status colours that never change and never carry meaning alone.
- **Words are never cut off** (decision 139): in every interface language,
  on a 360pt phone, the app's own words show in full. A label longer than
  its place wraps onto another line, side-by-side things move under each
  other when they no longer fit, and a few choices wrap rather than sit past
  the edge. Only people's own content (names, notes, titles) may be shortened
  in a list, and it shows in full where it opens.
- **A to-do opens the task itself** (demo principle 11): a My Work row, an
  update, a Get ready step or a warning opens the thing to do in its language,
  book or passage, never a list to search, and says why it is there.
- **Ready-made choices come with your own** (12): making your own comes
  first and looks different from the presets, so a growing list never buries
  it; it can start from a preset.
- **Decide with the material in front of you** (13): a decision about content
  is made with the text open in a Bible the person chooses and its reference
  material beside it.
- **Show what others usually do** (14): where there is a common answer (where
  most Bibles start a section, what the organization's other languages use),
  the choice shows it.
- **Every part explains itself** (help mode, decision 71): while the ? is on,
  everything a person can tap, type in or switch lights up and says what
  tapping it does instead of doing it, sheets included, and a mark that means
  something without words (a coloured dot, a tick, a bar) says what it means.
  In a list, one row speaks for the rest: only the first row in sight takes
  numbers, the others stay dim and still explain when tapped (`HelpRow`), so
  a list of twenty never shows twenty sets; items that each do something
  different (tabs, filters) keep a number each. A new control gets its line
  (`help`, or a Row's `sub`) and a new list its `HelpRow` when it is built;
  `apps/mobile/test/helpParts.ts` holds both.
- **What you make needs no saving** (decision 127): nothing asks "Leave
  without saving?". What someone makes (a recording, a review, a
  note, an editor's changes) is kept as they go, only for them, and a small
  mark in the header turns from a spinner to a check as it is kept. One
  button finishes it and shares it, named for what it does for others
  (Done, Add note, Looks good), and Done offers the next step in the same
  tap: send it to whoever usually does the next check. A shared setting (a
  name, permissions, someone's role) keeps its Save button, since it changes
  things for everyone.

Tokens are `apps/mobile/src/ui/theme.ts` (the demo's `C` and `TINT`);
primitives are `apps/mobile/src/ui/kit.tsx`. `docs/ux/one-next-action.html`
records the earlier task-first design. Recording now splits the screen with
the source instead of taking it over (decisions.md 56). Each screen's main
action, secondary actions and way back are in `docs/ux/screen-path.md`.
