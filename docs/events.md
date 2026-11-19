# Events: the catalog, and what a new one needs

Kind: reference

Every write is an event appended to a stream: the organization's, a
language's or a person's (PLAN.md sections 3 and 4). This is the catalog of
event types, each with its shape and the rule that merges two of them, and
what a new one needs. The code is `packages/core/src/events.ts` and
`record.ts`; `validate.ts` and the SQL `validate_payload` check each event at
the door. Moved here from PLAN.md section 6 on 2026-11-19
(`docs/decisions/2026-11-19-each-doc-answers-one-question.md`).

## The catalog
Names are versioned (`v1.X`). Never change a shipped event's schema; add
`v2.X` and keep the old materializer forever. The catalog restarted at `v1`
when the databases were reset (decision 63); nothing older survives.

**Organization stream** (`streamId` `_org`):

| Event | Shape | Merge rule |
| --- | --- | --- |
| `v1.OrgCreated` / `v1.OrgRenamed` | name | one register for both: later clock wins (decision 76) |
| `v1.RoleDefined` / `v1.RoleRetired` | roleId, name, privileges[] / roleId | register per role; retired is add-wins |
| `v1.MemberAdded` / `v1.MemberRemoved` | profileId, roleId, scope / profileId, scope; scope is `{ level: 'org' }` or `{ level: 'language', languageId }` | register per (profile, scope); one role per scope |
| `v1.InviteIssued` / `v1.InviteRedeemed` | inviteId, roleId, scope, expiresAt / inviteId, profileId | issue fields latest wins; redeemed is server-only |
| `v1.JoinDecided` | requestId, profileId, accepted | latest wins |
| `v1.LicenseSet` | license (all-rights-reserved, CC-BY-NC-ND-4.0, CC-BY-NC-SA-4.0, CC-BY-SA-4.0, CC-BY-4.0, CC0-1.0) | ratchet: the most open license ever set wins (docs/licensing.md, decision 38) |
| `v1.LanguageAdded` | languageId, name, code, sourceCode | earliest wins; the language's stream accepts events only after this |
| `v1.LanguageRenamed` | languageId, name | register per language |
| `v1.LanguageCodeSet` | languageId, code, languoidId (a languoid's UUID, or null) | register per language; takes over `LanguageAdded`'s code and links the language to the language list; none means unlinked (decision 78) |
| `v1.LanguageCountrySet` | languageId, country (ISO 3166-1 alpha-2) | register per language; Reports' geography (decision 41) |
| `v1.LanguageTargetSet` | languageId, scope (gospels, nt, ot, bible), startDate, targetDate | register per language; Reports' pace (decision 41) |
| `v1.ClusterNamed` | clusterId, name | register per cluster: making one and renaming it; a cluster is a name on some languages, not a level (decision 108) |
| `v1.LanguageClusterSet` | languageId, clusterId, inCluster | register per (language, cluster): a tag, so a language may be in several clusters or none; a cluster none is in is gone (decision 108) |
| `v1.ReferenceRecommended` | itemId, recommended | register per item; recommended to every language (decision 62) |
| `v1.LibraryItemDefined` | itemId, kind (template, flow, material, versification, names, source, sourceBook, timing…), name, description, copiedFrom? | kind and copiedFrom earliest wins, name and description registers (docs/library.md) |
| `v1.LibraryVersionPublished` | itemId, kind, docHash, note? | grow-only per (item, hash), earliest wins; numbered by clock |
| `v1.LibrarySharingSet` / `v1.LibraryItemArchived` | itemId, kind, shared, subscribable / archived | register per item; subscribable implies shared |
| `v1.LibrarySubscribed` / `v1.LibraryPinned` | itemId, kind, sourceOrgId, sourceOrgName, sourceItemId, name, autoUpdate, active / docHash | register per item; the server writes the pin for automatic updates |
| `v1.Redacted` | eventId, reason | grow-only set; the target is never folded; a redaction is never itself redacted (decisions.md 16) |

**Language stream** (`streamId` the language id; no payload names a language):

| Event | Shape | Merge rule |
| --- | --- | --- |
| `v1.TemplateSelected` | itemId, docHash, unitPrefix, books? | register; the selector emits `UnitAdded` (`<itemId>/GEN.1.1-2.3`) and `UnitHidden` |
| `v1.UnitAdded` | unitId, parentUnitId, kind, label, order | grow-only set |
| `v1.UnitHidden` | unitId, hidden | register per unit; a part the template's version no longer has |
| `v1.BookNameSet` | book, name | register per book (USFM); what this language calls a Bible book, whatever its template calls it (decision 74) |
| `v1.BookNamesSelected` | itemId, docHash, language, names | register; the library book names (one set per language) this language uses, every name carried in; a book's own `BookNameSet` stays on top (decision 193) |
| `v1.FlowSelected` | flowId, itemId, docHash, name | register; the selector emits kinds and `FlowStepSet` under `<flowId>/` |
| `v1.FlowStepSet` / `v1.FlowStepRemoved` | stepId, order, kindIds[], checkpoint / stepId | register per step; removal is add-wins; kinds in one step run in parallel, a checkpoint is the only gate |
| `v1.ReviewKindDefined` | kindId, name, description?, usualReviewer?, withholdsContext?, produces? | register per kind; overrides the shipped kind of the same id |
| `v1.ReviewTeamDefined` / `v1.ReviewTeamMemberSet` / `v1.ReviewTeamKindSet` | teamId, name / teamId, profileId, member / teamId, kindId (null = any) | register per team, per (team, profile), per team |
| `v1.RecordingAdded` | recordingId, unitId, cards[{hash, durationMs}], kind | grow-only set; one event per id, earliest wins (decisions.md 75) |
| `v1.TakeComposed` / `v1.TakeArchived` | takeId, unitId, cardHashes[], parentTakeId / takeId | grow-only set, one event per id, earliest wins (decisions.md 75) / flag, add-wins |
| `v1.TakeSelected` | unitId, takeId | register per unit |
| `v1.TakeSubmitted` | takeId, questionSetIds? | grow-only; the first submission counts |
| `v1.ResponseRecorded` | takeId, respondsToTakeId, note?, blobHash? | grow-only (first wins) |
| `v1.ReviewRecorded` | reviewId, takeId, kindId, outcome (looks_good, needs_changes, recorded), via (app, link, logged), comment?, commentBlobHash?, answers?, skipped?, people?, place?, givenBy?, requestId?, artifactHashes? | grow-only (earliest wins) |
| `v1.FlowStepLinksSet` | stepId, allowed | register per step; may the step be reviewed by a shared link that counts (default: any step but a checkpoint; decision 70) |
| `v1.CheckHelpSet` | kindId, itemId or materialId, linked | register per (kind, help); a note, guide or Bible linked to a check, which its reviewers see first (decision 91) |
| `v1.CheckShowsSet` | kindId (a check, or `record`), what (bibleAudio, bibleText, guideAudio, guideText, terms, notes, earlier), shown, from? (a step, for notes and earlier) | register per (kind, what); what a step puts on the screen of whoever does it, everything by default, nothing at a kind that withholds context (decision 130) |
| `v1.VersionReleased` | takeId, channel, live, url? | register per (version, channel); where a version is published, a fact not a verdict (decision 72) |
| `v1.DepartureRecorded` / `v1.DepartureUndone` | departureId, unitId, type (skip, override, keep), kindId? / stepId? / reviewId?, reason, reasonBlobHash? / departureId | grow-only / add-wins undo |
| `v1.RequestMade` / `v1.RequestWithdrawn` | requestId, unitId, what (record, review), kindId?, exactly one of profileId, guest, teamId, dueDate?, note?, noteBlobHash?, questions? / requestId | grow-only / add-wins; done is derived from the record; `dueDate` is no longer set or shown (decision 126), old events may still carry it |
| `v1.NoteAdded` | noteId, unitId, anchor (passage, version, verse, study, term; optional part and at on a version, help on the passage, replyTo on any, decision 149), text? / blobHash? / photoHash?, onTakeId?, kindId? (the step it was written at, decision 130) | grow-only |
| `v1.ReviewWithdrawn` / `v1.NoteWithdrawn` | reviewId / noteId | add-wins; counts only from the review's or note's own author (decisions.md 111) |
| `v1.StudyStepMarked` | unitId, guideId, stepId, done | register per (unit, guide, step) |
| `v1.MaterialDefined` / `v1.MaterialFieldSet` / `v1.MaterialLocked` | materialId, kind, title, scope {unitId?, stepId?}, templateRef? / materialId, fieldId, text? / blobHash? / materialId, locked | earliest wins / register per (material, field) / register per material |
| `v1.KeyTermDefined` / `v1.KeyTermRenderingAdded` / `v1.KeyTermAdjusted` / `v1.KeyTermLinked` | termId, term, gloss, unitScope[] / renderingId… / adjustmentId, note, blobHash?, duringTakeId? / takeId, termId, note?, adjustmentId? | all grow-only |
| `v1.KeyTermAudioRenderingAdded` | termId, renderingId (the clip), blobHash, durationMs, duringTakeId? (the take being drafted, so a way lists its passages), wayId (the way of saying the term it repeats; a written rendering's id, or one the phone made) | grow-only; a recorded example of how the language says a term, for the heard / not heard hint (decision 207); `KeyTermRenderingAdded` stays the written one |
| `v1.ReferenceSet` | itemId, state (recommended, hidden, inherit) | register per item; the language's say on a library item (decision 62) |
| `v1.ReferenceLanguageSet` | language | register; the language the team's reference material is in, before which `sourceCode` stands (decision 84) |
| `v1.ReferenceLanguageAdded` | language, added | register per language; another language the team's reference material may be in, beside the main one (decision 130) |
| `v1.PassageReferenceLinked` | unitId, itemId, linked | register per (unit, item) |
| `v1.ReferencesUsed` | unitId, takeId? or reviewId?, items[] | grow-only |
| `v1.BlobStored` / `v1.BlobInvalidated` | hash, size / hash, reason | register per hash (LWW by clock); server-only |
| `v1.CardVerseSet` | unitId, hash, mark (next, join, set, none), from?, to? | register per (unit, card); which verses a recorded part holds, worked out down a take's cards (verses.ts, decisions.md 82) |
| `v1.CardCleanUpSet` | unitId, hash, use (cleaned, original, none), cleanedHash?, cleanedFormat?, tool?, limitDb? | register per (unit, card as recorded), keeping every cleaned file a note named; Clean up's pick for a part, whose cleaned sound a new take puts in its place (decisions.md 176) |
| `v1.AudioFormatSet` | hash, format | one event per hash, earliest wins (decisions.md 75); a voice note's format when not m4a (decisions.md 77) |
| `v1.ExternalValueSet` | key, data (object or null) | register per key (later clock, then higher id); a third-party app's own value, kept and never acted on; only the app's Worker appends it, for a token with the `external_values` scope (decisions.md 79) |
| `v1.Redacted` | eventId, reason | grow-only set; the target is never folded; a redaction is never itself redacted (decisions.md 16) |

**Person stream** (org `_person`, `streamId` the profile id; written only by
`record_user_event`): `v1.TermsAccepted`, `v1.VisionSeen`,
`v1.WalkthroughDone`.

Smells to catch in review:

- Any event phrased as "set the whole list" or "move X from A to B". Split it
  into commutative parts.
- A reducer case that **reads existing state to decide what to write**. The
  first version of `MemberRemoved` copied the member's current role, so a
  removal that arrived before the add produced a different role. The
  permutation test caught it. Each event writes only its own registers.

## Adding an event

Never change a shipped event's shape: add a new versioned event instead
(`v2.X`), and keep the old one's materializer. A new event that fits a merge
shape already in the catalog needs no decision; a new merge shape does
(`docs/decisions/README.md`, and the `event-sourced-sync` skill's questions).

A new event type needs, in the same change:

- a type in `events.ts` (or `record.ts`) and its row in the catalog above;
- a case in `reducer.ts`, a case in `validate.ts`, and the same rule in the
  SQL `validate_payload` and `event_privilege` (a new migration);
  `scripts/record-parity-sql.ts` checks the SQL against core;
- coverage in the order-independence and idempotence tests. They generate
  permutations, so adding the event to the fixture list is enough;
- if it touches a map cut by passage, its place in `PASSAGE_PARTS` or
  `eventPassage` (`packages/core/src/passageParts.ts`, decision 143).
  `passageParts.test.ts` fails until every map says whether it is cut by
  passage and how two copies of an entry combine.
