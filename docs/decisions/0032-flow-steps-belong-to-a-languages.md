# 32. Flow steps belong to a language's selection and are never removed on a switch

Date: 2026-09-28 · By: Caleb Koster · Status: accepted

Reason: removal is add-wins, so a step id removed once can never come back.
Catalog steps are therefore namespaced by language and flow
(`lane/flow@2/s1`) and choosing another flow only changes the selection;
`deriveFlow` shows the selected flow's steps. Switching back restores the
same steps, and what the record says about them (a checkpoint moved past)
still applies. Hand-edited steps live under the language's `custom` prefix
and new ones get fresh ids. Reverse if: step ids must be shared across
languages; then key overrides and skips by kind instead of step.

Amended (2026-10-06, Carl Sauder): each language now has a stream of its
own (63), so step ids are namespaced by flow version only
(`<flowId>@<v>/<step>`, `custom/<step>`); the add-wins reason still holds.

Amended (2026-10-12, Caleb Koster): a ready-made flow is now copied into the
`custom` prefix (decision 91), so choosing one replaces the language's own
steps; Undo puts them back, under the ids they had.
