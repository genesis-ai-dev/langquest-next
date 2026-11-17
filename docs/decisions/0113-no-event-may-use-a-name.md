# 113. No event may use a name every object already has

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: the fold keys its maps by the ids in events (`state.takes[takeId]`),
and a security audit showed that a member with `translate` could push
`v1.TakeArchived { takeId: "__proto__" }`: both validators passed it, and
folding it set `archived` on Object.prototype, so every object on every
phone in that language, and in the projection worker, changed, on every
refold, for good, since the log is append-only. Now no string or key at any
depth of a payload, and no envelope field, may be one of the names a plain
object answers to (`OBJECT_MEMBER_NAMES` and `objectMemberNameIn` in
`packages/core/src/validate.ts`; SQL `_names_object_member`, migration
20261016020000). The fold runs `validateEvent` first, so an event like
that already in a log is folded out as invalid. Checking every string, not
only the fields that are ids, holds future event types without a list to
keep; the cost is that a note or comment that is exactly one of these
words, such as "constructor", is refused, while a longer text holding one
is not. Turned down: maps without a prototype (`Object.create(null)`),
which every snapshot load would need to rebuild, and checking only the id
fields. The parity script tries each name in every string field and as a
key; tests `packages/core/test/objectMemberNames.test.ts`, server smoke 5e.
Reverse if: a real text payload that is exactly one of these words is
refused in the field; then check only the fields the folds use as keys.
