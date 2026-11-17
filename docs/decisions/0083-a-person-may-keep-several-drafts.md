# 83. A person may keep several drafts of a passage, each one the line of takes its changes made

Date: 2026-10-10 · By: Caleb Koster · Status: accepted

Reason: Caleb asked that people can make several versions of a passage and
save, delete, edit, publish and send each for review freely. Until now each
person had one draft per passage: every change composed a new take and
retired their previous draft, so starting over meant losing the last try.
What was chosen:
- No new event. A draft is the line of takes its changes composed
  (`v1.TakeComposed` with `parentTakeId`); the take it started with names
  it. Core `derivePassage` lists every open draft (`drafts`, anyone's, in
  the order started, each with its first take and the version it started
  from), and `keepTake`, `publishVersion` and `discardCards` take the take a
  change continues (`parentTakeId`): the draft open in the workspace (whose
  take is retired), a version to start from, or null for a draft started
  empty. Left out, they continue the person's latest draft as before.
- Deleting a draft is `deleteDraft` (`v1.TakeArchived`, only the person's
  own). Its Undo composes the same parts continuing the deleted take, so it
  is the same draft again.
- A published version never changes. Editing one starts a new draft from its
  parts; it publishes as a new version, as every change does (REC-W3).
- Screens: the passage record's "Versions and history" is now a page: the
  person's drafts (play, Edit, Publish, Delete with Undo), then the
  published versions (play, open, Edit, and on the latest, Ask for its next
  check), "New version" to start empty, then the study, reviews and history
  that used to open in place. Record opens the person's only draft, or the
  page when they keep several. The workspace opens one draft, says which
  ("Draft 2"), and has Save, which says the draft is kept (every change
  already is) and goes back. Publishing then asking for a check is
  unchanged (demo ADR-034).
- Verse marks (decision 82) stay on cards, so drafts that share parts share
  their marks. A mark relative to its neighbours (next, join) still reads
  right in each draft; a chosen verse is the same in all of them.
Rejected: a name per draft (a new event, and typed names suit oral teams
poorly; drafts are numbered in the order started instead); deleting a
published version (reviews and requests point at it; nothing removes one).
Open: a request for review names the passage, not a version, so asking for
a check always means the latest version. Sending an older version for review
would need a new event with the version in it.
Reverse if: teams need drafts others can pick up and change (then a draft
would need an owner other than whoever composed its takes).

Amended (2026-10-16, Caleb Koster): "deleting a published version" is no
longer rejected. Whoever published a version can delete it, as a tombstone
that keeps its number and its checks on the record (decision 124). Deleting a
draft now asks first instead of offering Undo.

Amended (2026-10-15, Caleb Koster): the workspace has no Save any more; a
saved mark in its header turns from a spinner to a check as each part is
kept, and Publish is Done, which asks for the next check in the same tap
(decision 127).
