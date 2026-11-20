# Folders, stories and books are added on the map, and each change is for the open language only

Date: 2026-11-20 · By: Caleb Koster · Status: accepted

Reason: people could not add or rename folders and stories where they
translate. They had to leave for Manage › Content Templates, which most of
them cannot open (LAN-239, the walk-through on pull request 383). Caleb chose
(2026-11-20) to put the buttons on the map, and to change only the open
language's template: the language gets its own copy on its first change,
and other languages keep the template they had. Rejected: changing the
shared template for every language that uses it (a team's folder would
appear in another team's map), and asking each time (one more question for
a choice that is almost always "this language").
- **On the map.** An outline language's map has "Add a story here" at the
  end of each folder of stories, "New folder" at the end of the map, and
  "Rename" on each folder; a short sheet takes the name
  (`apps/mobile/src/map/OutlineMap.tsx`). A Bible language's book list ends
  with "Add a book", which offers the books the team's numbering has and the
  template leaves out; the book waits to be divided (decision 74). A folder
  holds folders or stories, never both, as the template editor has it.
- **Who.** Only someone who may edit templates sees the buttons
  (`mayWriteLibrary(…, 'template')`, as for dividing a book from the map).
- **This language only.** The change is published as dividing a book from
  the map publishes one for the languages chosen (decision 74), with only
  the open language chosen (`useMapTemplateEdit.ts`, `publishChange`): a
  template another language uses, or another organization's, is copied for
  this language ("Stories (Hadiyya)"), keeping its part ids; a template only
  this language uses gets a new version.
- **A rename reaches the language.** A unit's label comes from its first
  `v1.UnitAdded` (earliest wins, decision 36), so a later version could add
  parts but never rename one. `v1.UnitRenamed { unitId, label }`, a register
  per unit (manage_templates), carries the new name; the selector appends it
  for an outline part whose title changed, so a rename in the template
  editor now reaches languages too. `unitTitle` and the map read it.
  `REDUCER_VERSION` is 22. Older app builds store the event as invalid and
  keep the old name until they update.
- **An empty folder is a folder.** An outline node with `children`, even
  none, becomes a `folder` unit, which is never a passage, so a folder just
  made shows on the map, empty, ready for its first story.
Reverse if: teams want a change on one language's map to reach the other
languages that share its template; then offer the choice decision 74's
dividing a book already asks.
